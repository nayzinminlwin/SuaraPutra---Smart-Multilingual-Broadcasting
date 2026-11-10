import { readFile } from 'node:fs/promises';
import { randomUUID } from 'node:crypto';
import type { IWhatsAppAdapter, OutboundMessagePayload } from '../whatsapp/adapter.js';
import type { DeliveryJob } from '../shared/types.js';
import type { PipelineTracer } from '../observability/telemetry.js';
import { DeliveryValidationError } from '../shared/errors.js';
import { WhatsAppAmbiguousTimeoutError, WhatsAppPermanentError, WhatsAppTransientError } from '../whatsapp/errors.js';
import { RetryPolicy } from './retry-policy.js';
import { DeliveryQueue } from './queue.js';

type MediaCacheEntry = { path: string; buffer: Buffer };

export interface DispatcherOptions {
  adapter: IWhatsAppAdapter;
  queue: DeliveryQueue;
  pacingMs?: number;
  killSwitch?: boolean;
  retryPolicy?: RetryPolicy;
  readMedia?: (path: string) => Promise<Buffer>;
  tracerForJob?: (job: DeliveryJob) => PipelineTracer | undefined;
}

export class DeliveryDispatcher {
  private readonly pacingMs: number;
  private readonly readMedia: (path: string) => Promise<Buffer>;
  private readonly retryPolicy: RetryPolicy;
  private readonly mediaCache = new Map<string, MediaCacheEntry>();
  private lastDispatchAt = 0;

  constructor(private readonly options: DispatcherOptions) {
    this.pacingMs = options.pacingMs ?? 1500;
    this.readMedia = options.readMedia ?? readFile;
    this.retryPolicy = options.retryPolicy ?? new RetryPolicy();
  }

  async dispatchOnce(): Promise<'paused' | 'idle' | 'sent' | 'failed'> {
    if (this.options.killSwitch) return 'paused';
    const job = this.options.queue.claimNext(`dispatcher-${randomUUID()}`);
    if (!job) return 'idle';

    const tracer = this.options.tracerForJob?.(job);
    let attempt: { id: string; deliveryJobId: string; attemptNumber: number } | null = null;
    const dispatchCheckpoint = `CP09_DISPATCH_${job.languageCode}`;
    try {
      attempt = this.options.queue.startAttempt(job.id, job.attempts);
      tracer?.startCheckpoint('CP08_MSG_RECONSTRUCT');
      const reconstructed = await this.reconstruct(job);
      const payload = reconstructed.payload;
      tracer?.endCheckpoint('CP08_MSG_RECONSTRUCT', {
        mediaCache: reconstructed.mediaCache
      });
      await this.pace();
      const dispatchStarted = process.hrtime.bigint();
      tracer?.startCheckpoint(dispatchCheckpoint);
      const result = await this.options.adapter.sendMessage(job.targetGroupJid, payload);
      const durationUs = Number((process.hrtime.bigint() - dispatchStarted) / 1000n);
      tracer?.endCheckpoint(dispatchCheckpoint, { durationUs });
      this.options.queue.markAttemptSent(attempt.id, job.id, result.outgoingMessageId);
      if (job.languageOrder === 4) {
        this.mediaCache.delete(job.announcementId);
        tracer?.finalizeJourney(Date.parse(result.acknowledgedAtIso));
      }
      return 'sent';
    } catch (error) {
      const errorCode = error instanceof Error ? error.name : 'DELIVERY_ERROR';
      tracer?.recordCheckpointFailure('CP08_MSG_RECONSTRUCT', errorCode, { jobId: job.id });
      tracer?.recordCheckpointFailure(dispatchCheckpoint, errorCode, { jobId: job.id });
      if (tracer) console.error(`[TRACE:${tracer.traceId}] dispatch failed`, { jobId: job.id });
      const decision = this.retryPolicy.decide(job, error);
      this.options.queue.recordRetryDecision(job, decision, attempt?.id);
      if (decision.status === 'retry_wait') {
        tracer?.logRetryOrWarning(
          'CP09_DISPATCH',
          job.attempts,
          job.maxAttempts,
          decision.code,
          decision.backoffMs ?? 0
        );
      }
      if (!attempt) {
        this.options.queue.markFailure(
          job.id,
          decision.status,
          decision.code,
          decision.message,
          decision.nextAttemptAt
        );
      } else if (decision.status === 'uncertain') {
        this.options.queue.markAttemptUncertainAndJobUncertain(
          attempt.id, job.id, decision.code, decision.message
        );
      } else {
        const failureKind = error instanceof WhatsAppTransientError
          ? 'transient'
          : error instanceof WhatsAppPermanentError
            ? 'permanent'
            : 'invalid';
        this.options.queue.markAttemptFailedAndJobFailure(
          attempt.id,
          job.id,
          decision.status,
          failureKind,
          decision.code,
          decision.message,
          decision.nextAttemptAt
        );
      }
      if (job.languageOrder === 4) this.mediaCache.delete(job.announcementId);
      return 'failed';
    }
  }

  async dispatchUntilIdle(maxJobs = Number.MAX_SAFE_INTEGER): Promise<number> {
    let dispatched = 0;
    while (dispatched < maxJobs) {
      const outcome = await this.dispatchOnce();
      if (outcome === 'idle' || outcome === 'paused') return dispatched;
      dispatched += 1;
    }
    return dispatched;
  }

  clearMediaCache(): void {
    this.mediaCache.clear();
  }

  private async reconstruct(job: DeliveryJob): Promise<{
    payload: OutboundMessagePayload;
    mediaCache: 'NOT_APPLICABLE' | 'DISK_READ' | 'RAM_HIT';
  }> {
    if (job.payloadType === 'TEXT') {
      const text = job.textContent;
      this.validateText(text, job.id);
      return { payload: { type: 'TEXT', text }, mediaCache: 'NOT_APPLICABLE' };
    }
    if (!job.mediaLocalPath || !job.mediaMimeType) {
      throw new Error(`Delivery job ${job.id} has incomplete media payload`);
    }
    if (job.textContent != null && (job.textContent.trim().length === 0 || job.textContent.length > 4096)) {
      throw new DeliveryValidationError(`Delivery job ${job.id} has invalid caption content`);
    }
    let entry = this.mediaCache.get(job.announcementId);
    const mediaCache = entry?.path === job.mediaLocalPath ? 'RAM_HIT' : 'DISK_READ';
    if (!entry || entry.path !== job.mediaLocalPath) {
      entry = { path: job.mediaLocalPath, buffer: await this.readMedia(job.mediaLocalPath) };
      this.mediaCache.set(job.announcementId, entry);
    }

    return {
      payload: {
        type: 'IMAGE',
        imageBuffer: entry.buffer,
        mimeType: job.mediaMimeType,
        ...(job.textContent ? { caption: job.textContent } : {})
      },
      mediaCache
    };
  }

  private validateText(text: string | null | undefined, jobId: string): asserts text is string {
    if (!text || text.trim().length === 0 || text.length > 4096) {
      throw new DeliveryValidationError(`Delivery job ${jobId} has invalid text content`);
    }
  }

  private async pace(): Promise<void> {
    const delay = this.pacingMs - (Date.now() - this.lastDispatchAt);
    if (this.lastDispatchAt > 0 && delay > 0) {
      await new Promise<void>((resolve) => setTimeout(resolve, delay));
    }
    this.lastDispatchAt = Date.now();
  }
}

export { DeliveryDispatcher as Dispatcher };
