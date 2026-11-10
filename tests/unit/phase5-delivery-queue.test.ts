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
import { RetryPolicy } from '../../src/delivery/retry-policy.js';
import { WhatsAppTransientError } from '../../src/whatsapp/errors.js';
import { DeliveryRecoveryScheduler } from '../../src/delivery/recovery-scheduler.js';
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

  function announcement(
    id: string,
    sourceId: string,
    timestampMs: number,
    payloadType: 'TEXT' | 'IMAGE_CAPTION' | 'IMAGE_ONLY' = 'TEXT'
  ): AnnouncementInput {
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

  it('blocks a later job for the same destination behind active earlier work', () => {
    const harness = createHarness();
    persist(harness, announcement('first-fifo', 'source-first-fifo', 1000));
    persist(harness, announcement('second-fifo', 'source-second-fifo', 2000));
    harness.client.database.prepare(`
      UPDATE delivery_jobs
      SET target_group_jid = ?
      WHERE announcement_id IN ('first-fifo', 'second-fifo') AND language_code = 'ms'
    `).run('shared-target@g.us');
    harness.client.database.prepare(`
      UPDATE delivery_jobs SET status = 'sent'
      WHERE language_code <> 'ms'
    `).run();

    expect(harness.queue.claimNext('fifo-worker')?.announcementId).toBe('first-fifo');
    expect(harness.queue.claimNext('fifo-worker')).toBeNull();
  });

  it('allows another destination to progress while one destination is blocked', () => {
    const harness = createHarness();
    persist(harness, announcement('first-independent', 'source-first-independent', 1000));
    persist(harness, announcement('second-independent', 'source-second-independent', 2000));
    harness.client.database.prepare(`
      UPDATE delivery_jobs
      SET target_group_jid = ?
      WHERE announcement_id IN ('first-independent', 'second-independent') AND language_code = 'ms'
    `).run('shared-target@g.us');
    harness.client.database.prepare(`
      UPDATE delivery_jobs
      SET status = 'retry_wait', next_attempt_at = '2999-01-01T00:00:00.000Z'
      WHERE announcement_id = 'first-independent' AND language_code = 'ms'
    `).run();

    const claimed = harness.queue.claimNext('fifo-worker');
    expect(claimed?.targetGroupJid).not.toBe('shared-target@g.us');
    expect(claimed?.announcementId).toBe('first-independent');
    expect(claimed?.languageCode).toBe('en');
  });

  it('does not let terminal or uncertain jobs block later work for the same destination', () => {
    const harness = createHarness();
    persist(harness, announcement('first-terminal', 'source-first-terminal', 1000));
    persist(harness, announcement('second-terminal', 'source-second-terminal', 2000));
    harness.client.database.prepare(`
      UPDATE delivery_jobs
      SET target_group_jid = ?
      WHERE announcement_id IN ('first-terminal', 'second-terminal') AND language_code = 'ms'
    `).run('shared-target@g.us');
    harness.client.database.prepare(`
      UPDATE delivery_jobs SET status = 'sent'
      WHERE announcement_id = 'first-terminal'
    `).run();
    expect(harness.queue.claimNext('fifo-worker')?.announcementId).toBe('second-terminal');

    const third = announcement('third-uncertain', 'source-third-uncertain', 3000);
    const fourth = announcement('fourth-uncertain', 'source-fourth-uncertain', 4000);
    persist(harness, third);
    persist(harness, fourth);
    harness.client.database.prepare(`
      UPDATE delivery_jobs
      SET target_group_jid = ?
      WHERE announcement_id IN ('third-uncertain', 'fourth-uncertain') AND language_code = 'ms'
    `).run('uncertain-target@g.us');
    harness.client.database.prepare(`
      UPDATE delivery_jobs SET status = 'uncertain', lease_owner = NULL, lease_expires_at = NULL
      WHERE announcement_id = 'third-uncertain'
    `).run();
    harness.client.database.prepare(`
      UPDATE delivery_jobs SET status = 'sent'
      WHERE announcement_id = 'second-terminal'
    `).run();
    expect(harness.queue.claimNext('fifo-worker')?.announcementId).toBe('fourth-uncertain');
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

  it('reconstructs image captions and preserves the translated caption', async () => {
    const harness = createHarness();
    const mediaPath = join(harness.directory, 'caption.jpg');
    writeFileSync(mediaPath, Buffer.from('synthetic caption image'));
    persist(harness, announcement('caption', 'source-caption', 1000, 'IMAGE_CAPTION'), mediaPath);

    await new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 }).dispatchOnce();

    expect(harness.adapter.getSentMessages()[0]?.payload).toMatchObject({
      type: 'IMAGE',
      caption: 'Translation caption ms'
    });
  });

  it('keeps queued work untouched when the delivery kill switch is active', async () => {
    const harness = createHarness();
    persist(harness, announcement('paused', 'source-paused', 1000));
    const dispatcher = new DeliveryDispatcher({
      adapter: harness.adapter,
      queue: harness.queue,
      pacingMs: 0,
      killSwitch: true
    });

    expect(await dispatcher.dispatchOnce()).toBe('paused');
    expect(harness.adapter.getSentMessages()).toHaveLength(0);
    expect(harness.client.database.prepare(`
      SELECT COUNT(*) AS count FROM delivery_jobs WHERE status = 'pending'
    `).get()).toEqual({ count: 4 });
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

  it('uses deterministic 0-3 second jitter within the approved backoff bounds', () => {
    const policy = new RetryPolicy({ random: () => 0 });
    expect(policy.decide({ attempts: 1, maxAttempts: 5 }, new WhatsAppTransientError('temporary')).backoffMs)
      .toBe(5000);
    expect(new RetryPolicy({ random: () => 0.999999 }).decide(
      { attempts: 1, maxAttempts: 5 }, new WhatsAppTransientError('temporary')
    ).backoffMs).toBe(7999);
    expect(new RetryPolicy({ random: () => 0 }).decide(
      { attempts: 2, maxAttempts: 5 }, new WhatsAppTransientError('temporary')
    ).backoffMs).toBe(10000);
    expect(new RetryPolicy({ random: () => 0.999999 }).decide(
      { attempts: 3, maxAttempts: 5 }, new WhatsAppTransientError('temporary')
    ).backoffMs).toBe(22999);
    expect(new RetryPolicy({ random: () => 0 }).decide(
      { attempts: 4, maxAttempts: 5 }, new WhatsAppTransientError('temporary')
    ).backoffMs).toBe(40000);
  });

  it('records safe retry decision logs for retryable and terminal outcomes', async () => {
    const harness = createHarness({ faultModesByTarget: { [destinations.ta]: 'TRANSIENT_ERROR' } });
    persist(harness, announcement('retry-log', 'source-retry-log', 1000));
    await new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 }).dispatchUntilIdle();

    const event = harness.client.database.prepare(`
      SELECT event_type, details_json
      FROM event_logs
      WHERE event_type = 'DELIVERY_RETRY_DECISION'
      ORDER BY id DESC LIMIT 1
    `).get() as { event_type: string; details_json: string };
    expect(event.event_type).toBe('DELIVERY_RETRY_DECISION');
    expect(JSON.parse(event.details_json)).toMatchObject({
      attemptNumber: 1,
      maxAttempts: 5,
      decision: 'retry_wait',
      errorCode: 'TRANSIENT_SEND_FAILURE',
      backoffMs: expect.any(Number)
    });
    expect(JSON.parse(event.details_json)).not.toHaveProperty('message');
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

  it('rejects incomplete or failed translations before queue insertion', () => {
    const harness = createHarness();
    const value = announcement('invalid-translations', 'source-invalid-translations', 1000);
    const sources = new SourceMessageRepository(harness.client);
    sources.insert(source(value.primarySourceMessageId, value.sourceTimestampMs));
    const tracer = new PipelineTracer({
      messageId: value.primarySourceMessageId,
      waSourceSentTimestampMs: value.sourceTimestampMs
    });

    expect(() => harness.queue.persistAnnouncement({
      announcement: value,
      sources: [{ sourceMessageId: value.primarySourceMessageId, role: 'primary' }],
      tracer,
      translations: [{
        id: 'invalid-ms',
        languageCode: 'ms',
        content: 'Rejected',
        validationStatus: 'failed',
        validationErrorsJson: '["missing URL"]'
      }]
    })).toThrow('did not pass validation');
    expect(tracer.checkpoints).toEqual([
      expect.objectContaining({ name: 'CP07_QUEUE_PERSIST', outcome: 'failed' })
    ]);
    expect(harness.client.database.prepare('SELECT COUNT(*) AS count FROM delivery_jobs').get())
      .toEqual({ count: 0 });
  });

  it('allows empty captions for image-only queue payloads', () => {
    const harness = createHarness();
    const value = announcement('image-only-empty', 'source-image-only-empty', 1000, 'IMAGE_ONLY');
    const sources = new SourceMessageRepository(harness.client);
    sources.insert(source(value.primarySourceMessageId, value.sourceTimestampMs));

    const result = harness.queue.persistAnnouncement({
      announcement: value,
      sources: [{ sourceMessageId: value.primarySourceMessageId, role: 'primary' }],
      translations: (['ms', 'en', 'zh-CN', 'ta'] as const).map((languageCode, index) => ({
        id: `${value.id}-${index}`,
        languageCode,
        content: '',
        validationStatus: 'passed' as const
      })),
      mediaLocalPath: 'synthetic-image.jpg',
      mediaMimeType: 'image/jpeg'
    });

    expect(result.jobs).toHaveLength(4);
  });

  it('converts invalid persisted payloads to permanent failures without sending', async () => {
    const harness = createHarness();
    persist(harness, announcement('invalid-persisted', 'source-invalid-persisted', 1000));
    harness.client.database.prepare(`
      UPDATE delivery_jobs SET text_content = NULL
      WHERE announcement_id = 'invalid-persisted' AND language_code = 'ms'
    `).run();

    const dispatcher = new DeliveryDispatcher({ adapter: harness.adapter, queue: harness.queue, pacingMs: 0 });
    await dispatcher.dispatchOnce();

    expect(harness.adapter.getSentMessages()).toHaveLength(0);
    expect(harness.client.database.prepare(`
      SELECT status, last_error_code
      FROM delivery_jobs
      WHERE announcement_id = 'invalid-persisted' AND language_code = 'ms'
    `).get()).toEqual({
      status: 'failed_permanent',
      last_error_code: 'INVALID_DELIVERY_PAYLOAD'
    });
    expect(harness.client.database.prepare(`
      SELECT status, failure_kind
      FROM delivery_attempts
      WHERE delivery_job_id = (
        SELECT id FROM delivery_jobs
        WHERE announcement_id = 'invalid-persisted' AND language_code = 'ms'
      )
    `).get()).toEqual({ status: 'failed', failure_kind: 'invalid' });
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

  it('does not convert post-send journey finalization errors into delivery failures', async () => {
    const harness = createHarness();
    persist(harness, announcement('finalize-error', 'source-finalize-error', 1000));
    const tracer = new PipelineTracer({
      messageId: 'finalize-error',
      waSourceSentTimestampMs: 1000
    });
    vi.spyOn(tracer, 'finalizeJourney').mockImplementation(() => {
      throw new Error('synthetic telemetry failure');
    });
    const dispatcher = new DeliveryDispatcher({
      adapter: harness.adapter,
      queue: harness.queue,
      pacingMs: 0,
      tracerForJob: (job) => job.languageOrder === 4 ? tracer : undefined
    });

    await dispatcher.dispatchUntilIdle(3);
    await expect(dispatcher.dispatchOnce()).rejects.toThrow('synthetic telemetry failure');
    expect(harness.client.database.prepare(`
      SELECT status FROM delivery_jobs
      WHERE announcement_id = 'finalize-error' AND language_order = 4
    `).get()).toEqual({ status: 'sent' });
    expect(harness.client.database.prepare(`
      SELECT status FROM delivery_attempts
      WHERE delivery_job_id = (
        SELECT id FROM delivery_jobs
        WHERE announcement_id = 'finalize-error' AND language_order = 4
      )
    `).get()).toEqual({ status: 'sent' });
  });

  it('records a successful recovery check when no leases are orphaned', () => {
    const harness = createHarness();
    expect(harness.queue.recoverOrphanedJobs()).toBe(0);
    expect(harness.client.database.prepare(`
      SELECT details_json FROM event_logs
      WHERE event_type = 'DELIVERY_LEASE_RECOVERY'
      ORDER BY id DESC LIMIT 1
    `).get()).toMatchObject({
      details_json: JSON.stringify({
        recovered: 0,
        outcome: 'none',
        automaticRetry: false
      })
    });
  });

  it('runs recovery before scheduling and clears its interval on shutdown', () => {
    const harness = createHarness();
    const setIntervalMock = vi.fn((callback: () => void, _intervalMs: number) => {
      callback();
      return 1 as unknown as ReturnType<typeof setInterval>;
    });
    const clearIntervalMock = vi.fn();
    const recover = vi.spyOn(harness.queue, 'recoverOrphanedJobs').mockReturnValue(2);
    const scheduler = new DeliveryRecoveryScheduler(harness.queue, {
      intervalMs: 60_000,
      setInterval: setIntervalMock,
      clearInterval: clearIntervalMock
    });

    expect(scheduler.start()).toBe(2);
    expect(recover).toHaveBeenCalledTimes(2);
    expect(setIntervalMock).toHaveBeenCalledWith(expect.any(Function), 60_000);
    expect(scheduler.isRunning).toBe(true);

    scheduler.stop();
    expect(clearIntervalMock).toHaveBeenCalledWith(1);
    expect(scheduler.isRunning).toBe(false);
  });

  it('logs recovery failures without hiding the operational error', () => {
    const harness = createHarness();
    vi.spyOn(harness.queue, 'recoverOrphanedJobs').mockImplementation(() => {
      throw new Error('synthetic recovery failure');
    });
    const scheduler = new DeliveryRecoveryScheduler(harness.queue, {
      setInterval: vi.fn(() => 1 as unknown as ReturnType<typeof setInterval>),
      clearInterval: vi.fn()
    });

    expect(scheduler.start()).toBe(0);
    expect(harness.client.database.prepare(`
      SELECT event_type, details_json FROM event_logs
      WHERE event_type = 'DELIVERY_RECOVERY_FAILED'
    `).get()).toMatchObject({ event_type: 'DELIVERY_RECOVERY_FAILED' });
  });
});
