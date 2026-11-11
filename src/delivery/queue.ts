import { randomUUID } from 'node:crypto';
import type { LanguageCode } from '../config/groups.js';
import type { PipelineTracer } from '../observability/telemetry.js';
import type {
  AnnouncementInput, DeliveryJob, MessageKind, SourceLinkRole, TranslationInput
} from '../shared/types.js';
import type { DatabaseClient } from '../database/client.js';
import { AnnouncementRepository } from '../database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../database/repositories/delivery-job.repo.js';
import { EventLogRepository } from '../database/repositories/event-log.repo.js';
import { DeliveryAttemptRepository } from '../database/repositories/delivery-attempt.repo.js';
import { TranslationRepository } from '../database/repositories/translation.repo.js';
import { MessageRouter } from '../routing/message-router.js';

export type QueueAnnouncementInput = Readonly<{
  announcement: AnnouncementInput;
  sources: ReadonlyArray<{ sourceMessageId: string; role: SourceLinkRole }>;
  translations: ReadonlyArray<Pick<TranslationInput, 'id' | 'languageCode' | 'content' | 'validationStatus' | 'validationErrorsJson'>>;
  mediaLocalPath?: string | null;
  mediaMimeType?: string | null;
  tracer?: PipelineTracer;
}>;

export class DeliveryQueue {
  private readonly events: EventLogRepository;
  private readonly router: MessageRouter;
  private readonly attempts: DeliveryAttemptRepository;

  constructor(
    private readonly database: DatabaseClient,
    private readonly announcements: AnnouncementRepository,
    private readonly translations: TranslationRepository,
    private readonly jobs: DeliveryJobRepository,
    destinations: Readonly<Record<LanguageCode, string>>,
    events?: EventLogRepository
  ) {
    this.router = new MessageRouter(destinations);
    this.events = events ?? new EventLogRepository(database);
    this.attempts = new DeliveryAttemptRepository(database);
  }

  persistAnnouncement(input: QueueAnnouncementInput): { announcementId: string; jobs: DeliveryJob[] } {
    const tracer = input.tracer;
    tracer?.startCheckpoint('CP07_QUEUE_PERSIST');
    try {
      this.validateTranslations(input.translations, input.announcement.payloadType);
      const result = this.database.transaction(() => {
        const announcement = this.announcements.createWithSources(
          { ...input.announcement, status: 'processing' },
          input.sources
        );
        for (const translation of input.translations) {
          this.translations.insert({ ...translation, announcementId: announcement.id });
        }
        const deliveryJobs = this.jobs.insertAtomic(this.router.createDeliveryJobs({
          announcementId: announcement.id,
          announcementSeq: announcement.announcementSeq,
          sourceTimestampMs: announcement.sourceTimestampMs,
          payloadType: announcement.payloadType,
          translations: input.translations.map(({ languageCode, content }) => ({ languageCode, content })),
          mediaLocalPath: input.mediaLocalPath ?? announcement.mediaLocalPath,
          mediaMimeType: input.mediaMimeType ?? announcement.mediaMimeType
        }));
        this.announcements.updateStatus(announcement.id, 'queued');
        return { announcementId: announcement.id, jobs: deliveryJobs };
      });
      tracer?.endCheckpoint('CP07_QUEUE_PERSIST', { jobs: result.jobs.length });
      return result;
    } catch (error) {
      if (tracer) {
        tracer.recordCheckpointFailure(
          'CP07_QUEUE_PERSIST',
          error instanceof Error ? error.name : 'QUEUE_PERSISTENCE_ERROR',
          {
            announcementId: input.announcement.id
          }
        );
      }
      throw error;
    }
  }

  claimNext(workerId: string, leaseSeconds = 45): DeliveryJob | null {
    const job = this.jobs.claimNext(workerId, leaseSeconds);
    if (job) {
      this.events.append({
        eventType: 'DELIVERY_QUEUE_CLAIMED',
        relatedEntityType: 'delivery_job',
        relatedEntityId: job.id,
        level: 'DEBUG',
        details: {
          workerId,
          targetGroupJid: job.targetGroupJid,
          announcementSeq: job.announcementSeq,
          languageOrder: job.languageOrder
        }
      });
    }
    return job;
  }

  markSent(jobId: string, outgoingMessageId: string): void {
    this.jobs.markSent(jobId, outgoingMessageId);
    this.events.append({
      eventType: 'DELIVERY_JOB_STATE_CHANGED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'INFO',
      details: { from: 'sending', to: 'sent', outgoingMessageId }
    });
  }

  markFailure(
    jobId: string,
    status: 'retry_wait' | 'uncertain' | 'failed_permanent',
    code: string,
    message: string,
    nextAttemptAt?: string
  ): void {
    this.jobs.markFailure(jobId, status, code, message, nextAttemptAt);
    this.events.append({
      eventType: 'DELIVERY_JOB_STATE_CHANGED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: status === 'uncertain' || status === 'failed_permanent' ? 'WARN' : 'INFO',
      details: { from: 'sending', to: status, errorCode: code }
    });
  }

  recordRetryDecision(
    job: DeliveryJob,
    decision: {
      status: 'retry_wait' | 'uncertain' | 'failed_permanent';
      code: string;
      backoffMs?: number;
    },
    attemptId?: string
  ): void {
    this.events.append({
      eventType: 'DELIVERY_RETRY_DECISION',
      relatedEntityType: 'delivery_job',
      relatedEntityId: job.id,
      level: decision.status === 'retry_wait' ? 'INFO' : 'WARN',
      details: {
        attemptId: attemptId ?? null,
        attemptNumber: job.attempts,
        maxAttempts: job.maxAttempts,
        decision: decision.status,
        errorCode: decision.code,
        ...(decision.backoffMs === undefined ? {} : { backoffMs: decision.backoffMs })
      }
    });
  }

  startAttempt(jobId: string, attemptNumber: number): { id: string; deliveryJobId: string; attemptNumber: number } {
    const attempt = this.attempts.start({
      id: randomUUID(),
      deliveryJobId: jobId,
      attemptNumber
    });
    this.events.append({
      eventType: 'DELIVERY_ATTEMPT_STARTED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'DEBUG',
      details: { attemptId: attempt.id, attemptNumber }
    });
    return { id: attempt.id, deliveryJobId: attempt.deliveryJobId, attemptNumber: attempt.attemptNumber };
  }

  markAttemptSent(attemptId: string, jobId: string, outgoingMessageId: string): void {
    this.database.transaction(() => {
      this.attempts.markSent(attemptId, outgoingMessageId);
      this.jobs.markSent(jobId, outgoingMessageId);
    });
    this.events.append({
      eventType: 'DELIVERY_ATTEMPT_SENT',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'INFO',
      details: { attemptId, outgoingMessageId }
    });
  }

  recordPostSendPersistenceFailure(
    jobId: string,
    attemptId: string,
    outgoingMessageId: string,
    error: unknown
  ): void {
    const errorCode = error instanceof Error ? error.name : 'POST_SEND_PERSISTENCE_ERROR';
    console.error('[DELIVERY_POST_SEND_PERSISTENCE_FAILED]', {
      jobId,
      attemptId,
      outgoingMessageId,
      errorCode
    });
    try {
      this.events.append({
        eventType: 'DELIVERY_POST_SEND_PERSISTENCE_FAILED',
        relatedEntityType: 'delivery_job',
        relatedEntityId: jobId,
        level: 'CRITICAL',
        details: {
          attemptId,
          outgoingMessageId,
          errorCode,
          automaticRetry: false
        }
      });
    } catch (eventError) {
      console.error('[DELIVERY_POST_SEND_PERSISTENCE_EVENT_FAILED]', {
        jobId,
        attemptId,
        errorCode: eventError instanceof Error ? eventError.name : 'EVENT_LOG_ERROR'
      });
    }
  }

  markAttemptFailedAndJobFailure(
    attemptId: string,
    jobId: string,
    status: 'retry_wait' | 'failed_permanent',
    failureKind: 'transient' | 'permanent' | 'invalid',
    errorCode: string,
    errorMessage: string,
    nextAttemptAt?: string
  ): void {
    this.database.transaction(() => {
      this.attempts.markFailed(attemptId, failureKind, errorCode, errorMessage);
      this.jobs.markFailure(jobId, status, errorCode, errorMessage, nextAttemptAt);
    });
    this.events.append({
      eventType: 'DELIVERY_ATTEMPT_FAILED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'WARN',
      details: { attemptId, failureKind, errorCode }
    });
    this.events.append({
      eventType: 'DELIVERY_JOB_STATE_CHANGED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'INFO',
      details: { from: 'sending', to: status, errorCode }
    });
  }

  markAttemptUncertainAndJobUncertain(
    attemptId: string,
    jobId: string,
    errorCode: string,
    errorMessage: string
  ): void {
    this.database.transaction(() => {
      this.attempts.markUncertain(attemptId, 'ambiguous', errorCode, errorMessage);
      this.jobs.markFailure(jobId, 'uncertain', errorCode, errorMessage);
    });
    this.events.append({
      eventType: 'DELIVERY_ATTEMPT_UNCERTAIN',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'CRITICAL',
      details: { attemptId, errorCode, automaticRetry: false }
    });
    this.events.append({
      eventType: 'DELIVERY_JOB_STATE_CHANGED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'WARN',
      details: { from: 'sending', to: 'uncertain', errorCode }
    });
  }

  markAttemptFailed(
    attemptId: string,
    jobId: string,
    failureKind: 'transient' | 'permanent' | 'invalid',
    errorCode: string,
    errorMessage: string
  ): void {
    this.attempts.markFailed(attemptId, failureKind, errorCode, errorMessage);
    this.events.append({
      eventType: 'DELIVERY_ATTEMPT_FAILED',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'WARN',
      details: { attemptId, failureKind, errorCode }
    });
  }

  markAttemptUncertain(
    attemptId: string,
    jobId: string,
    errorCode: string,
    errorMessage: string
  ): void {
    this.attempts.markUncertain(attemptId, 'ambiguous', errorCode, errorMessage);
    this.events.append({
      eventType: 'DELIVERY_ATTEMPT_UNCERTAIN',
      relatedEntityType: 'delivery_job',
      relatedEntityId: jobId,
      level: 'CRITICAL',
      details: { attemptId, errorCode, automaticRetry: false }
    });
  }

  recoverOrphanedJobs(): number {
    const errorCode = 'LEASE_EXPIRED_CRASH';
    const errorMessage = 'Expired sending lease recovered without automatic resend';
    const recovered = this.database.transaction(() => {
      const expiredJobs = this.jobs.findExpiredSending();
      const count = this.jobs.recoverExpiredSending();
      for (const job of expiredJobs) {
        const closedAttempts = this.attempts.markStartedAsUncertainForJob(
          job.id,
          errorCode,
          errorMessage
        );
        this.events.append({
          eventType: 'DELIVERY_ATTEMPT_UNCERTAIN',
          relatedEntityType: 'delivery_job',
          relatedEntityId: job.id,
          level: 'CRITICAL',
          details: {
            errorCode,
            automaticRetry: false,
            recoveredAttempts: closedAttempts
          }
        });
      }
      return count;
    });
    this.events.append({
      eventType: 'DELIVERY_LEASE_RECOVERY',
      level: recovered > 0 ? 'CRITICAL' : 'DEBUG',
      details: {
        recovered,
        outcome: recovered > 0 ? 'uncertain' : 'none',
        automaticRetry: false
      }
    });
    return recovered;
  }

  recordRecoveryFailure(error: unknown): void {
    const errorCode = error instanceof Error ? error.name : 'RECOVERY_ERROR';
    console.error('[DELIVERY_RECOVERY_FAILED]', { errorCode });
    this.events.append({
      eventType: 'DELIVERY_RECOVERY_FAILED',
      level: 'CRITICAL',
      details: { errorCode }
    });
  }

  private validateTranslations(
    translations: QueueAnnouncementInput['translations'],
    payloadType: MessageKind
  ): void {
    const expected = new Set(['ms', 'en', 'zh-CN', 'ta']);
    const seen = new Set<string>();
    for (const translation of translations) {
      if (seen.has(translation.languageCode)) {
        throw new Error(`Duplicate translation for ${translation.languageCode}`);
      }
      seen.add(translation.languageCode);
      if (translation.validationStatus !== 'passed') {
        throw new Error(`Translation ${translation.languageCode} did not pass validation`);
      }
      if (typeof translation.content !== 'string' || translation.content.length > 4096) {
        throw new Error(`Translation ${translation.languageCode} has invalid content length`);
      }
      if (payloadType !== 'IMAGE_ONLY' && translation.content.trim().length === 0) {
        throw new Error(`Translation ${translation.languageCode} has invalid content length`);
      }
    }
    if (seen.size !== expected.size || [...expected].some((language) => !seen.has(language))) {
      throw new Error('Exactly one validated translation is required for each destination language');
    }
  }
}
