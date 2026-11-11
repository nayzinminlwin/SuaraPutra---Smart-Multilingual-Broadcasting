import { TranslationResponseSchema, type TranslationResponse } from './schemas/translation.schema.js';
import {
  buildTranslationPrompt,
  type TranslationPromptInput,
  type TranslationPromptType
} from './prompts/translation.prompt.js';
import {
  isTransientModelError,
  type IModelProvider,
  type ModelGenerateRequest
} from './model-provider.js';
import { TranslationValidator, type TranslationValidationResult } from '../validation/translation-validator.js';
import { PipelineTracer } from '../observability/telemetry.js';
import type { AnnouncementRepository } from '../database/repositories/announcement.repo.js';
import type { EventLogRepository } from '../database/repositories/event-log.repo.js';

export interface AiProcessInput extends TranslationPromptInput {
  sourceText?: string;
  traceId?: string;
  announcementId?: string;
}

export type AiProcessStatus = 'ignored' | 'translated' | 'held_validation_failed';

export interface AiProcessResult {
  response: TranslationResponse;
  status: AiProcessStatus;
  validation: TranslationValidationResult | null;
  attempts: number;
  validationAttempts: number;
}

export interface AiProcessorOptions {
  provider: IModelProvider;
  validator?: TranslationValidator;
  scoreThreshold?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  announcements?: AnnouncementRepository;
  eventLogs?: EventLogRepository;
}

export class AiProcessor {
  private readonly validator: TranslationValidator;
  private readonly scoreThreshold: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;

  constructor(private readonly options: AiProcessorOptions) {
    this.validator = options.validator ?? new TranslationValidator();
    this.scoreThreshold = options.scoreThreshold ?? 4;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)));
  }

  async process(input: AiProcessInput): Promise<AiProcessResult> {
    const tracer = new PipelineTracer({
      traceId: input.traceId,
      messageId: input.id,
      waSourceSentTimestampMs: Date.now()
    });
    const prompt = buildTranslationPrompt(input);
    let providerResult: { value: unknown; attempts: number };
    try {
      providerResult = await this.generateWithRetry(
        { prompt, id: input.id, type: input.type },
        tracer
      );
    } catch (error) {
      this.recordProviderFailure(input, error);
      throw error;
    }
    let response: TranslationResponse;
    try {
      response = this.parseResponse(providerResult.value);
      this.assertResponseContract(input, response);
    } catch (error) {
      this.recordProviderFailure(input, error);
      throw error;
    }

    const shouldTranslate = input.type === 'TEXT CAPTION FROM IMAGE' || response.score >= this.scoreThreshold;
    if (!shouldTranslate) {
      if (response.English !== null || response.Malay !== null || response.Tamil !== null || response.Mandarin !== null) {
        throw new Error('Low-scoring response must contain null language fields');
      }
      this.logEvent('AI_IGNORED', input, { score: response.score });
      return { response, status: 'ignored', validation: null, attempts: providerResult.attempts, validationAttempts: 0 };
    }

    let validation = this.validator.validate(input.sourceText ?? input.content, response, tracer);
    if (validation.valid) {
      this.logEvent('AI_TRANSLATED', input, { score: response.score });
      return { response, status: 'translated', validation, attempts: providerResult.attempts, validationAttempts: 1 };
    }

    console.warn('[WARN] [CP06_VALIDATION:RETRY]', { id: input.id, errors: validation.errors });
    const retryPrompt = buildTranslationPrompt({
      ...input,
      otherAttributes: [
        input.otherAttributes ?? '',
        `Previous validation errors: ${validation.errors.join('; ')}. Regenerate and preserve every source URL exactly.`
      ].filter(Boolean).join('\n')
    });
    let regenerated: { value: unknown; attempts: number };
    try {
      regenerated = await this.generateWithRetry(
        { prompt: retryPrompt, id: input.id, type: input.type, validationFeedback: validation.errors },
        tracer
      );
    } catch (error) {
      this.recordProviderFailure(input, error);
      throw error;
    }
    let regeneratedResponse: TranslationResponse;
    try {
      regeneratedResponse = this.parseResponse(regenerated.value);
    } catch (error) {
      const contractErrors = [error instanceof Error ? error.message : 'Invalid regenerated AI response'];
      console.error('[ERROR] [CP05_AI_PROCESS:FAILED]', { id: input.id, errors: contractErrors });
      this.markHeld(input, contractErrors);
      throw error;
    }
    try {
      this.assertResponseContract(input, regeneratedResponse, true);
    } catch (error) {
      const contractErrors = [error instanceof Error ? error.message : 'Invalid regenerated AI response'];
      console.error('[ERROR] [CP05_AI_PROCESS:FAILED]', { id: input.id, errors: contractErrors });
      this.markHeld(input, contractErrors);
      return {
        response: regeneratedResponse,
        status: 'held_validation_failed',
        validation: { valid: false, errors: contractErrors, durationUs: 0 },
        attempts: providerResult.attempts + regenerated.attempts,
        validationAttempts: 2
      };
    }
    validation = this.validator.validate(input.sourceText ?? input.content, regeneratedResponse, tracer);
    if (validation.valid) {
      this.logEvent('AI_TRANSLATED', input, { score: regeneratedResponse.score, validationRetry: true });
      return {
        response: regeneratedResponse,
        status: 'translated',
        validation,
        attempts: providerResult.attempts + regenerated.attempts,
        validationAttempts: 2
      };
    }

    console.error('[ERROR] [CP05_AI_PROCESS:FAILED]', { id: input.id, errors: validation.errors });
    this.markHeld(input, validation.errors);
    return {
      response: regeneratedResponse,
      status: 'held_validation_failed',
      validation,
      attempts: providerResult.attempts + regenerated.attempts,
      validationAttempts: 2
    };
  }

  private async generateWithRetry(
    request: ModelGenerateRequest,
    tracer: PipelineTracer
  ): Promise<{ value: unknown; attempts: number }> {
    let attempts = 0;
    while (attempts < 3) {
      attempts += 1;
      tracer.startCheckpoint('CP05_AI_PROCESS');
      try {
        const value = await this.options.provider.generate(request);
        tracer.endCheckpoint('CP05_AI_PROCESS', { attempt: attempts });
        return { value, attempts };
      } catch (error) {
        const transient = isTransientModelError(error);
        tracer.endCheckpoint('CP05_AI_PROCESS', {
          attempt: attempts,
          failed: true,
          errorCode: transient ? 'TRANSIENT_PROVIDER_ERROR' : 'PROVIDER_ERROR'
        });
        if (!transient || attempts >= 3) {
          throw error;
        }
        const backoffMs = attempts === 1 ? 1000 : 2000;
        console.warn('[WARN] [CP05_AI_PROCESS:RETRY]', {
          attempt: attempts,
          maxAttempts: 3,
          backoffMs,
          reason: error instanceof Error ? error.message : 'provider error'
        });
        await this.sleep(backoffMs);
      }
    }
    throw new Error('AI provider retry loop terminated unexpectedly');
  }

  private parseResponse(value: unknown): TranslationResponse {
    const candidate = typeof value === 'string' ? JSON.parse(value) as unknown : value;
    const parsed = TranslationResponseSchema.safeParse(candidate);
    if (!parsed.success) throw new Error(`Invalid AI response: ${parsed.error.message}`);
    return parsed.data;
  }

  private assertResponseContract(
    input: AiProcessInput,
    response: TranslationResponse,
    requireTranslation = false
  ): void {
    if (response.id !== input.id) {
      throw new Error(`AI response id mismatch: expected ${input.id}, received ${response.id}`);
    }
    if (input.type === 'TEXT CAPTION FROM IMAGE' && response.score !== 10) {
      throw new Error('Image caption response must have score 10.0');
    }
    if (requireTranslation && input.type === 'TEXT-MESSAGE' && response.score < this.scoreThreshold) {
      throw new Error('Regenerated TEXT-MESSAGE response fell below the worthiness threshold');
    }
    if (input.type === 'TEXT-MESSAGE' && response.score < this.scoreThreshold &&
      [response.English, response.Malay, response.Tamil, response.Mandarin].some(value => value !== null)) {
      throw new Error('Low-scoring TEXT-MESSAGE response must contain null language fields');
    }
  }

  private logEvent(eventType: string, input: AiProcessInput, details: Record<string, unknown>): void {
    this.options.eventLogs?.append({
      eventType,
      relatedEntityType: input.announcementId ? 'announcement' : 'source_message',
      relatedEntityId: input.announcementId ?? input.id,
      level: 'INFO',
      details
    });
  }

  private markHeld(input: AiProcessInput, errors: readonly string[]): void {
    if (input.announcementId && this.options.announcements) {
      this.options.announcements.updateStatus(input.announcementId, 'held_validation_failed');
    }
    this.options.eventLogs?.append({
      eventType: 'AI_PROCESS_FAILED',
      relatedEntityType: input.announcementId ? 'announcement' : 'source_message',
      relatedEntityId: input.announcementId ?? input.id,
      level: 'ERROR',
      details: { errors }
    });
  }

  private recordProviderFailure(input: AiProcessInput, error: unknown): void {
    const reason = error instanceof Error ? error.message : 'provider error';
    console.error('[ERROR] [CP05_AI_PROCESS:FAILED]', { id: input.id, reason });
    this.markHeld(input, [reason]);
  }
}
