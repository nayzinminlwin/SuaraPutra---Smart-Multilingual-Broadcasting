import { mkdir, readdir, stat, unlink } from 'node:fs/promises';
import { join } from 'node:path';
import type { EnvConfig } from '../config/env.js';
import type { DatabaseClient } from '../database/client.js';
import type { DeliveryJobRepository } from '../database/repositories/delivery-job.repo.js';
import type { SourceMessageRepository } from '../database/repositories/source-message.repo.js';
import type { IWhatsAppAdapter } from '../whatsapp/adapter.js';

export type HealthSnapshot = Readonly<{
  status: 'ok' | 'degraded';
  whatsapp: ReturnType<IWhatsAppAdapter['getConnectionStatus']>;
  delivery: { pending: number; retrying: number; uncertain: number; failed: number; oldestPendingAgeMs: number | null };
  lastSuccessfulDelivery: string | null;
}>;

export class HealthMonitor {
  constructor(
    private readonly client: DatabaseClient,
    private readonly adapter: IWhatsAppAdapter,
    private readonly jobs: DeliveryJobRepository,
    private readonly sources: SourceMessageRepository,
    private readonly config: Pick<EnvConfig, 'MEDIA_STORAGE_DIR' | 'DATA_RETENTION_DAYS'>
  ) {}

  snapshot(): HealthSnapshot {
    const rows = this.client.database.prepare(`
      SELECT
        SUM(status = 'pending') AS pending,
        SUM(status = 'retry_wait') AS retrying,
        SUM(status = 'uncertain') AS uncertain,
        SUM(status = 'failed_permanent') AS failed,
        MIN(CASE WHEN status IN ('pending', 'retry_wait') THEN created_at END) AS oldest_pending,
        MAX(sent_at) AS last_sent
      FROM delivery_jobs
    `).get() as {
      pending: number | null; retrying: number | null; uncertain: number | null; failed: number | null;
      oldest_pending: string | null; last_sent: string | null;
    };
    const oldestPendingAgeMs = rows.oldest_pending
      ? Math.max(0, Date.now() - Date.parse(rows.oldest_pending))
      : null;
    const whatsapp = this.adapter.getConnectionStatus();
    return {
      status: whatsapp === 'open' && (rows.uncertain ?? 0) === 0 ? 'ok' : 'degraded',
      whatsapp,
      delivery: {
        pending: rows.pending ?? 0,
        retrying: rows.retrying ?? 0,
        uncertain: rows.uncertain ?? 0,
        failed: rows.failed ?? 0,
        oldestPendingAgeMs
      },
      lastSuccessfulDelivery: rows.last_sent
    };
  }

  async runRetention(): Promise<{ deletedMediaFiles: number; prunedSourceRows: number }> {
    const cutoff = new Date(Date.now() - this.config.DATA_RETENTION_DAYS * 86_400_000);
    let deletedMediaFiles = 0;
    await mkdir(this.config.MEDIA_STORAGE_DIR, { recursive: true });
    for (const name of await readdir(this.config.MEDIA_STORAGE_DIR)) {
      const path = join(this.config.MEDIA_STORAGE_DIR, name);
      const file = await stat(path);
      if (file.isFile() && file.mtimeMs < cutoff.getTime()) {
        await unlink(path);
        deletedMediaFiles += 1;
      }
    }
    const prunedSourceRows = this.sources.pruneBefore(cutoff.toISOString());
    return { deletedMediaFiles, prunedSourceRows };
  }

  recoverDeliveryLeases(): number {
    return this.jobs.recoverExpiredSending();
  }
}
