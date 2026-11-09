import { DuplicateRecordError } from '../../shared/errors.js';
import type { DeliveryJob, DeliveryJobInput, DeliveryStatus } from '../../shared/types.js';
import type { DatabaseClient } from '../client.js';

type DeliveryRow = {
  id: string; announcement_id: string; announcement_seq: number; source_timestamp_ms: number;
  language_code: DeliveryJobInput['languageCode']; language_order: 1 | 2 | 3 | 4;
  target_group_jid: string; payload_type: DeliveryJobInput['payloadType']; text_content: string | null;
  media_local_path: string | null; media_mime_type: string | null; idempotency_key: string;
  status: DeliveryStatus; attempts: number; max_attempts: number; next_attempt_at: string;
  lease_owner: string | null; lease_expires_at: string | null; outgoing_message_id: string | null;
  last_error_code: string | null; last_error_message: string | null; created_at: string;
  sent_at: string | null; updated_at: string;
};
function map(row: DeliveryRow): DeliveryJob {
  return {
    id: row.id, announcementId: row.announcement_id, announcementSeq: row.announcement_seq,
    sourceTimestampMs: row.source_timestamp_ms, languageCode: row.language_code,
    languageOrder: row.language_order, targetGroupJid: row.target_group_jid,
    payloadType: row.payload_type, textContent: row.text_content,
    mediaLocalPath: row.media_local_path, mediaMimeType: row.media_mime_type,
    idempotencyKey: row.idempotency_key, status: row.status, attempts: row.attempts,
    maxAttempts: row.max_attempts, nextAttemptAt: row.next_attempt_at, leaseOwner: row.lease_owner,
    leaseExpiresAt: row.lease_expires_at, outgoingMessageId: row.outgoing_message_id,
    lastErrorCode: row.last_error_code, lastErrorMessage: row.last_error_message,
    createdAt: row.created_at, sentAt: row.sent_at, updatedAt: row.updated_at
  };
}

export class DeliveryJobRepository {
  constructor(private readonly client: DatabaseClient) {}

  insert(input: DeliveryJobInput): DeliveryJob {
    try {
      this.insertRaw(input);
      return this.findById(input.id) ?? (() => { throw new Error('Inserted delivery job could not be read'); })();
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: delivery_jobs.idempotency_key')) {
        throw new DuplicateRecordError('delivery idempotency key', input.idempotencyKey);
      }
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed: delivery_jobs.id')) {
        throw new DuplicateRecordError('delivery job', input.id);
      }
      throw error;
    }
  }

  insertAtomic(inputs: ReadonlyArray<DeliveryJobInput>): DeliveryJob[] {
    return this.client.transaction(() => inputs.map((input) => this.insert(input)));
  }

  private insertRaw(input: DeliveryJobInput): void {
    this.client.prepare(`
      INSERT INTO delivery_jobs
      (id, announcement_id, announcement_seq, source_timestamp_ms, language_code, language_order,
       target_group_jid, payload_type, text_content, media_local_path, media_mime_type, idempotency_key, status, max_attempts)
      VALUES (@id, @announcementId, @announcementSeq, @sourceTimestampMs, @languageCode, @languageOrder,
       @targetGroupJid, @payloadType, @textContent, @mediaLocalPath, @mediaMimeType, @idempotencyKey, 'pending', @maxAttempts)
    `).run({
      ...input, textContent: input.textContent ?? null, mediaLocalPath: input.mediaLocalPath ?? null,
      mediaMimeType: input.mediaMimeType ?? null, maxAttempts: input.maxAttempts ?? 5
    });
  }

  findById(id: string): DeliveryJob | null {
    const row = this.client.prepare('SELECT * FROM delivery_jobs WHERE id = ?').get(id) as DeliveryRow | undefined;
    return row ? map(row) : null;
  }

  pollNext(): DeliveryJob | null {
    const row = this.client.prepare(`
      SELECT * FROM delivery_jobs
      WHERE status IN ('pending', 'retry_wait')
        AND next_attempt_at <= strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      ORDER BY source_timestamp_ms ASC, announcement_seq ASC, language_order ASC LIMIT 1
    `).get() as DeliveryRow | undefined;
    return row ? map(row) : null;
  }

  claimNext(leaseOwner: string, leaseSeconds = 45): DeliveryJob | null {
    return this.client.transaction(() => {
      const job = this.pollNext();
      if (!job) return null;
      const result = this.client.prepare(`
        UPDATE delivery_jobs
        SET status = 'sending', attempts = attempts + 1, lease_owner = ?,
            lease_expires_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now', ?), updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
        WHERE id = ? AND status IN ('pending', 'retry_wait')
      `).run(leaseOwner, `+${leaseSeconds} seconds`, job.id);
      return result.changes === 1 ? this.findById(job.id) : null;
    });
  }

  markSent(id: string, outgoingMessageId: string): void {
    this.transition(id, `
      status = 'sent', outgoing_message_id = ?, sent_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now'),
      lease_owner = NULL, lease_expires_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `, [outgoingMessageId], ['sending']);
  }

  markFailure(id: string, status: Extract<DeliveryStatus, 'retry_wait' | 'uncertain' | 'failed_permanent'>, code: string, message: string, nextAttemptAt?: string): void {
    this.transition(id, `
      status = ?, last_error_code = ?, last_error_message = ?, next_attempt_at = COALESCE(?, next_attempt_at),
      lease_owner = NULL, lease_expires_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `, [status, code, message, nextAttemptAt ?? null], ['sending']);
  }

  recoverExpiredSending(): number {
    return this.client.prepare(`
      UPDATE delivery_jobs SET status = 'uncertain', last_error_code = 'LEASE_EXPIRED_CRASH',
        last_error_message = 'Expired sending lease recovered without automatic resend',
        lease_owner = NULL, lease_expires_at = NULL, updated_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE status = 'sending' AND lease_expires_at < strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
    `).run().changes;
  }

  private transition(id: string, assignments: string, parameters: unknown[], allowedStatuses: DeliveryStatus[]): void {
    const result = this.client.prepare(
      `UPDATE delivery_jobs SET ${assignments} WHERE id = ? AND status IN (${allowedStatuses.map(() => '?').join(', ')})`
    ).run(...parameters, id, ...allowedStatuses);
    if (result.changes !== 1) throw new Error(`Delivery job not found: ${id}`);
  }
}
