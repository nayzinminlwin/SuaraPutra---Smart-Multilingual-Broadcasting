import { deterministicId, newId } from '../shared/crypto.js';
import type { LanguageCode } from '../config/groups.js';
import type { EnvConfig } from '../config/env.js';
import type { DatabaseClient } from '../database/client.js';
import { AnnouncementRepository } from '../database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../database/repositories/delivery-job.repo.js';
import { SourceMessageRepository } from '../database/repositories/source-message.repo.js';
import { TranslationRepository } from '../database/repositories/translation.repo.js';
import type { IWhatsAppAdapter, NormalizedInboundMessage, SupportedMessageKind } from '../whatsapp/adapter.js';
import { PipelineTracer } from '../observability/telemetry.js';
import { ContextAssembler, type AssembledContext } from './context-assembler.js';
import { MessageDeduplicator } from './deduplicator.js';
import { MediaStore } from './media-store.js';
import type { AiProcessor } from '../ai/ai-processor.js';
import type { DeliveryQueue } from '../delivery/queue.js';

const LANGUAGE_ORDER: readonly { code: LanguageCode; order: 1 | 2 | 3 | 4 }[] = [
  { code: 'ms', order: 1 }, { code: 'en', order: 2 }, { code: 'zh-CN', order: 3 }, { code: 'ta', order: 4 }
];

export type IngestionResult = Readonly<{
  accepted: boolean;
  reason?: 'out_of_scope' | 'self_echo' | 'unsupported' | 'duplicate';
  message: NormalizedInboundMessage;
  context?: AssembledContext;
  announcementId?: string;
}>;

export interface MessageIngestorOptions {
  sourceGroupJid: string;
  botJid?: string | null;
  botJidProvider?: string | null | (() => string | null);
  contextMaxMessages: number;
  contextWindowSeconds: number;
  destinationGroups: Readonly<Record<LanguageCode, string>>;
  mediaStore: MediaStore;
  sources: SourceMessageRepository;
  announcements: AnnouncementRepository;
  deliveryJobs: DeliveryJobRepository;
  database: DatabaseClient;
  aiProcessor?: AiProcessor;
  deliveryQueue?: DeliveryQueue;
  onTracer?: (announcementId: string, tracer: PipelineTracer) => void;
}

export class MessageIngestor {
  private readonly pendingQueue: Array<{
    message: NormalizedInboundMessage;
    arrivalSeq: number;
    queuedAt: bigint;
    resolve: (result: IngestionResult) => void;
    reject: (error: unknown) => void;
  }> = [];
  private arrivalSeq = 0;
  private isProcessing = false;
  private readonly deduplicator: MessageDeduplicator;
  private readonly context: ContextAssembler;
  private readonly translations: TranslationRepository;

  constructor(private readonly options: MessageIngestorOptions) {
    this.deduplicator = new MessageDeduplicator(options.sources);
    this.context = new ContextAssembler(options.sources, options.contextMaxMessages, options.contextWindowSeconds);
    this.translations = new TranslationRepository(options.database);
  }

  async recoverInterrupted(olderThanIso: string): Promise<number> {
    if (!this.options.aiProcessor || !this.options.deliveryQueue) return 0;
    let recovered = 0;
    for (const announcement of this.options.announcements.findInterrupted(olderThanIso)) {
      const source = this.options.sources.findById(announcement.primarySourceMessageId);
      if (!source || source.messageKind === 'IMAGE_ONLY') {
        this.options.announcements.updateOutcome(announcement.id, {
          classification: 'announcement',
          evaluationScore: announcement.evaluationScore,
          status: 'held_validation_failed'
        });
        continue;
      }
      const tracer = new PipelineTracer({
        messageId: source.messageId,
        waSourceSentTimestampMs: source.timestampMs
      });
      let aiResult;
      try {
        aiResult = await this.options.aiProcessor.process({
          id: announcement.id,
          type: source.messageKind === 'IMAGE_CAPTION' ? 'TEXT CAPTION FROM IMAGE' : 'TEXT-MESSAGE',
          content: source.textContent ?? '',
          sourceText: source.textContent ?? '',
          announcementId: announcement.id,
          tracer
        });
      } catch (error) {
        this.options.announcements.updateOutcome(announcement.id, {
          classification: 'announcement',
          evaluationScore: announcement.evaluationScore,
          status: 'held_validation_failed'
        });
        console.error('[AI_RECOVERY_FAILED]', {
          announcementId: announcement.id,
          errorCode: error instanceof Error ? error.name : 'AI_RECOVERY_ERROR'
        });
        continue;
      }
      if (aiResult.status === 'ignored') {
        this.options.announcements.updateOutcome(announcement.id, {
          classification: 'not_announcement',
          evaluationScore: aiResult.response.score,
          status: 'ignored',
          rawAiResponseJson: JSON.stringify(aiResult.response)
        });
        recovered += 1;
        continue;
      }
      if (aiResult.status === 'held_validation_failed' || !aiResult.validation?.valid) {
        this.options.announcements.updateOutcome(announcement.id, {
          classification: 'announcement',
          evaluationScore: aiResult.response.score,
          status: 'held_validation_failed',
          rawAiResponseJson: JSON.stringify(aiResult.response)
        });
        this.persistFailedTranslations(announcement.id, aiResult.response, aiResult.validation?.errors ?? []);
        recovered += 1;
        continue;
      }
      const fields = {
        en: aiResult.response.English,
        ms: aiResult.response.Malay,
        ta: aiResult.response.Tamil,
        'zh-CN': aiResult.response.Mandarin
      } as const;
      this.options.deliveryQueue.persistAnnouncement({
        announcement: {
          id: announcement.id,
          primarySourceMessageId: source.id,
          sourceTimestampMs: source.timestampMs,
          classification: 'announcement',
          evaluationScore: aiResult.response.score,
          status: 'processing',
          payloadType: announcement.payloadType,
          mediaLocalPath: source.mediaLocalPath,
          mediaMimeType: source.mediaMimeType,
          rawAiResponseJson: JSON.stringify(aiResult.response)
        },
        sources: [{ sourceMessageId: source.id, role: 'primary' }],
        translations: (Object.entries(fields) as Array<[LanguageCode, string | null]>).map(([languageCode, content]) => {
          if (!content) throw new Error(`AI recovery response did not contain ${languageCode}`);
          return { id: newId(), languageCode, content, validationStatus: 'passed' as const };
        }),
        mediaLocalPath: source.mediaLocalPath,
        mediaMimeType: source.mediaMimeType,
        tracer
      });
      this.options.onTracer?.(announcement.id, tracer);
      recovered += 1;
    }
    return recovered;
  }

  attach(adapter: IWhatsAppAdapter): void {
    adapter.onMessage(message => this.enqueue(message).then(() => undefined));
  }

  enqueue(message: NormalizedInboundMessage): Promise<IngestionResult> {
    const tracer = message.tracer ?? new PipelineTracer({
      messageId: message.messageId,
      waSourceSentTimestampMs: message.timestampMs
    });
    if (!message.tracer) {
      tracer.startCheckpoint('CP01_INGEST_NORMALIZE');
      tracer.endCheckpoint('CP01_INGEST_NORMALIZE', { bypassedNormalizer: true, durationUs: 0 });
    }
    tracer.startCheckpoint('CP02_FIFO_WAIT');
    const task = new Promise<IngestionResult>((resolve, reject) => {
      this.pendingQueue.push({
        message: { ...message, tracer },
        arrivalSeq: this.arrivalSeq++,
        queuedAt: process.hrtime.bigint(),
        resolve,
        reject
      });
    });
    void this.drainQueue();
    return task;
  }

  private async drainQueue(): Promise<void> {
    if (this.isProcessing) return;
    this.isProcessing = true;
    try {
      while (this.pendingQueue.length > 0) {
        this.pendingQueue.sort((a, b) =>
          a.message.timestampMs - b.message.timestampMs || a.arrivalSeq - b.arrivalSeq
        );
        const item = this.pendingQueue.shift();
        if (!item) continue;
        item.message.tracer?.endCheckpoint('CP02_FIFO_WAIT', {
          queueConcurrency: 1,
          waitUs: Number((process.hrtime.bigint() - item.queuedAt) / 1000n)
        });
        try {
          item.resolve(await this.process(item.message));
        } catch (error) {
          item.reject(error);
        }
      }
    } finally {
      this.isProcessing = false;
      if (this.pendingQueue.length > 0) void this.drainQueue();
    }
  }

  private async process(message: NormalizedInboundMessage): Promise<IngestionResult> {
    const tracer = message.tracer ?? new PipelineTracer({
      messageId: message.messageId,
      waSourceSentTimestampMs: message.timestampMs
    });
    tracer.startCheckpoint('CP03_GATE_CHECKS');
    const gate = (passed: boolean, name: string, metadata: Record<string, unknown> = {}): boolean => {
      console.log(`[TRACE:${tracer.traceId}] [CP03_GATE_CHECKS] ${name}`, { passed, ...metadata });
      return passed;
    };
    if (!gate(message.chatJid === this.options.sourceGroupJid, 'GATE_1_SOURCE_GROUP')) {
      tracer.endCheckpoint('CP03_GATE_CHECKS', { rejectedGate: 1 });
      return { accepted: false, reason: 'out_of_scope', message };
    }
    const botJid = typeof this.options.botJidProvider === 'function'
      ? this.options.botJidProvider()
      : this.options.botJidProvider ?? this.options.botJid ?? null;
    if (!gate(!message.fromMe && message.senderJid !== (botJid ?? ''), 'GATE_2_SELF_ECHO')) {
      tracer.endCheckpoint('CP03_GATE_CHECKS', { rejectedGate: 2 });
      return { accepted: false, reason: 'self_echo', message };
    }
    if (!gate(this.isSupported(message.kind), 'GATE_3_SUPPORTED_KIND')) {
      tracer.endCheckpoint('CP03_GATE_CHECKS', { rejectedGate: 3 });
      return { accepted: false, reason: 'unsupported', message };
    }
    if (!gate(!this.deduplicator.isDuplicate(message), 'GATE_4_DEDUPLICATION')) {
      tracer.endCheckpoint('CP03_GATE_CHECKS', { rejectedGate: 4 });
      return { accepted: false, reason: 'duplicate', message };
    }

    let media = null;
    if (message.media) {
      if (!message.media.buffer) throw new Error(`Image message ${message.messageId} has no media buffer`);
      media = await this.options.mediaStore.save(message.messageId, message.media.mimeType, message.media.buffer);
      message.media.buffer = null;
    }
    console.log(`[TRACE:${tracer.traceId}] [CP03_GATE_CHECKS] GATE_5_MEDIA_PERSISTENCE`, {
      passed: true, ramBufferReleased: message.media?.buffer === null
    });
    const source = this.options.sources.insert({
      id: deterministicId('source', message.chatJid, message.messageId),
      chatJid: message.chatJid, messageId: message.messageId, senderJid: message.senderJid,
      senderPushName: message.senderPushName, timestampMs: message.timestampMs, messageKind: message.kind as Exclude<SupportedMessageKind, 'UNSUPPORTED'>,
      textContent: message.text, contentHash: this.deduplicator.contentHash(message),
      quotedMessageId: message.quotedMessageId, quotedParticipantJid: message.quotedParticipantJid,
      quotedText: message.quotedText, mediaLocalPath: media?.localPath ?? null,
      mediaMimeType: media?.mimeType ?? message.media?.mimeType ?? null,
      mediaSha256Hex: media?.sha256Hex ?? message.media?.fileSha256Hex ?? null, rawPayloadJson: message.rawPayloadJson
    });
    tracer.endCheckpoint('CP03_GATE_CHECKS', { accepted: true, ramBufferReleased: message.media?.buffer === null });
    const context = this.context.assemble(message, source, tracer);
    if (message.kind !== 'IMAGE_ONLY') {
      if (!this.options.aiProcessor || !this.options.deliveryQueue) {
        return { accepted: true, message, context };
      }
      const payloadType = message.kind === 'TEXT' || message.kind === 'IMAGE_CAPTION'
        ? message.kind
        : (() => { throw new Error(`Unsupported message kind: ${message.kind}`); })();
      const announcementId = deterministicId('announcement', source.id);
      this.createProcessingAnnouncement(announcementId, source.id, message, payloadType, context, media);
      let aiResult;
      try {
        aiResult = await this.options.aiProcessor.process({
          id: announcementId,
          type: payloadType === 'IMAGE_CAPTION' ? 'TEXT CAPTION FROM IMAGE' : 'TEXT-MESSAGE',
          content: message.text ?? '',
          sourceText: message.text ?? '',
          otherAttributes: this.contextForAi(context),
          announcementId,
          tracer
        });
      } catch (error) {
        this.options.announcements.updateOutcome(announcementId, {
          classification: 'announcement',
          evaluationScore: 0,
          status: 'held_validation_failed'
        });
        this.options.onTracer?.(announcementId, tracer);
        return { accepted: true, message, context, announcementId };
      }
      if (aiResult.status === 'ignored') {
        this.options.announcements.updateOutcome(announcementId, {
          classification: 'not_announcement',
          evaluationScore: aiResult.response.score,
          status: 'ignored',
          rawAiResponseJson: JSON.stringify(aiResult.response)
        });
        this.options.onTracer?.(announcementId, tracer);
        return { accepted: true, message, context, announcementId };
      }
      if (aiResult.status === 'held_validation_failed' || !aiResult.validation?.valid) {
        this.options.announcements.updateOutcome(announcementId, {
          classification: 'announcement',
          evaluationScore: aiResult.response.score,
          status: 'held_validation_failed',
          rawAiResponseJson: JSON.stringify(aiResult.response)
        });
        this.persistFailedTranslations(announcementId, aiResult.response, aiResult.validation?.errors ?? []);
        this.options.onTracer?.(announcementId, tracer);
        return { accepted: true, message, context, announcementId };
      }
      const fields = {
        en: aiResult.response.English,
        ms: aiResult.response.Malay,
        ta: aiResult.response.Tamil,
        'zh-CN': aiResult.response.Mandarin
      } as const;
      const mediaLocalPath = media?.localPath ?? null;
      const queued = this.options.deliveryQueue.persistAnnouncement({
        announcement: {
          id: announcementId,
          primarySourceMessageId: source.id,
          sourceTimestampMs: message.timestampMs,
          classification: 'announcement',
          evaluationScore: aiResult.response.score,
          status: 'processing',
          payloadType,
          mediaLocalPath,
          mediaMimeType: media?.mimeType ?? message.media?.mimeType ?? null,
          rawAiResponseJson: JSON.stringify(aiResult.response)
        },
        sources: [...new Set(context.sourceMessageIds)].map((sourceMessageId) => ({
          sourceMessageId,
          role: sourceMessageId === source.id ? 'primary' as const : 'window_context' as const
        })),
        translations: (Object.entries(fields) as Array<[LanguageCode, string | null]>).map(([languageCode, content]) => {
          if (!content) throw new Error(`AI response did not contain translation for ${languageCode}`);
          return {
            id: newId(),
            languageCode,
            content,
            validationStatus: 'passed' as const
          };
        }),
        mediaLocalPath,
        mediaMimeType: media?.mimeType ?? message.media?.mimeType ?? null,
        tracer
      });
      this.options.onTracer?.(queued.announcementId, tracer);
      return { accepted: true, message, context, announcementId: queued.announcementId };
    }

    if (!media?.localPath) throw new Error(`Image-only message ${message.messageId} was not persisted`);
    const announcementId = this.createPassthrough(source.id, message, media.localPath, tracer);
    this.options.onTracer?.(announcementId, tracer);
    return { accepted: true, message, context, announcementId };
  }

  private createProcessingAnnouncement(
    announcementId: string,
    sourceId: string,
    message: NormalizedInboundMessage,
    payloadType: 'TEXT' | 'IMAGE_CAPTION',
    context: AssembledContext,
    media: { localPath: string; mimeType: string } | null
  ): void {
    const quotedId = context.quoted && 'id' in context.quoted ? context.quoted.id : null;
    const sources = [...new Set(context.sourceMessageIds)].map(sourceMessageId => ({
      sourceMessageId,
      role: sourceMessageId === sourceId
        ? 'primary' as const
        : sourceMessageId === quotedId
          ? 'quoted' as const
          : 'window_context' as const
    }));
    this.options.announcements.createWithSources({
      id: announcementId,
      primarySourceMessageId: sourceId,
      sourceTimestampMs: message.timestampMs,
      classification: 'announcement',
      evaluationScore: payloadType === 'IMAGE_CAPTION' ? 10 : 0,
      status: 'processing',
      payloadType,
      mediaLocalPath: media?.localPath ?? null,
      mediaMimeType: media?.mimeType ?? message.media?.mimeType ?? null
    }, sources);
  }

  private persistFailedTranslations(
    announcementId: string,
    response: { English: string | null; Malay: string | null; Tamil: string | null; Mandarin: string | null },
    errors: readonly string[]
  ): void {
    const fields = {
      en: response.English,
      ms: response.Malay,
      ta: response.Tamil,
      'zh-CN': response.Mandarin
    } as const;
    for (const [languageCode, content] of Object.entries(fields) as Array<[LanguageCode, string | null]>) {
      if (content !== null) {
        this.translations.insert({
          id: newId(),
          announcementId,
          languageCode,
          content,
          validationStatus: 'failed',
          validationErrorsJson: JSON.stringify(errors)
        });
      }
    }
  }

  private contextForAi(context: AssembledContext): string {
    const related = [
      context.quoted && 'textContent' in context.quoted
        ? context.quoted.textContent
        : context.quoted && 'text' in context.quoted ? context.quoted.text : null,
      ...context.recent.map(source => source.textContent)
    ].filter((value): value is string => Boolean(value));
    return related.length > 0 ? `Related context:\n${related.join('\n')}` : '';
  }

  private createPassthrough(
    sourceId: string,
    message: NormalizedInboundMessage,
    mediaLocalPath: string,
    tracer: PipelineTracer
  ): string {
    const announcementId = deterministicId('announcement', sourceId);
    tracer.startCheckpoint('CP07_QUEUE_PERSIST');
    const announcement = this.options.database.transaction(() => {
      const created = this.options.announcements.createWithSources({
        id: announcementId, primarySourceMessageId: sourceId, sourceTimestampMs: message.timestampMs,
        classification: 'announcement', evaluationScore: 10, status: 'queued', payloadType: 'IMAGE_ONLY',
        mediaLocalPath, mediaMimeType: message.media?.mimeType ?? 'application/octet-stream'
      }, [{ sourceMessageId: sourceId, role: 'primary' }]);
      this.options.deliveryJobs.insertAtomic(LANGUAGE_ORDER.map(({ code, order }) => ({
        id: newId(), announcementId, announcementSeq: created.announcementSeq, sourceTimestampMs: message.timestampMs,
        languageCode: code, languageOrder: order, targetGroupJid: this.options.destinationGroups[code],
        payloadType: 'IMAGE_ONLY', mediaLocalPath, mediaMimeType: message.media?.mimeType ?? 'application/octet-stream',
        idempotencyKey: `${announcementId}:${code}:${this.options.destinationGroups[code]}`
      })));
      return created.id;
    });
    tracer.endCheckpoint('CP07_QUEUE_PERSIST', { jobs: 4, announcementId });
    return announcement;
  }

  private isSupported(kind: SupportedMessageKind): kind is Exclude<SupportedMessageKind, 'UNSUPPORTED'> {
    return kind === 'TEXT' || kind === 'IMAGE_CAPTION' || kind === 'IMAGE_ONLY';
  }
}

export function messageIngestorOptionsFromConfig(
  config: Pick<EnvConfig, 'WHATSAPP_SOURCE_GROUP_JID' | 'CONTEXT_MAX_MESSAGES' | 'CONTEXT_WINDOW_SECONDS' | 'MEDIA_STORAGE_DIR' | 'MAX_MEDIA_BYTES' | 'WHATSAPP_MALAY_GROUP_JID' | 'WHATSAPP_ENGLISH_GROUP_JID' | 'WHATSAPP_MANDARIN_GROUP_JID' | 'WHATSAPP_TAMIL_GROUP_JID'>,
  dependencies: Omit<MessageIngestorOptions, 'sourceGroupJid' | 'contextMaxMessages' | 'contextWindowSeconds' | 'destinationGroups' | 'mediaStore'>
): MessageIngestorOptions {
  return {
    ...dependencies, sourceGroupJid: config.WHATSAPP_SOURCE_GROUP_JID,
    contextMaxMessages: config.CONTEXT_MAX_MESSAGES, contextWindowSeconds: config.CONTEXT_WINDOW_SECONDS,
    destinationGroups: {
      ms: config.WHATSAPP_MALAY_GROUP_JID,
      en: config.WHATSAPP_ENGLISH_GROUP_JID,
      'zh-CN': config.WHATSAPP_MANDARIN_GROUP_JID,
      ta: config.WHATSAPP_TAMIL_GROUP_JID
    },
    mediaStore: new MediaStore(config.MEDIA_STORAGE_DIR, config.MAX_MEDIA_BYTES)
  };
}
