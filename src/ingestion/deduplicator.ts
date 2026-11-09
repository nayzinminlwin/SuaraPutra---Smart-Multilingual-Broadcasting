import { sha256Hex } from '../shared/crypto.js';
import type { SourceMessageRepository } from '../database/repositories/source-message.repo.js';
import type { NormalizedInboundMessage } from '../whatsapp/adapter.js';

export class MessageDeduplicator {
  constructor(private readonly sources: SourceMessageRepository) {}

  isDuplicate(message: NormalizedInboundMessage): boolean {
    return this.sources.exists(message.chatJid, message.messageId);
  }

  contentHash(message: NormalizedInboundMessage): string {
    const mediaHash = message.media?.fileSha256Hex ??
      (message.media?.buffer ? sha256Hex(message.media.buffer) : '');
    return sha256Hex([
      message.chatJid,
      message.messageId,
      message.kind,
      message.text ?? '',
      mediaHash
    ].join('\u001f'));
  }
}
