import { randomUUID } from 'node:crypto';
import {
  WhatsAppAmbiguousTimeoutError,
  WhatsAppInvalidInputError,
  WhatsAppPermanentError,
  WhatsAppTransientError
} from '../shared/errors.js';
import type {
  ConnectionChangeHandler, ConnectionStatus, GroupMetadataSummary, IWhatsAppAdapter,
  InboundMessageHandler, NormalizedInboundMessage, OutboundMessagePayload, SendMessageResult
} from './adapter.js';
import { normalizeUpsert } from './event-normalizer.js';

export type MockFaultMode = 'NORMAL' | 'TRANSIENT_ERROR' | 'AMBIGUOUS_TIMEOUT' | 'PERMANENT_ERROR';
export type SentMessage = Readonly<{
  targetGroupJid: string;
  payload: OutboundMessagePayload;
  sentAtIso: string;
  result: SendMessageResult;
}>;

export interface MockWhatsAppAdapterOptions {
  maxMediaBytes?: number;
  latencyMs?: number;
  botJid?: string;
  faultMode?: MockFaultMode;
  faultModesByTarget?: Readonly<Record<string, MockFaultMode>>;
}

export class MockWhatsAppAdapter implements IWhatsAppAdapter {
  private status: ConnectionStatus = 'close';
  private readonly messageHandlers: InboundMessageHandler[] = [];
  private readonly connectionHandlers: ConnectionChangeHandler[] = [];
  private readonly outbox: SentMessage[] = [];
  private readonly options: Required<Pick<MockWhatsAppAdapterOptions, 'maxMediaBytes' | 'latencyMs'>> &
    Omit<MockWhatsAppAdapterOptions, 'maxMediaBytes' | 'latencyMs'>;
  private sendCount = 0;

  constructor(options: MockWhatsAppAdapterOptions = {}) {
    this.options = { maxMediaBytes: 10 * 1024 * 1024, latencyMs: 0, ...options };
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
    const mode = this.options.faultModesByTarget?.[targetGroupJid] ?? this.options.faultMode ?? 'NORMAL';
    if (this.options.latencyMs > 0) await new Promise(resolve => setTimeout(resolve, this.options.latencyMs));
    if (mode === 'TRANSIENT_ERROR') throw new WhatsAppTransientError('Mock connection closed before write');
    if (mode === 'AMBIGUOUS_TIMEOUT') throw new WhatsAppAmbiguousTimeoutError('Mock timed out after simulated socket write');
    if (mode === 'PERMANENT_ERROR') throw new WhatsAppPermanentError('Mock recipient is not a participant');
    const result = { outgoingMessageId: `mock-out-${this.sendCount}-${randomUUID()}`, acknowledgedAtIso: new Date().toISOString() };
    this.outbox.push({ targetGroupJid, payload, sentAtIso: result.acknowledgedAtIso, result });
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
}
