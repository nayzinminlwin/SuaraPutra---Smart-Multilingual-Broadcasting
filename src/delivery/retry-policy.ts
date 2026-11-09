import {
  WhatsAppAmbiguousTimeoutError,
  WhatsAppPermanentError,
  WhatsAppTransientError
} from '../whatsapp/errors.js';
import type { DeliveryJob } from '../shared/types.js';

export type RetryDecision = Readonly<{
  status: 'retry_wait' | 'uncertain' | 'failed_permanent';
  code: string;
  message: string;
  nextAttemptAt?: string;
  backoffMs?: number;
}>;

export interface RetryPolicyOptions {
  maxAttempts?: number;
  random?: () => number;
}

export class RetryPolicy {
  private readonly maxAttempts: number;
  private readonly random: () => number;

  constructor(options: RetryPolicyOptions = {}) {
    this.maxAttempts = options.maxAttempts ?? 5;
    this.random = options.random ?? Math.random;
  }

  decide(job: Pick<DeliveryJob, 'attempts' | 'maxAttempts'>, error: unknown): RetryDecision {
    if (error instanceof WhatsAppAmbiguousTimeoutError) {
      return { status: 'uncertain', code: 'AMBIGUOUS_SEND_TIMEOUT', message: error.message };
    }

    if (error instanceof WhatsAppTransientError && job.attempts < Math.min(job.maxAttempts, this.maxAttempts)) {
      const baseSeconds = Math.min(300, 5 * (2 ** Math.max(0, job.attempts - 1)));
      const jitterMs = Math.floor(this.random() * 1000);
      const backoffMs = baseSeconds * 1000 + jitterMs;
      return {
        status: 'retry_wait',
        code: 'TRANSIENT_SEND_FAILURE',
        message: error.message,
        backoffMs,
        nextAttemptAt: new Date(Date.now() + backoffMs).toISOString()
      };
    }

    const code = error instanceof WhatsAppPermanentError
      ? 'PERMANENT_SEND_FAILURE'
      : error instanceof WhatsAppTransientError
        ? 'MAX_ATTEMPTS_REACHED'
        : 'DELIVERY_FAILURE';
    const message = error instanceof Error ? error.message : 'Unknown delivery failure';
    return { status: 'failed_permanent', code, message };
  }
}
