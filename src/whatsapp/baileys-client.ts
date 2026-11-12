import { Boom } from '@hapi/boom';
import {
  DisconnectReason,
  downloadMediaMessage,
  isJidGroup,
  makeWASocket,
  normalizeMessageContent,
  useMultiFileAuthState,
  type WAMessage,
  type WASocket
} from '@whiskeysockets/baileys';
import { createLogger } from '../observability/logger.js';
import type { EnvConfig } from '../config/env.js';
import { WhatsAppAmbiguousTimeoutError, WhatsAppInvalidInputError, WhatsAppPermanentError, WhatsAppTransientError } from './errors.js';
import type {
  ConnectionChangeHandler, ConnectionStatus, GroupMetadataSummary, IWhatsAppAdapter,
  InboundMessageHandler, NormalizedInboundMessage, OutboundMessagePayload, SendMessageResult
} from './adapter.js';
import { normalizeUpsert } from './event-normalizer.js';
import { summarizeGroupMetadata } from './group-metadata.js';

export interface BaileysWhatsAppAdapterOptions {
  sendTimeoutMs?: number;
  sleep?: (milliseconds: number) => Promise<void>;
  random?: () => number;
}

export class BaileysWhatsAppAdapter implements IWhatsAppAdapter {
  private readonly logger;
  private readonly sendTimeoutMs: number;
  private readonly sleep: (milliseconds: number) => Promise<void>;
  private readonly random: () => number;
  private readonly messageHandlers: InboundMessageHandler[] = [];
  private readonly connectionHandlers: ConnectionChangeHandler[] = [];
  private socket: WASocket | null = null;
  private status: ConnectionStatus = 'close';
  private reconnectAttempt = 0;
  private reconnecting = false;
  private stopped = true;

  constructor(
    private readonly config: Pick<EnvConfig, 'WHATSAPP_AUTH_DIR' | 'MAX_MEDIA_BYTES' | 'LOG_LEVEL' | 'NODE_ENV'>,
    options: BaileysWhatsAppAdapterOptions = {}
  ) {
    this.logger = createLogger(config);
    this.sendTimeoutMs = options.sendTimeoutMs ?? 30_000;
    this.sleep = options.sleep ?? ((milliseconds) => new Promise(resolve => setTimeout(resolve, milliseconds)));
    this.random = options.random ?? Math.random;
  }

  async connect(): Promise<void> {
    if (!this.stopped && this.socket) return;
    this.stopped = false;
    await this.openSocket();
  }

  async disconnect(): Promise<void> {
    this.stopped = true;
    this.reconnecting = false;
    const socket = this.socket;
    this.socket = null;
    if (socket) socket.end(undefined);
    this.setStatus('close');
  }

  getConnectionStatus(): ConnectionStatus { return this.status; }
  getBotJid(): string | null { return this.socket?.user?.id ?? null; }
  onMessage(handler: InboundMessageHandler): void { this.messageHandlers.push(handler); }
  onConnectionChange(handler: ConnectionChangeHandler): void { this.connectionHandlers.push(handler); }

  async sendMessage(targetGroupJid: string, payload: OutboundMessagePayload): Promise<SendMessageResult> {
    if (!isJidGroup(targetGroupJid)) {
      throw new WhatsAppInvalidInputError(`Invalid target group JID: ${targetGroupJid}`);
    }
    const socket = this.socket;
    if (!socket || this.status !== 'open') {
      throw new WhatsAppTransientError('WhatsApp socket is not open');
    }
    const content = payload.type === 'TEXT'
      ? { text: payload.text }
      : { image: payload.imageBuffer, mimetype: payload.mimeType, ...(payload.caption ? { caption: payload.caption } : {}) };
    try {
      const result = await this.withTimeout(socket.sendMessage(targetGroupJid, content), this.sendTimeoutMs);
      const outgoingMessageId = result?.key?.id;
      if (!outgoingMessageId) throw new WhatsAppTransientError('WhatsApp returned no outgoing message ID');
      const acknowledgedAt = new Date();
      return { outgoingMessageId, acknowledgedAtIso: acknowledgedAt.toISOString() };
    } catch (error) {
      if (error instanceof WhatsAppAmbiguousTimeoutError || error instanceof WhatsAppTransientError || error instanceof WhatsAppInvalidInputError) throw error;
      const statusCode = error instanceof Boom ? error.output.statusCode : undefined;
      if (statusCode === 401 || statusCode === 403) throw new WhatsAppPermanentError('WhatsApp rejected the outbound message', { cause: error });
      throw new WhatsAppTransientError('WhatsApp send failed before acknowledgement', { cause: error });
    }
  }

  async getGroupMetadata(groupJid: string): Promise<GroupMetadataSummary> {
    if (!isJidGroup(groupJid)) throw new WhatsAppInvalidInputError(`Invalid group JID: ${groupJid}`);
    if (!this.socket || this.status !== 'open') throw new WhatsAppTransientError('WhatsApp socket is not open');
    try {
      return summarizeGroupMetadata(await this.socket.groupMetadata(groupJid), this.getBotJid());
    } catch (error) {
      throw new WhatsAppTransientError('Unable to retrieve WhatsApp group metadata', { cause: error });
    }
  }

  private async openSocket(): Promise<void> {
    const { state, saveCreds } = await useMultiFileAuthState(this.config.WHATSAPP_AUTH_DIR);
    const socket = makeWASocket({
      auth: state,
      printQRInTerminal: false,
      markOnlineOnConnect: false,
      syncFullHistory: false
    });
    this.socket = socket;
    socket.ev.on('creds.update', saveCreds);
    socket.ev.on('messages.upsert', (upsert) => {
      void this.handleUpsert(socket, upsert).catch(error => {
        this.logger.error({
          errorCode: error instanceof Error ? error.name : 'WHATSAPP_UPSERT_ERROR'
        }, 'WhatsApp upsert handling failed');
      });
    });
    socket.ev.on('connection.update', (update) => { void this.handleConnectionUpdate(update); });
    this.setStatus('connecting');
  }

  private async handleUpsert(socket: WASocket, upsert: { messages: WAMessage[]; type: string }): Promise<void> {
    if (upsert.type !== 'notify') return;
    for (const message of upsert.messages) {
      try {
        if (!message.key.remoteJid || !isJidGroup(message.key.remoteJid) || message.key.fromMe || !message.message) continue;
        const content = normalizeMessageContent(message.message);
        const image = content?.imageMessage;
        const buffers: Record<string, Buffer> = {};
        if (image && message.key.id) {
          buffers[message.key.id] = await downloadMediaMessage(
            message, 'buffer', {}, { logger: socket.logger, reuploadRequest: socket.updateMediaMessage }
          );
        }
        const normalized = normalizeUpsert(
          { messages: [{ ...message, message: content }], type: 'notify' },
          buffers,
          { maxMediaBytes: this.config.MAX_MEDIA_BYTES }
        );
        for (const item of normalized) {
          for (const handler of this.messageHandlers) await handler(item);
        }
      } catch (error) {
        this.logger.error({
          messageId: message.key.id ?? undefined,
          errorCode: error instanceof Error ? error.name : 'WHATSAPP_MESSAGE_ERROR'
        }, 'WhatsApp inbound message handling failed');
      }
    }
  }

  private async handleConnectionUpdate(update: { connection?: 'open' | 'connecting' | 'close'; lastDisconnect?: { error?: Error } }): Promise<void> {
    if (update.connection === 'open') {
      this.reconnectAttempt = 0;
      this.setStatus('open');
      return;
    }
    if (update.connection !== 'close' || this.stopped) return;
    const statusCode = update.lastDisconnect?.error instanceof Boom
      ? update.lastDisconnect.error.output.statusCode
      : undefined;
    if (statusCode === DisconnectReason.loggedOut) {
      this.setStatus('logged_out', 'logged_out');
      this.logger.fatal({ statusCode }, 'WhatsApp logged out; automatic reconnection halted');
      return;
    }
    this.setStatus('close', `disconnect_${statusCode ?? 'unknown'}`);
    await this.scheduleReconnect();
  }

  private async scheduleReconnect(): Promise<void> {
    if (this.reconnecting || this.stopped) return;
    this.reconnecting = true;
    const delayMs = Math.min(60_000, 1000 * (2 ** this.reconnectAttempt) + Math.floor(this.random() * 1000));
    this.reconnectAttempt = Math.min(this.reconnectAttempt + 1, 6);
    this.logger.warn({ delayMs, attempt: this.reconnectAttempt }, 'WhatsApp reconnect scheduled');
    await this.sleep(delayMs);
    this.reconnecting = false;
    if (!this.stopped) await this.openSocket();
  }

  private setStatus(status: ConnectionStatus, reason?: string): void {
    this.status = status;
    for (const handler of this.connectionHandlers) handler(status, reason);
  }

  private async withTimeout<T>(operation: Promise<T>, timeoutMs: number): Promise<T> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    try {
      return await Promise.race([
        operation,
        new Promise<T>((_, reject) => {
          timer = setTimeout(() => reject(new WhatsAppAmbiguousTimeoutError()), timeoutMs);
        })
      ]);
    } finally {
      if (timer) clearTimeout(timer);
    }
  }
}
