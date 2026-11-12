import { DuplicateRecordError } from '../../shared/errors.js';
import type { Announcement, AnnouncementInput, SourceLinkRole } from '../../shared/types.js';
import type { DatabaseClient } from '../client.js';

type AnnouncementRow = {
  id: string; primary_source_message_id: string; source_timestamp_ms: number;
  classification: AnnouncementInput['classification']; evaluation_score: number;
  status: AnnouncementInput['status']; payload_type: AnnouncementInput['payloadType'];
  media_local_path: string | null; media_mime_type: string | null; raw_ai_response_json: string | null;
  announcement_seq: number; created_at: string; updated_at: string;
};
function map(row: AnnouncementRow): Announcement {
  return {
    id: row.id, primarySourceMessageId: row.primary_source_message_id,
    sourceTimestampMs: row.source_timestamp_ms, classification: row.classification,
    evaluationScore: row.evaluation_score, status: row.status, payloadType: row.payload_type,
    mediaLocalPath: row.media_local_path, mediaMimeType: row.media_mime_type,
    rawAiResponseJson: row.raw_ai_response_json, announcementSeq: row.announcement_seq,
    createdAt: row.created_at, updatedAt: row.updated_at
  };
}

export class AnnouncementRepository {
  constructor(private readonly client: DatabaseClient) {}

  create(input: AnnouncementInput): Announcement {
    try {
      this.client.prepare(`
        INSERT INTO announcements
        (id, primary_source_message_id, source_timestamp_ms, classification, evaluation_score,
         status, payload_type, media_local_path, media_mime_type, raw_ai_response_json)
        VALUES (@id, @primarySourceMessageId, @sourceTimestampMs, @classification, @evaluationScore,
          @status, @payloadType, @mediaLocalPath, @mediaMimeType, @rawAiResponseJson)
      `).run({
        id: input.id, primarySourceMessageId: input.primarySourceMessageId,
        sourceTimestampMs: input.sourceTimestampMs, classification: input.classification,
        evaluationScore: input.evaluationScore, status: input.status, payloadType: input.payloadType,
        mediaLocalPath: input.mediaLocalPath ?? null, mediaMimeType: input.mediaMimeType ?? null,
        rawAiResponseJson: input.rawAiResponseJson ?? null
      });
      return this.findById(input.id) ?? (() => { throw new Error('Inserted announcement could not be read'); })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new DuplicateRecordError('announcement', input.id);
      }
      throw error;
    }
  }

  createWithSources(input: AnnouncementInput, sources: ReadonlyArray<{ sourceMessageId: string; role: SourceLinkRole }>): Announcement {
    return this.client.transaction(() => {
      const announcement = this.create(input);
      const statement = this.client.prepare(
        'INSERT INTO announcement_sources (announcement_id, source_message_id, role) VALUES (?, ?, ?)'
      );
      for (const source of sources) statement.run(input.id, source.sourceMessageId, source.role);
      return announcement;
    });
  }

  findById(id: string): Announcement | null {
    const row = this.client.prepare('SELECT * FROM announcements WHERE id = ?').get(id) as AnnouncementRow | undefined;
    return row ? map(row) : null;
  }

  updateStatus(id: string, status: Announcement['status']): void {
    const result = this.client.prepare(
      "UPDATE announcements SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE id = ?"
    ).run(status, id);
    if (result.changes !== 1) throw new Error(`Announcement not found: ${id}`);
  }

  updateOutcome(
    id: string,
    outcome: Pick<AnnouncementInput, 'classification' | 'evaluationScore' | 'status'> & {
      rawAiResponseJson?: string | null;
    }
  ): void {
    const result = this.client.prepare(`
      UPDATE announcements
      SET classification = ?, evaluation_score = ?, status = ?, raw_ai_response_json = ?,
          updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ?
    `).run(
      outcome.classification,
      outcome.evaluationScore,
      outcome.status,
      outcome.rawAiResponseJson ?? null,
      id
    );
    if (result.changes !== 1) throw new Error(`Announcement not found: ${id}`);
  }

  findInterrupted(olderThanIso?: string): Announcement[] {
    const rows = this.client.prepare(`
      SELECT * FROM announcements
      WHERE status = 'processing'
        AND (? IS NULL OR updated_at < ?)
      ORDER BY source_timestamp_ms ASC, announcement_seq ASC
    `).all(olderThanIso ?? null, olderThanIso ?? null) as AnnouncementRow[];
    return rows.map(map);
  }
}
