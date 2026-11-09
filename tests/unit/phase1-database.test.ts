import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseClient } from '../../src/database/client.js';
import { MigrationRunner } from '../../src/database/migrator.js';
import { AnnouncementRepository } from '../../src/database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../../src/database/repositories/delivery-job.repo.js';
import { SourceMessageRepository } from '../../src/database/repositories/source-message.repo.js';
import { DuplicateRecordError } from '../../src/shared/errors.js';
import type { AnnouncementInput, DeliveryJobInput, SourceMessageInput } from '../../src/shared/types.js';

const source = (id: string, timestampMs: number): SourceMessageInput => ({
  id, chatJid: '100@g.us', messageId: `wa-${id}`, senderJid: 'person@s.whatsapp.net',
  timestampMs, messageKind: 'TEXT', textContent: `Synthetic ${id}`, contentHash: `hash-${id}`,
  rawPayloadJson: '{}'
});

const announcement = (id: string, sourceId: string, timestampMs: number): AnnouncementInput => ({
  id, primarySourceMessageId: sourceId, sourceTimestampMs: timestampMs,
  classification: 'announcement', evaluationScore: 8, status: 'queued', payloadType: 'TEXT'
});

const job = (id: string, announcementId: string, seq: number, timestampMs: number, languageOrder: 1 | 2 | 3 | 4): DeliveryJobInput => ({
  id, announcementId, announcementSeq: seq, sourceTimestampMs: timestampMs,
  languageCode: (['ms', 'en', 'zh-CN', 'ta'] as const)[languageOrder - 1],
  languageOrder, targetGroupJid: `${languageOrder}@g.us`, payloadType: 'TEXT',
  textContent: `Translation ${id}`, idempotencyKey: `key-${id}`
});

describe('Phase 1 SQLite persistence', () => {
  const resources: Array<{ client: DatabaseClient; directory: string }> = [];

  afterEach(() => {
    for (const resource of resources.splice(0)) {
      resource.client.close();
      rmSync(resource.directory, { recursive: true, force: true });
    }
  });

  function createDatabase(): DatabaseClient {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-phase1-'));
    const client = new DatabaseClient(join(directory, 'test.sqlite'));
    new MigrationRunner(client).migrate();
    resources.push({ client, directory });
    return client;
  }

  it('enables WAL and the required checkpoint pragma', () => {
    const client = createDatabase();
    expect(client.database.pragma('journal_mode', { simple: true })).toBe('wal');
    expect(client.database.pragma('wal_autocheckpoint', { simple: true })).toBe(2000);
    expect(client.database.pragma('foreign_keys', { simple: true })).toBe(1);
  });

  it('assigns monotonic source and announcement sequences and rejects duplicate source identity', () => {
    const client = createDatabase();
    const sources = new SourceMessageRepository(client);
    const announcements = new AnnouncementRepository(client);
    const first = sources.insert(source('source-1', 1000));
    const second = sources.insert(source('source-2', 2000));
    expect(second.ingestionSeq).toBe(first.ingestionSeq + 1);
    expect(() => sources.insert(source('source-duplicate', 3000))).not.toThrow();
    expect(() => sources.insert({ ...source('source-3', 4000), messageId: 'wa-source-1' }))
      .toThrow(DuplicateRecordError);
    const firstAnnouncement = announcements.create(announcement('announcement-1', first.id, 1000));
    const secondAnnouncement = announcements.create(announcement('announcement-2', second.id, 2000));
    expect(secondAnnouncement.announcementSeq).toBe(firstAnnouncement.announcementSeq + 1);
  });

  it('polls delivery jobs in chronological announcement and language order', () => {
    const client = createDatabase();
    const sources = new SourceMessageRepository(client);
    const announcements = new AnnouncementRepository(client);
    const jobs = new DeliveryJobRepository(client);
    sources.insert(source('source-a', 2000));
    sources.insert(source('source-b', 1000));
    const first = announcements.create(announcement('announcement-a', 'source-a', 2000));
    const second = announcements.create(announcement('announcement-b', 'source-b', 1000));
    jobs.insertAtomic([
      job('job-a4', first.id, first.announcementSeq, 2000, 4),
      job('job-b2', second.id, second.announcementSeq, 1000, 2),
      job('job-a1', first.id, first.announcementSeq, 2000, 1),
      job('job-b1', second.id, second.announcementSeq, 1000, 1)
    ]);
    expect([jobs.pollNext()?.id, jobs.pollNext()?.id]).toEqual(['job-b1', 'job-b1']);
    const claimed = jobs.claimNext('test-worker');
    expect(claimed?.id).toBe('job-b1');
    expect(claimed?.status).toBe('sending');
    expect(jobs.pollNext()?.id).toBe('job-b2');
  });

  it('rolls back an atomic four-job insert when one job violates idempotency', () => {
    const client = createDatabase();
    const sources = new SourceMessageRepository(client);
    const announcements = new AnnouncementRepository(client);
    const jobs = new DeliveryJobRepository(client);
    sources.insert(source('source-1', 1000));
    const created = announcements.create(announcement('announcement-1', 'source-1', 1000));
    const inputs = [
      job('job-1', created.id, created.announcementSeq, 1000, 1),
      job('job-2', created.id, created.announcementSeq, 1000, 2),
      job('job-3', created.id, created.announcementSeq, 1000, 3),
      { ...job('job-4', created.id, created.announcementSeq, 1000, 4), idempotencyKey: 'key-job-1' }
    ];
    expect(() => jobs.insertAtomic(inputs)).toThrow(DuplicateRecordError);
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM delivery_jobs').get()).toEqual({ count: 0 });
  });

  it('keeps fresh leases active and refuses terminal delivery transitions from pending', () => {
    const client = createDatabase();
    const sources = new SourceMessageRepository(client);
    const announcements = new AnnouncementRepository(client);
    const jobs = new DeliveryJobRepository(client);
    sources.insert(source('source-1', 1000));
    const created = announcements.create(announcement('announcement-1', 'source-1', 1000));
    jobs.insert(job('job-1', created.id, created.announcementSeq, 1000, 1));

    expect(() => jobs.markSent('job-1', 'outgoing-1')).toThrow('Delivery job not found');
    const claimed = jobs.claimNext('worker-1', 45);
    expect(claimed?.status).toBe('sending');
    expect(claimed?.leaseExpiresAt).toMatch(/T/);
    expect(jobs.recoverExpiredSending()).toBe(0);
    jobs.markSent('job-1', 'outgoing-1');
    expect(jobs.findById('job-1')?.status).toBe('sent');
    expect(jobs.recoverExpiredSending()).toBe(0);
  });
});
