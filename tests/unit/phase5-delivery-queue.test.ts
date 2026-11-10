import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { DatabaseClient } from '../../src/database/client.js';
import { MigrationRunner } from '../../src/database/migrator.js';
import { AnnouncementRepository } from '../../src/database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../../src/database/repositories/delivery-job.repo.js';
import { EventLogRepository } from '../../src/database/repositories/event-log.repo.js';
import { SourceMessageRepository } from '../../src/database/repositories/source-message.repo.js';
import { TranslationRepository } from '../../src/database/repositories/translation.repo.js';
import { DeliveryDispatcher } from '../../src/delivery/dispatcher.js';
import { DeliveryQueue } from '../../src/delivery/queue.js';
import { MessageRouter } from '../../src/routing/message-router.js';
import { MockWhatsAppAdapter } from '../../src/whatsapp/mock-adapter.js';
import { PipelineTracer } from '../../src/observability/telemetry.js';
import type { AnnouncementInput, SourceMessageInput } from '../../src/shared/types.js';

const destinations = {
  ms: '120000000002@g.us',
  en: '120000000003@g.us',
  'zh-CN': '120000000004@g.us',
  ta: '120000000005@g.us'
} as const;

describe('Phase 5 delivery queue and dispatcher', () => {
  const resources: Array<{ client: DatabaseClient; directory: string }> = [];

  afterEach(() => {
    for (const resource of resources.splice(0)) {
      resource.client.close();
      rmSync(resource.directory, { recursive: true, force: true });
    }
  });

  function createHarness(options: {
    faultModesByTarget?: Readonly<Record<string, 'TRANSIENT_ERROR' | 'AMBIGUOUS_TIMEOUT'>>;
  } = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-phase5-'));
    const client = new DatabaseClient(join(directory, 'test.sqlite'));
    new MigrationRunner(client).migrate();
    resources.push({ client, directory });
    const queue = new DeliveryQueue(
      client,
      new AnnouncementRepository(client),
      new TranslationRepository(client),
      new DeliveryJobRepository(client),
      destinations,
      new EventLogRepository(client)
    );
    const adapter = new MockWhatsAppAdapter({
      faultModesByTarget: options.faultModesByTarget,
      botJid: '60100000000@s.whatsapp.net'
    });
    return { client, directory, queue, adapter };
  }

  function source(id: string, timestampMs: number): SourceMessageInput {
    return {
      id,
      chatJid: '120000000001@g.us',
      messageId: id,
      senderJid: '60100000001@s.whatsapp.net',
      timestampMs,
      messageKind: 'TEXT',
      textContent: `Synthetic ${id}`,
      contentHash: `hash-${id}`,
      rawPayloadJson: '{}'
    };
  }

  function announcement(id: string, sourceId: string, timestampMs: number, payloadType: 'TEXT' | 'IMAGE_ONLY' = 'TEXT'): AnnouncementInput {
    return {
      id,
      primarySourceMessageId: sourceId,
      sourceTimestampMs: timestampMs,
      classification: 'announcement',
      evaluationScore: 8,
      status: 'processing',
      payloadType
    };
  }

  function persist(harness: ReturnType<typeof createHarness>, value: AnnouncementInput, media?: string) {
    const sources = new SourceMessageRepository(harness.client);
    sources.insert(source(value.primarySourceMessageId, value.sourceTimestampMs));
    return harness.queue.persistAnnouncement({
      announcement: value,
      sources: [{ sourceMessageId: value.primarySourceMessageId, role: 'primary' }],
      translations: (['ms', 'en', 'zh-CN', 'ta'] as const).map((languageCode, index) => ({
        id: `${value.id}-${index}`,
        languageCode,
        content: `Translation ${value.id} ${languageCode}`,
        validationStatus: 'passed' as const
      })),
      mediaLocalPath: media ?? null,
      mediaMimeType: media ? 'image/jpeg' : null
    });
  }

  it('dispatches chronological announcements and language order', async () => {
    const harness = createHarness();
    persist(harness, announcement('later', 'source-later', 2000));
    persist(harness, announcement('first', 'source-first', 1000));

    await new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 }).dispatchUntilIdle();

    expect(harness.adapter.getSentMessages().map((message) => `${message.targetGroupJid}:${message.payload.type}`)).toEqual([
      '120000000002@g.us:TEXT', '120000000003@g.us:TEXT', '120000000004@g.us:TEXT', '120000000005@g.us:TEXT',
      '120000000002@g.us:TEXT', '120000000003@g.us:TEXT', '120000000004@g.us:TEXT', '120000000005@g.us:TEXT'
    ]);
  });

  it('reads image media once and releases the cache after the fourth send', async () => {
    const harness = createHarness();
    const mediaPath = join(harness.directory, 'image.jpg');
    writeFileSync(mediaPath, Buffer.from('synthetic image'));
    const readMedia = vi.fn(async (path: string) => Buffer.from(await import('node:fs/promises').then(fs => fs.readFile(path))));
    persist(harness, announcement('image', 'source-image', 1000, 'IMAGE_ONLY'), mediaPath);
    const dispatcher = new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0, readMedia });

    await dispatcher.dispatchUntilIdle();

    expect(readMedia).toHaveBeenCalledTimes(1);
    expect(dispatcher['mediaCache'].size).toBe(0);
    expect(harness.adapter.getSentMessages()).toHaveLength(4);
  });

  it('retries only the transiently failed language destination', async () => {
    const harness = createHarness({ faultModesByTarget: { [destinations.ta]: 'TRANSIENT_ERROR' } });
    persist(harness, announcement('retry', 'source-retry', 1000));
    const dispatcher = new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 });

    await dispatcher.dispatchUntilIdle();
    expect(harness.client.database.prepare("SELECT status FROM delivery_jobs WHERE language_code = 'ta'").get())
      .toEqual({ status: 'retry_wait' });
    expect(harness.adapter.getSentMessages()).toHaveLength(3);

    harness.client.database.prepare("UPDATE delivery_jobs SET next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now') WHERE language_code = 'ta'").run();
    const faultless = new MockWhatsAppAdapter();
    const retryDispatcher = new DeliveryDispatcher({ adapter: faultless, queue: harness.queue, pacingMs: 0 });
    await retryDispatcher.dispatchUntilIdle();
    expect(faultless.getSentMessages()).toHaveLength(1);
    expect(harness.client.database.prepare("SELECT status FROM delivery_jobs WHERE language_code = 'ta'").get())
      .toEqual({ status: 'sent' });
  });

  it('holds ambiguous sends as uncertain and recovers expired leases as uncertain', async () => {
    const harness = createHarness({ faultModesByTarget: { [destinations.ms]: 'AMBIGUOUS_TIMEOUT' } });
    persist(harness, announcement('uncertain', 'source-uncertain', 1000));
    const dispatcher = new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 });
    await dispatcher.dispatchOnce();
    expect(harness.client.database.prepare("SELECT status FROM delivery_jobs WHERE language_code = 'ms'").get())
      .toEqual({ status: 'uncertain' });
    expect(await dispatcher.dispatchOnce()).toBe('sent');

    persist(harness, announcement('crashed', 'source-crashed', 2000));
    harness.client.database.prepare("UPDATE delivery_jobs SET status = 'sending', lease_expires_at = '2000-01-01T00:00:00.000Z' WHERE announcement_id = 'crashed'").run();
    expect(harness.queue.recoverOrphanedJobs()).toBe(4);
    expect(harness.client.database.prepare("SELECT COUNT(*) AS count FROM delivery_jobs WHERE status = 'uncertain' AND announcement_id = 'crashed'").get())
      .toEqual({ count: 4 });
  });

  it('routes language outputs to trusted configured JIDs with target-bound idempotency', () => {
    const router = new MessageRouter(destinations);
    const jobs = router.createDeliveryJobs({
      announcementId: 'announcement',
      announcementSeq: 1,
      sourceTimestampMs: 1000,
      payloadType: 'TEXT',
      translations: (['ms', 'en', 'zh-CN', 'ta'] as const).map((languageCode) => ({ languageCode, content: languageCode }))
    });
    expect(jobs.map((job) => job.idempotencyKey)).toEqual([
      'announcement:ms:120000000002@g.us',
      'announcement:en:120000000003@g.us',
      'announcement:zh-CN:120000000004@g.us',
      'announcement:ta:120000000005@g.us'
    ]);
  });

  it('closes failed checkpoints and records each send operation as an attempt', async () => {
    const harness = createHarness({ faultModesByTarget: { [destinations.ms]: 'TRANSIENT_ERROR' } });
    persist(harness, announcement('attempts', 'source-attempts', 1000));
    const tracer = new PipelineTracer({
      messageId: 'attempts',
      waSourceSentTimestampMs: 1000
    });
    const dispatcher = new DeliveryDispatcher({
      adapter: harness.adapter,
      queue: harness.queue,
      pacingMs: 0,
      tracerForJob: (job) => job.languageCode === 'ms' ? tracer : undefined
    });

    await dispatcher.dispatchOnce();

    expect(tracer.checkpoints).toEqual(expect.arrayContaining([
      expect.objectContaining({ name: 'CP08_MSG_RECONSTRUCT', outcome: 'completed' }),
      expect.objectContaining({ name: 'CP09_DISPATCH_ms', outcome: 'failed' })
    ]));
    expect(() => tracer.finalizeJourney(Date.now())).toThrow(
      'Cannot finalize journey with failed checkpoints'
    );
    expect(harness.client.database.prepare(`
      SELECT status, failure_kind, attempt_number
      FROM delivery_attempts
      WHERE delivery_job_id = (SELECT id FROM delivery_jobs WHERE language_code = 'ms')
    `).get()).toMatchObject({
      status: 'failed',
      failure_kind: 'transient',
      attempt_number: 1
    });
  });

  it('records successful attempts and does not reopen a failed operation on retry', async () => {
    const harness = createHarness({ faultModesByTarget: { [destinations.ta]: 'TRANSIENT_ERROR' } });
    persist(harness, announcement('attempt-retry', 'source-attempt-retry', 1000));
    const firstDispatcher = new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 });
    await firstDispatcher.dispatchUntilIdle();
    harness.client.database.prepare(`
      UPDATE delivery_jobs
      SET next_attempt_at = strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
      WHERE language_code = 'ta'
    `).run();
    const secondDispatcher = new DeliveryDispatcher({ adapter: new MockWhatsAppAdapter(), queue: harness.queue, pacingMs: 0 });
    await secondDispatcher.dispatchUntilIdle();

    expect(harness.client.database.prepare(`
      SELECT status, attempt_number
      FROM delivery_attempts
      WHERE delivery_job_id = (SELECT id FROM delivery_jobs WHERE language_code = 'ta')
      ORDER BY attempt_number
    `).all()).toEqual([
      { status: 'failed', attempt_number: 1 },
      { status: 'sent', attempt_number: 2 }
    ]);
  });
});
