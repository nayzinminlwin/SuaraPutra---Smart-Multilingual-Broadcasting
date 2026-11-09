import type { LanguageCode } from '../config/groups.js';
import type { PipelineTracer } from '../observability/telemetry.js';
import type {
  AnnouncementInput, DeliveryJob, MessageKind, SourceLinkRole, TranslationInput
} from '../shared/types.js';
import type { DatabaseClient } from '../database/client.js';
import { AnnouncementRepository } from '../database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../database/repositories/delivery-job.repo.js';
import { EventLogRepository } from '../database/repositories/event-log.repo.js';
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
  }

  persistAnnouncement(input: QueueAnnouncementInput): { announcementId: string; jobs: DeliveryJob[] } {
    const tracer = input.tracer;
    tracer?.startCheckpoint('CP07_QUEUE_PERSIST');
    try {
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
        console.error(`[TRACE:${tracer.traceId}] [CP07_QUEUE_PERSIST:FAILED]`, {
          announcementId: input.announcement.id,
          error: error instanceof Error ? error.message : 'unknown'
        });
        if (tracer.checkpoints.some((checkpoint) => checkpoint.name === 'CP07_QUEUE_PERSIST')) {
          throw error;
        }
      }
      throw error;
    }
  }

  claimNext(workerId: string, leaseSeconds = 45): DeliveryJob | null {
    return this.jobs.claimNext(workerId, leaseSeconds);
  }

  markSent(jobId: string, outgoingMessageId: string): void {
    this.jobs.markSent(jobId, outgoingMessageId);
  }

  markFailure(
    jobId: string,
    status: 'retry_wait' | 'uncertain' | 'failed_permanent',
    code: string,
    message: string,
    nextAttemptAt?: string
  ): void {
    this.jobs.markFailure(jobId, status, code, message, nextAttemptAt);
  }

  recoverOrphanedJobs(): number {
    const recovered = this.jobs.recoverExpiredSending();
    if (recovered > 0) {
      this.events.append({
        eventType: 'DELIVERY_LEASE_RECOVERY',
        level: 'CRITICAL',
        details: { recovered, outcome: 'uncertain', automaticRetry: false }
      });
    }
    return recovered;
  }
}
