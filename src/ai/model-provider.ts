import { GoogleGenAI } from '@google/genai';
import type { TranslationPromptType } from './prompts/translation.prompt.js';
import { TranslationResponseSchema } from './schemas/translation.schema.js';

export const TRANSLATION_RESPONSE_JSON_SCHEMA = {
  type: 'object',
  properties: {
    id: { type: 'string' },
    score: { type: 'number', minimum: 1, maximum: 10 },
    English: { type: 'string', nullable: true },
    Malay: { type: 'string', nullable: true },
    Tamil: { type: 'string', nullable: true },
    Mandarin: { type: 'string', nullable: true }
  },
  required: ['id', 'score', 'English', 'Malay', 'Tamil', 'Mandarin']
} as const;

export interface ModelGenerateRequest {
  prompt: string;
  id: string;
  type: TranslationPromptType;
  validationFeedback?: readonly string[];
}

export interface IModelProvider {
  generate(request: ModelGenerateRequest): Promise<unknown>;
}

export interface GeminiModelProviderOptions {
  apiKey: string;
  model?: string;
}

export class GeminiModelProvider implements IModelProvider {
  private readonly client: GoogleGenAI;
  private readonly model: string;

  constructor(options: GeminiModelProviderOptions) {
    this.client = new GoogleGenAI({ apiKey: options.apiKey });
    this.model = options.model ?? 'gemini-3.8-flash';
  }

  async generate(request: ModelGenerateRequest): Promise<unknown> {
    const result = await this.client.models.generateContent({
      model: this.model,
      contents: request.prompt,
      config: {
        responseMimeType: 'application/json',
        responseJsonSchema: TRANSLATION_RESPONSE_JSON_SCHEMA,
        temperature: 0.1
      }
    });
    const text = result.text;
    if (!text) throw new Error('Gemini returned an empty response');
    return JSON.parse(text) as unknown;
  }
}

export type MockModelResponse = unknown | (() => unknown | Promise<unknown>);
export type MockModelFailure = Error & { status?: number; code?: string };

export class MockModelProvider implements IModelProvider {
  readonly requests: ModelGenerateRequest[] = [];
  private responseIndex = 0;

  constructor(
    private readonly responses: readonly MockModelResponse[],
    private readonly failures: readonly MockModelFailure[] = []
  ) {}

  async generate(request: ModelGenerateRequest): Promise<unknown> {
    this.requests.push(request);
    const failure = this.failures[this.requests.length - 1];
    if (failure) throw failure;
    const response = this.responses[Math.min(this.responseIndex++, this.responses.length - 1)];
    if (response === undefined) throw new Error('Mock model has no configured response');
    return typeof response === 'function' ? response() : response;
  }

  static response(value: unknown): MockModelResponse {
    const parsed = TranslationResponseSchema.safeParse(value);
    if (!parsed.success) throw new Error(`Invalid mock response: ${parsed.error.message}`);
    return parsed.data;
  }
}

export function transientStatus(error: unknown): number | undefined {
  if (typeof error !== 'object' || error === null) return undefined;
  const candidate = error as { status?: unknown; statusCode?: unknown; code?: unknown };
  if (typeof candidate.status === 'number') return candidate.status;
  if (typeof candidate.statusCode === 'number') return candidate.statusCode;
  if (candidate.code === 'ETIMEDOUT' || candidate.code === 'ECONNRESET') return 408;
  return undefined;
}

export function isTransientModelError(error: unknown): boolean {
  const status = transientStatus(error);
  return status === 408 || status === 429 || status === 500 || status === 502 || status === 503 || status === 504;
}
