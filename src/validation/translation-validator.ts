import type { TranslationResponse } from '../ai/schemas/translation.schema.js';
import type { PipelineTracer } from '../observability/telemetry.js';

export interface TranslationValidationResult {
  valid: boolean;
  errors: string[];
  durationUs: number;
}

const URL_PATTERN = /https?:\/\/[^\s<>"')\]]+/gi;
const LANGUAGE_FIELDS = ['English', 'Malay', 'Tamil', 'Mandarin'] as const;

export class TranslationValidator {
  validate(
    sourceText: string,
    response: TranslationResponse,
    tracer?: PipelineTracer
  ): TranslationValidationResult {
    const startedAt = process.hrtime.bigint();
    tracer?.startCheckpoint('CP06_VALIDATION');
    const errors: string[] = [];
    if (response.score >= 4) {
      for (const language of LANGUAGE_FIELDS) {
        const value = response[language];
        if (typeof value !== 'string' || value.trim().length === 0) {
          errors.push(`${language} must be a non-empty string`);
        } else if (value.length > 4096) {
          errors.push(`${language} exceeds 4096 characters`);
        }
      }
      const urls = sourceText.match(URL_PATTERN) ?? [];
      for (const url of urls) {
        for (const language of LANGUAGE_FIELDS) {
          if (!response[language]?.includes(url)) {
            errors.push(`${language} is missing URL ${url}`);
          }
        }
      }
    } else if (LANGUAGE_FIELDS.some(language => response[language] !== null)) {
      errors.push('scores below 4.0 must return null language fields');
    }
    const durationUs = Number((process.hrtime.bigint() - startedAt) / 1000n);
    if (tracer) tracer.endCheckpoint('CP06_VALIDATION', { valid: errors.length === 0, errorCount: errors.length });
    else console.log(`[TRACE:validation] [CP06_VALIDATION] DONE (${durationUs} μs)`, { valid: errors.length === 0 });
    return { valid: errors.length === 0, errors, durationUs };
  }
}

export function extractUrls(sourceText: string): string[] {
  return [...new Set(sourceText.match(URL_PATTERN) ?? [])];
}
