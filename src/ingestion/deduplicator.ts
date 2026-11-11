import { sha256Hex } from '../shared/crypto.js';
import type { SourceMessageRepository } from '../database/repositories/source-message.repo.js';
import type { NormalizedInboundMessage } from '../whatsapp/adapter.js';

export class MessageDeduplicator {
  constructor(private readonly sources: SourceMessageRepository) {}

  isDuplicate(message: NormalizedInboundMessage): boolean {
    return this.sources.exists(message.chatJid, message.messageId);
  }

  contentHash(message: NormalizedInboundMessage): string {
    const normalizeWhitespace = (value: string): string => value.trim().replace(/\s+/g, ' ');
    const mediaHash = message.media?.fileSha256Hex ??
      (message.media?.buffer ? sha256Hex(message.media.buffer) : '');
    if (message.kind === 'IMAGE_ONLY') return sha256Hex(mediaHash);
    if (message.kind === 'IMAGE_CAPTION') {
      return sha256Hex(`${mediaHash}:${normalizeWhitespace(message.text ?? '')}`);
    }
    return sha256Hex(normalizeWhitespace(message.text ?? ''));
  }
}
