import { DuplicateRecordError } from '../../shared/errors.js';
import type { SourceMessage, SourceMessageInput } from '../../shared/types.js';
import type { DatabaseClient } from '../client.js';

type SourceRow = {
  id: string; chat_jid: string; message_id: string; sender_jid: string; sender_push_name: string | null;
  timestamp_ms: number; message_kind: SourceMessageInput['messageKind']; text_content: string | null;
  content_hash: string; quoted_message_id: string | null; quoted_participant_jid: string | null;
  quoted_text: string | null; media_local_path: string | null; media_mime_type: string | null;
  media_sha256_hex: string | null; raw_payload_json: string; ingestion_seq: number; ingested_at: string;
};

function map(row: SourceRow): SourceMessage {
  return {
    id: row.id,
    chatJid: row.chat_jid,
    messageId: row.message_id,
    senderJid: row.sender_jid,
    senderPushName: row.sender_push_name,
    timestampMs: row.timestamp_ms,
    messageKind: row.message_kind,
    textContent: row.text_content,
    contentHash: row.content_hash,
    quotedMessageId: row.quoted_message_id,
    quotedParticipantJid: row.quoted_participant_jid,
    quotedText: row.quoted_text,
    mediaLocalPath: row.media_local_path,
    mediaMimeType: row.media_mime_type,
    mediaSha256Hex: row.media_sha256_hex,
    rawPayloadJson: row.raw_payload_json,
    ingestionSeq: row.ingestion_seq,
    ingestedAt: row.ingested_at
  };
}

export class SourceMessageRepository {
  constructor(private readonly client: DatabaseClient) {}

  insert(input: SourceMessageInput): SourceMessage {
    try {
      const result = this.client.prepare(`
        INSERT INTO source_messages
        (id, chat_jid, message_id, sender_jid, sender_push_name, timestamp_ms, message_kind,
         text_content, content_hash, quoted_message_id, quoted_participant_jid, quoted_text,
         media_local_path, media_mime_type, media_sha256_hex, raw_payload_json)
        VALUES (@id, @chatJid, @messageId, @senderJid, @senderPushName, @timestampMs, @messageKind,
          @textContent, @contentHash, @quotedMessageId, @quotedParticipantJid, @quotedText,
          @mediaLocalPath, @mediaMimeType, @mediaSha256Hex, @rawPayloadJson)
      `).run({
        id: input.id, chatJid: input.chatJid, messageId: input.messageId, senderJid: input.senderJid,
        senderPushName: input.senderPushName ?? null, timestampMs: input.timestampMs, messageKind: input.messageKind,
        textContent: input.textContent ?? null, contentHash: input.contentHash,
        quotedMessageId: input.quotedMessageId ?? null, quotedParticipantJid: input.quotedParticipantJid ?? null,
        quotedText: input.quotedText ?? null, mediaLocalPath: input.mediaLocalPath ?? null,
        mediaMimeType: input.mediaMimeType ?? null, mediaSha256Hex: input.mediaSha256Hex ?? null,
        rawPayloadJson: input.rawPayloadJson
      });
      return this.findById(input.id) ?? (() => { throw new Error('Inserted source message could not be read'); })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new DuplicateRecordError('source message', `${input.chatJid}:${input.messageId}`);
      }
      throw error;
    }
  }

  exists(chatJid: string, messageId: string): boolean {
    return Boolean(this.client.prepare(
      'SELECT 1 FROM source_messages WHERE chat_jid = ? AND message_id = ?'
    ).get(chatJid, messageId));
  }

  findById(id: string): SourceMessage | null {
    const row = this.client.prepare('SELECT * FROM source_messages WHERE id = ?').get(id) as SourceRow | undefined;
    return row ? map(row) : null;
  }

  findRecent(chatJid: string, fromTimestampMs: number, limit: number, toTimestampMs = Number.MAX_SAFE_INTEGER): SourceMessage[] {
    const rows = this.client.prepare(`
      SELECT * FROM source_messages
      WHERE chat_jid = ? AND timestamp_ms >= ? AND timestamp_ms <= ?
      ORDER BY timestamp_ms ASC, ingestion_seq ASC LIMIT ?
    `).all(chatJid, fromTimestampMs, toTimestampMs, limit) as SourceRow[];
    return rows.map(map);
  }

  findQuoted(chatJid: string, messageId: string): SourceMessage | null {
    const row = this.client.prepare(
      'SELECT * FROM source_messages WHERE chat_jid = ? AND message_id = ?'
    ).get(chatJid, messageId) as SourceRow | undefined;
    return row ? map(row) : null;
  }

  pruneBefore(ingestedAtIso: string): number {
    return this.client.prepare(
      'DELETE FROM source_messages WHERE ingested_at < ? AND id NOT IN (SELECT source_message_id FROM announcement_sources)'
    ).run(ingestedAtIso).changes;
  }
}
