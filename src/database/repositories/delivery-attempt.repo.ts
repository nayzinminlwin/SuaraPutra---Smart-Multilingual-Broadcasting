import { DuplicateRecordError } from '../../shared/errors.js';
import type {
  DeliveryAttempt, DeliveryAttemptFailureKind, DeliveryAttemptInput, DeliveryAttemptStatus
} from '../../shared/types.js';
import type { DatabaseClient } from '../client.js';

type DeliveryAttemptRow = {
  id: string;
  delivery_job_id: string;
  attempt_number: number;
  status: DeliveryAttemptStatus;
  failure_kind: DeliveryAttemptFailureKind;
  error_code: string | null;
  error_message: string | null;
  outgoing_message_id: string | null;
  started_at: string;
  completed_at: string | null;
};

function map(row: DeliveryAttemptRow): DeliveryAttempt {
  return {
    id: row.id,
    deliveryJobId: row.delivery_job_id,
    attemptNumber: row.attempt_number,
    status: row.status,
    failureKind: row.failure_kind,
    errorCode: row.error_code,
    errorMessage: row.error_message,
    outgoingMessageId: row.outgoing_message_id,
    startedAt: row.started_at,
    completedAt: row.completed_at
  };
}

export class DeliveryAttemptRepository {
  constructor(private readonly client: DatabaseClient) {}

  start(input: DeliveryAttemptInput): DeliveryAttempt {
    try {
      this.client.prepare(`
        INSERT INTO delivery_attempts
          (id, delivery_job_id, attempt_number, status)
        VALUES (?, ?, ?, 'started')
      `).run(input.id, input.deliveryJobId, input.attemptNumber);
    } catch (error) {
      if (error instanceof Error && error.message.includes('UNIQUE constraint failed')) {
        throw new DuplicateRecordError(
          'delivery attempt',
          `${input.deliveryJobId}:${input.attemptNumber}`
        );
      }
      throw error;
    }
    return this.findById(input.id) ?? (() => {
      throw new Error(`Inserted delivery attempt could not be read: ${input.id}`);
    })();
  }

  markSent(id: string, outgoingMessageId: string): DeliveryAttempt {
    return this.complete(id, 'sent', null, null, null, outgoingMessageId);
  }

  markFailed(
    id: string,
    failureKind: Exclude<DeliveryAttemptFailureKind, null>,
    errorCode: string,
    errorMessage: string
  ): DeliveryAttempt {
    return this.complete(id, 'failed', failureKind, errorCode, errorMessage, null);
  }

  markUncertain(
    id: string,
    failureKind: Extract<DeliveryAttemptFailureKind, 'ambiguous'>,
    errorCode: string,
    errorMessage: string
  ): DeliveryAttempt {
    return this.complete(id, 'uncertain', failureKind, errorCode, errorMessage, null);
  }

  findById(id: string): DeliveryAttempt | null {
    const row = this.client.prepare(
      'SELECT * FROM delivery_attempts WHERE id = ?'
    ).get(id) as DeliveryAttemptRow | undefined;
    return row ? map(row) : null;
  }

  listForJob(deliveryJobId: string): DeliveryAttempt[] {
    const rows = this.client.prepare(`
      SELECT * FROM delivery_attempts
      WHERE delivery_job_id = ?
      ORDER BY attempt_number ASC
    `).all(deliveryJobId) as DeliveryAttemptRow[];
    return rows.map(map);
  }

  markStartedAsUncertainForJob(
    deliveryJobId: string,
    errorCode: string,
    errorMessage: string
  ): number {
    const result = this.client.prepare(`
      UPDATE delivery_attempts
      SET status = 'uncertain', failure_kind = 'ambiguous', error_code = ?,
          error_message = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE delivery_job_id = ? AND status = 'started'
    `).run(errorCode, errorMessage, deliveryJobId);
    return result.changes;
  }

  private complete(
    id: string,
    status: Extract<DeliveryAttemptStatus, 'sent' | 'failed' | 'uncertain'>,
    failureKind: DeliveryAttemptFailureKind,
    errorCode: string | null,
    errorMessage: string | null,
    outgoingMessageId: string | null
  ): DeliveryAttempt {
    const result = this.client.prepare(`
      UPDATE delivery_attempts
      SET status = ?, failure_kind = ?, error_code = ?, error_message = ?,
          outgoing_message_id = ?, completed_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE id = ? AND status = 'started'
    `).run(status, failureKind, errorCode, errorMessage, outgoingMessageId, id);
    if (result.changes !== 1) {
      throw new Error(`Started delivery attempt not found: ${id}`);
    }
    return this.findById(id) ?? (() => {
      throw new Error(`Completed delivery attempt could not be read: ${id}`);
    })();
  }
}
