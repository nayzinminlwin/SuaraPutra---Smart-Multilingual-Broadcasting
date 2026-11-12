import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { extname, join, relative } from 'node:path';
import { randomUUID } from 'node:crypto';
import pino from 'pino';
import {
  WhatsAppAmbiguousTimeoutError,
  WhatsAppInvalidInputError,
  WhatsAppPermanentError,
  WhatsAppTransientError
} from './errors.js';
import type {
  ConnectionChangeHandler, ConnectionStatus, GroupMetadataSummary, IWhatsAppAdapter,
  InboundMessageHandler, NormalizedInboundMessage, OutboundMessagePayload, SendMessageResult
} from './adapter.js';
import { normalizeUpsert } from './event-normalizer.js';

export type MockFaultMode = 'NORMAL' | 'TRANSIENT_ERROR' | 'AMBIGUOUS_TIMEOUT' | 'PERMANENT_ERROR';
export type SentMessage = Readonly<{
  targetGroupJid: string;
  payload: OutboundMessagePayload;
  t_wa_translated_sent_ms: number;
  sentAtIso: string;
  result: SendMessageResult;
}>;

export interface MockWhatsAppAdapterOptions {
  maxMediaBytes?: number;
  latencyMs?: number;
  botJid?: string;
  faultMode?: MockFaultMode;
  faultModesByTarget?: Readonly<Record<string, MockFaultMode>>;
  faultModesByCallIndex?: Readonly<Record<number, MockFaultMode>>;
  fileOutboxDir?: string;
  groupJidToLanguageMap?: Readonly<Record<string, string>>;
  logger?: pino.Logger;
}

export class MockWhatsAppAdapter implements IWhatsAppAdapter {
  private status: ConnectionStatus = 'close';
  private readonly messageHandlers: InboundMessageHandler[] = [];
  private readonly connectionHandlers: ConnectionChangeHandler[] = [];
  private readonly outbox: SentMessage[] = [];
  private readonly options: Required<Pick<MockWhatsAppAdapterOptions, 'maxMediaBytes' | 'latencyMs'>> &
    Omit<MockWhatsAppAdapterOptions, 'maxMediaBytes' | 'latencyMs'>;
  private sendCount = 0;
  private readonly logger: pino.Logger;

  constructor(options: MockWhatsAppAdapterOptions = {}) {
    this.options = { maxMediaBytes: 10 * 1024 * 1024, latencyMs: 0, ...options };
    this.logger = options.logger ?? pino({ level: 'silent' });
  }

  async connect(): Promise<void> {
    this.status = 'open';
    this.connectionHandlers.forEach(handler => handler(this.status));
  }

  async disconnect(): Promise<void> {
    this.status = 'close';
    this.connectionHandlers.forEach(handler => handler(this.status));
  }

  getConnectionStatus(): ConnectionStatus { return this.status; }
  getBotJid(): string | null { return this.options.botJid ?? null; }
  onMessage(handler: InboundMessageHandler): void { this.messageHandlers.push(handler); }
  onConnectionChange(handler: ConnectionChangeHandler): void { this.connectionHandlers.push(handler); }

  async injectSyntheticUpsert(rawPayload: unknown, mediaBuffers: Readonly<Record<string, Buffer>> = {}): Promise<void> {
    const messages = normalizeUpsert(rawPayload, mediaBuffers, { maxMediaBytes: this.options.maxMediaBytes });
    for (const message of messages) {
      for (const handler of this.messageHandlers) await handler(message);
    }
  }

  async sendMessage(targetGroupJid: string, payload: OutboundMessagePayload): Promise<SendMessageResult> {
    if (!/^[0-9-]+@g\.us$/.test(targetGroupJid)) {
      throw new WhatsAppInvalidInputError(`Invalid target group JID: ${targetGroupJid}`);
    }
    this.sendCount += 1;
    const mode = this.options.faultModesByCallIndex?.[this.sendCount]
      ?? this.options.faultModesByTarget?.[targetGroupJid]
      ?? this.options.faultMode
      ?? 'NORMAL';
    if (this.options.latencyMs > 0) await new Promise(resolve => setTimeout(resolve, this.options.latencyMs));
    if (mode === 'TRANSIENT_ERROR') {
      this.logger.warn({ targetGroupJid, callIndex: this.sendCount }, 'Mock transient send failure');
      throw new WhatsAppTransientError('Mock connection closed before write');
    }
    if (mode === 'AMBIGUOUS_TIMEOUT') {
      this.logger.warn({ targetGroupJid, callIndex: this.sendCount }, 'Mock ambiguous send failure');
      throw new WhatsAppAmbiguousTimeoutError('Mock timed out after simulated socket write');
    }
    if (mode === 'PERMANENT_ERROR') {
      this.logger.warn({ targetGroupJid, callIndex: this.sendCount }, 'Mock permanent send failure');
      throw new WhatsAppPermanentError('Mock recipient is not a participant');
    }
    const sentAtMs = Date.now();
    const result = { outgoingMessageId: `mock-out-${this.sendCount}-${randomUUID()}`, acknowledgedAtIso: new Date(sentAtMs).toISOString() };
    this.logger.debug({ targetGroupJid, callIndex: this.sendCount }, 'Mock message sent');
    this.outbox.push({ targetGroupJid, payload, t_wa_translated_sent_ms: sentAtMs, sentAtIso: result.acknowledgedAtIso, result });
    if (this.options.fileOutboxDir) {
      await this.writeFileOutbox(
        this.options.fileOutboxDir,
        this.options.groupJidToLanguageMap?.[targetGroupJid],
        targetGroupJid,
        payload,
        result
      );
    }
    return result;
  }

  async getGroupMetadata(groupJid: string): Promise<GroupMetadataSummary> {
    if (!/^[0-9-]+@g\.us$/.test(groupJid)) throw new WhatsAppInvalidInputError(`Invalid group JID: ${groupJid}`);
    return {
      groupJid, subject: 'Synthetic group', isCommunity: true, isCommunityAnnounce: false,
      linkedParentJid: null, botIsParticipant: true, botCanSend: true
    };
  }

  getSentMessages(): readonly SentMessage[] { return [...this.outbox]; }

  private async writeFileOutbox(
    outboxDir: string,
    language: string | undefined,
    targetGroupJid: string,
    payload: OutboundMessagePayload,
    result: SendMessageResult
  ): Promise<void> {
    if (!language) throw new Error(`No simulation language mapping for target group ${targetGroupJid}`);
    const groupsDir = join(outboxDir, 'groups');
    const mediaDir = join(outboxDir, 'media', language);
    await mkdir(groupsDir, { recursive: true });
    await mkdir(mediaDir, { recursive: true });
    const sequence = this.sendCount;
    let savedMediaPath: string | null = null;
    let text: string | null = null;
    let caption: string | null = null;
    if (payload.type === 'TEXT') {
      text = payload.text;
    } else {
      caption = payload.caption ?? null;
      const extension = payload.mimeType === 'image/png' ? '.png' : '.jpg';
      const mediaPath = join(mediaDir, `${sequence}_${result.outgoingMessageId}${extension}`);
      await writeFile(mediaPath, payload.imageBuffer);
      savedMediaPath = relative(outboxDir, mediaPath).replaceAll('\\', '/');
    }
    const entry = {
      outgoingMessageId: result.outgoingMessageId,
      acknowledgedAtIso: result.acknowledgedAtIso,
      targetGroupJid,
      language,
      payloadType: payload.type,
      ...(text !== null ? { text } : {}),
      ...(caption !== null ? { caption } : {}),
      ...(savedMediaPath ? { savedMediaPath } : {})
    };
    await this.appendJson(join(groupsDir, `${language}.json`), entry);
    await this.appendJson(join(outboxDir, 'broadcast-log.json'), entry);
  }

  private async appendJson(path: string, entry: Readonly<Record<string, unknown>>): Promise<void> {
    let entries: unknown[] = [];
    try {
      entries = JSON.parse(await readFile(path, 'utf8')) as unknown[];
    } catch (error) {
      if (!isFileNotFound(error)) throw error;
    }
    if (!Array.isArray(entries)) throw new Error(`Simulation outbox is not an array: ${path}`);
    await writeFile(path, JSON.stringify([...entries, entry], null, 2), 'utf8');
  }
}

function isFileNotFound(error: unknown): boolean {
  return typeof error === 'object' && error !== null && 'code' in error && error.code === 'ENOENT';
}
