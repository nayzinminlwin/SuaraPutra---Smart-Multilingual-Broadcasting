import { WhatsAppInvalidInputError } from './errors.js';
import { PipelineTracer } from '../observability/telemetry.js';
import type { NormalizedInboundMessage, SupportedMessageKind } from './adapter.js';

type JsonRecord = Record<string, unknown>;

export interface NormalizerOptions {
  maxMediaBytes: number;
  allowAppend?: boolean;
}

const isRecord = (value: unknown): value is JsonRecord =>
  typeof value === 'object' && value !== null && !Array.isArray(value);

function stringValue(value: unknown): string | null {
  return typeof value === 'string' && value.trim() ? value.trim() : null;
}

function unwrap(content: JsonRecord): JsonRecord | null {
  if (isRecord(content.viewOnceMessage) || isRecord(content.viewOnceMessageV2) ||
      isRecord(content.viewOnceMessageV2Extension)) {
    return null;
  }
  for (const wrapper of ['ephemeralMessage', 'documentWithCaptionMessage']) {
    const wrapped = content[wrapper];
    if (isRecord(wrapped) && isRecord(wrapped.message)) return wrapped.message;
  }
  return content;
}

function extractText(content: JsonRecord): string | null {
  const conversation = stringValue(content.conversation);
  if (conversation) return conversation;
  const extended = isRecord(content.extendedTextMessage) ? content.extendedTextMessage : null;
  return extended ? stringValue(extended.text) : null;
}

function contextFor(content: JsonRecord): JsonRecord | null {
  if (isRecord(content.extendedTextMessage) && isRecord(content.extendedTextMessage.contextInfo)) {
    return content.extendedTextMessage.contextInfo;
  }
  if (isRecord(content.imageMessage) && isRecord(content.imageMessage.contextInfo)) {
    return content.imageMessage.contextInfo;
  }
  return null;
}

function quotedText(quoted: unknown): string | null {
  return isRecord(quoted) ? extractText(quoted) ??
    (isRecord(quoted.imageMessage) ? stringValue(quoted.imageMessage.caption) : null) : null;
}

function timestampMs(value: unknown): number {
  const seconds = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(seconds) && seconds >= 0 ? Math.trunc(seconds * 1000) : 0;
}

function hashFromWire(value: unknown): string | null {
  if (typeof value !== 'string' || value.length === 0) return null;
  try {
    return Buffer.from(value, 'base64').toString('hex');
  } catch {
    return null;
  }
}

function normalizeMessage(
  raw: JsonRecord,
  mediaBuffers: Readonly<Record<string, Buffer>>,
  options: NormalizerOptions
): NormalizedInboundMessage | null {
  const key = isRecord(raw.key) ? raw.key : null;
  const chatJid = stringValue(key?.remoteJid);
  const messageId = stringValue(key?.id);
  if (!chatJid || !chatJid.endsWith('@g.us') || !messageId) return null;
  const rawContent = isRecord(raw.message) ? raw.message : null;
  if (!rawContent) return null;
  const content = unwrap(rawContent);
  if (!content) return null;

  const image = isRecord(content.imageMessage) ? content.imageMessage : null;
  const extended = isRecord(content.extendedTextMessage) ? content.extendedTextMessage : null;
  const text = image ? stringValue(image.caption) : extractText(content);
  let kind: SupportedMessageKind = 'UNSUPPORTED';
  let media: NormalizedInboundMessage['media'] = null;

  if (text !== null) kind = 'TEXT';
  if (image) {
    const declaredLength = image.fileLength === undefined ? null : Number(image.fileLength);
    if (declaredLength !== null && (!Number.isFinite(declaredLength) || declaredLength > options.maxMediaBytes)) {
      throw new WhatsAppInvalidInputError(`Image exceeds configured media limit for message ${messageId}`);
    }
    const buffer = mediaBuffers[messageId] ?? null;
    if (buffer && buffer.byteLength > options.maxMediaBytes) {
      throw new WhatsAppInvalidInputError(`Downloaded image exceeds configured media limit for message ${messageId}`);
    }
    kind = text ? 'IMAGE_CAPTION' : 'IMAGE_ONLY';
    media = {
      mimeType: stringValue(image.mimetype) ?? 'application/octet-stream',
      fileSha256Hex: hashFromWire(image.fileSha256),
      fileLengthBytes: declaredLength ?? buffer?.byteLength ?? null,
      buffer
    };
  }

  const context = contextFor(content);
  return {
    chatJid,
    messageId,
    senderJid: stringValue(key?.participant) ?? chatJid,
    senderPushName: stringValue(raw.pushName),
    fromMe: key?.fromMe === true,
    timestampMs: timestampMs(raw.messageTimestamp),
    kind,
    text,
    quotedMessageId: stringValue(context?.stanzaId),
    quotedParticipantJid: stringValue(context?.participant),
    quotedText: quotedText(context?.quotedMessage),
    media,
    rawPayloadJson: JSON.stringify(raw)
  };
}

export function normalizeUpsert(
  rawUpsert: unknown,
  mediaBuffers: Readonly<Record<string, Buffer>> = {},
  options: NormalizerOptions
): NormalizedInboundMessage[] {
  if (!Number.isFinite(options.maxMediaBytes) || options.maxMediaBytes <= 0) {
    throw new WhatsAppInvalidInputError('maxMediaBytes must be a positive finite number');
  }
  if (!isRecord(rawUpsert) || !Array.isArray(rawUpsert.messages)) {
    throw new WhatsAppInvalidInputError('Invalid WhatsApp upsert payload');
  }
  const type = rawUpsert.type;
  if (type !== 'notify' && !(options.allowAppend && type === 'append')) return [];
  const messages = rawUpsert.messages.filter(isRecord).sort((a, b) =>
    timestampMs(a.messageTimestamp) - timestampMs(b.messageTimestamp));
  const normalized: NormalizedInboundMessage[] = [];
  for (const message of messages) {
    const messageId = isRecord(message.key) && typeof message.key.id === 'string' ? message.key.id : 'unknown';
    const tracer = new PipelineTracer({
      messageId,
      waSourceSentTimestampMs: timestampMs(message.messageTimestamp)
    });
    tracer.startCheckpoint('CP01_INGEST_NORMALIZE');
    try {
      const result = normalizeMessage(message, mediaBuffers, options);
      tracer.endCheckpoint('CP01_INGEST_NORMALIZE', {
        t_wa_source_sent_ms: timestampMs(message.messageTimestamp)
      });
      if (result) normalized.push({ ...result, tracer });
    } catch (error) {
      console.error(`[TRACE:${tracer.traceId}] [CP01_INGEST_NORMALIZE] FAILED`, {
        messageId,
        error: error instanceof Error ? error.message : 'unknown error'
      });
      throw error;
    }
  }
  return normalized;
}
