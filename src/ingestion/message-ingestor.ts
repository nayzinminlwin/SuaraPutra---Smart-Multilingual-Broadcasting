import { deterministicId, newId } from '../shared/crypto.js';
import type { LanguageCode } from '../config/groups.js';
import type { EnvConfig } from '../config/env.js';
import type { DatabaseClient } from '../database/client.js';
import { AnnouncementRepository } from '../database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../database/repositories/delivery-job.repo.js';
import { SourceMessageRepository } from '../database/repositories/source-message.repo.js';
import type { IWhatsAppAdapter, NormalizedInboundMessage, SupportedMessageKind } from '../whatsapp/adapter.js';
import { PipelineTracer } from '../observability/telemetry.js';
import { ContextAssembler, type AssembledContext } from './context-assembler.js';
import { MessageDeduplicator } from './deduplicator.js';
import { MediaStore } from './media-store.js';

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
  contextMaxMessages: number;
  contextWindowSeconds: number;
  destinationGroups: Readonly<Record<LanguageCode, string>>;
  mediaStore: MediaStore;
  sources: SourceMessageRepository;
  announcements: AnnouncementRepository;
  deliveryJobs: DeliveryJobRepository;
  database: DatabaseClient;
}

export class MessageIngestor {
  private queue: Promise<unknown> = Promise.resolve();
  private readonly deduplicator: MessageDeduplicator;
  private readonly context: ContextAssembler;

  constructor(private readonly options: MessageIngestorOptions) {
    this.deduplicator = new MessageDeduplicator(options.sources);
    this.context = new ContextAssembler(options.sources, options.contextMaxMessages, options.contextWindowSeconds);
  }

  attach(adapter: IWhatsAppAdapter): void {
    adapter.onMessage(message => this.enqueue(message).then(() => undefined));
  }

  enqueue(message: NormalizedInboundMessage): Promise<IngestionResult> {
    const waitStarted = process.hrtime.bigint();
    const task = this.queue.then(async () => {
      const waitUs = Number((process.hrtime.bigint() - waitStarted) / 1000n);
      console.log(`[TRACE:${message.messageId}] [CP02_FIFO_WAIT] DONE (${waitUs} μs)`, { queueConcurrency: 1 });
      return this.process(message);
    });
    this.queue = task.then(() => undefined, () => undefined);
    return task;
  }

  private async process(message: NormalizedInboundMessage): Promise<IngestionResult> {
    const tracer = new PipelineTracer({
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
    if (!gate(!message.fromMe && message.senderJid !== (this.options.botJid ?? ''), 'GATE_2_SELF_ECHO')) {
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
    tracer.endCheckpoint('CP03_GATE_CHECKS', { accepted: true, ramBufferReleased: message.media?.buffer === null });

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
    const context = this.context.assemble(message, source);
    if (message.kind !== 'IMAGE_ONLY') return { accepted: true, message, context };
    if (!media?.localPath) throw new Error(`Image-only message ${message.messageId} was not persisted`);
    return { accepted: true, message, context, announcementId: this.createPassthrough(source.id, message, media.localPath) };
  }

  private createPassthrough(sourceId: string, message: NormalizedInboundMessage, mediaLocalPath: string): string {
    const announcementId = deterministicId('announcement', sourceId);
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
        idempotencyKey: `${announcementId}:${code}`
      })));
      return created.id;
    });
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
