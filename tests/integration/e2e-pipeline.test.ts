import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../src/app.js';
import { MockModelProvider } from '../../src/ai/model-provider.js';
import { MockWhatsAppAdapter } from '../../src/whatsapp/mock-adapter.js';
import type { ModelGenerateRequest } from '../../src/ai/model-provider.js';
import type { OutboundMessagePayload, SendMessageResult } from '../../src/whatsapp/adapter.js';
import type { EnvConfig } from '../../src/config/env.js';

const source = '120000000001@g.us';
const destinations = {
  ms: '120000000002@g.us',
  en: '120000000003@g.us',
  'zh-CN': '120000000004@g.us',
  ta: '120000000005@g.us'
} as const;

describe('Phase 6 end-to-end pipeline', () => {
  const directories: string[] = [];
  const applications: Array<{ stop(): Promise<void> }> = [];

  afterEach(async () => {
    for (const application of applications.splice(0)) await application.stop();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function config(directory: string, overrides: Partial<EnvConfig> = {}): EnvConfig {
    return {
      NODE_ENV: 'test', LOG_LEVEL: 'error', DATABASE_URL: join(directory, 'automation.sqlite'),
      MEDIA_STORAGE_DIR: join(directory, 'media'), WHATSAPP_ADAPTER_MODE: 'mock',
      WHATSAPP_AUTH_DIR: join(directory, 'auth'), WHATSAPP_SOURCE_GROUP_JID: source,
      WHATSAPP_MALAY_GROUP_JID: destinations.ms, WHATSAPP_ENGLISH_GROUP_JID: destinations.en,
      WHATSAPP_MANDARIN_GROUP_JID: destinations['zh-CN'], WHATSAPP_TAMIL_GROUP_JID: destinations.ta,
      AI_PROVIDER: 'mock', AI_MODEL: 'test-model', AI_API_KEY: 'test-key',
      ANNOUNCEMENT_SCORE_THRESHOLD: 4, CONTEXT_MAX_MESSAGES: 5, CONTEXT_WINDOW_SECONDS: 300,
      MAX_CONCURRENT_INGESTIONS: 1, MAX_MEDIA_BYTES: 1024 * 1024,
      DELIVERY_POLL_INTERVAL_MS: 200, DELIVERY_PACING_MS: 0, DELIVERY_SEND_TIMEOUT_MS: 5000,
      DATA_RETENTION_DAYS: 14, BROADCAST_KILL_SWITCH: 'false',
      WEB_ADMIN_ENABLED: 'false', WEB_ADMIN_PORT: 3000,
      ...overrides
    };
  }

  function textUpsert(messageId: string, timestampSeconds: number, text: string) {
    return {
      type: 'notify',
      messages: [{
        key: { remoteJid: source, fromMe: false, id: messageId, participant: `${messageId}@s.whatsapp.net` },
        messageTimestamp: timestampSeconds,
        message: { conversation: text }
      }]
    };
  }

  function validResponse(request: ModelGenerateRequest, content = request.content) {
    return {
      id: request.id, score: 8,
      English: `English ${content}`, Malay: `Malay ${content}`,
      Tamil: `Tamil ${content}`, Mandarin: `Mandarin ${content}`
    };
  }

  it('processes all 11 synthetic fixtures through mock transport and dispatch', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-phase6-'));
    directories.push(directory);
    const adapter = new MockWhatsAppAdapter({ maxMediaBytes: 1024 * 1024 });
    const model = new MockModelProvider([({ id, type, content }: ModelGenerateRequest) => ({
      id,
      score: content.startsWith('Thanks!') ? 2 : type === 'TEXT CAPTION FROM IMAGE' ? 10 : 8,
      English: content.startsWith('Thanks!') ? null : content,
      Malay: content.startsWith('Thanks!') ? null : content,
      Tamil: content.startsWith('Thanks!') ? null : content,
      Mandarin: content.startsWith('Thanks!') ? null : content
    })]);
    const app = createApplication({
      config: config(directory),
      adapter, modelProvider: model, startDeliveryLoop: false
    });
    applications.push(app);

    const retention = vi.spyOn(app.health, 'runRetention');
    await app.start();
    expect(retention).toHaveBeenCalledTimes(1);
    for (let fixture = 1; fixture <= 11; fixture += 1) {
      const fixtureName = `${String(fixture).padStart(2, '0')}_`;
      const file = (await import('node:fs/promises')).readdir(join(process.cwd(), 'tests', 'fixtures', 'baileys-events'))
        .then(files => files.find(name => name.startsWith(fixtureName)));
      const fileName = await file;
      if (!fileName) throw new Error(`Missing fixture ${fixtureName}`);
      const raw = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'baileys-events', fileName), 'utf8')) as {
        messages?: Array<{ key?: { id?: string }; message?: { imageMessage?: unknown } }>;
      };
      const mediaBuffers = Object.fromEntries(
        (raw.messages ?? [])
          .filter(message => message.message?.imageMessage && message.key?.id)
          .map(message => [message.key?.id as string, Buffer.from(`synthetic-media-${message.key?.id}`)])
      );
      await adapter.injectSyntheticUpsert(raw, mediaBuffers);
    }
    await app.dispatcher.dispatchUntilIdle();

    expect(model.requests).toHaveLength(10);
    expect(adapter.getSentMessages().every(message => destinations[Object.keys(destinations).find(
      language => destinations[language as keyof typeof destinations] === message.targetGroupJid
    ) as keyof typeof destinations] === message.targetGroupJid)).toBe(true);
    expect(adapter.getSentMessages().length).toBe(44);
    expect(app.health.snapshot().delivery.uncertain).toBe(0);
    await app.stop();
  });

  it('E2E-02 persists provider failure and continues with the next FIFO message', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-e2e-02-'));
    directories.push(directory);
    const providerError = Object.assign(new Error('Gemini returned HTTP 503'), { status: 503 });
    const model = new MockModelProvider([
      validResponse
    ], [providerError, providerError, providerError]);
    const adapter = new MockWhatsAppAdapter();
    const app = createApplication({ config: config(directory), adapter, modelProvider: model, startDeliveryLoop: false });
    applications.push(app);
    await app.start();

    await adapter.injectSyntheticUpsert(textUpsert('provider-failure', 1000, 'First notice https://upm.edu.my/first'));
    await adapter.injectSyntheticUpsert(textUpsert('after-provider-failure', 2000, 'Second notice https://upm.edu.my/second'));

    const held = app.database.database.prepare(
      'SELECT id, status, primary_source_message_id FROM announcements WHERE status = ?'
    ).get('held_validation_failed') as { id: string; status: string; primary_source_message_id: string };
    expect(held.status).toBe('held_validation_failed');
    expect(app.database.database.prepare(
      'SELECT role FROM announcement_sources WHERE announcement_id = ? AND source_message_id = ?'
    ).get(held.id, held.primary_source_message_id)).toEqual({ role: 'primary' });
    expect(app.database.database.prepare(
      'SELECT COUNT(*) AS count FROM delivery_jobs WHERE announcement_id = ?'
    ).get(held.id)).toEqual({ count: 0 });
    expect(app.database.database.prepare(
      'SELECT COUNT(*) AS count FROM delivery_jobs'
    ).get()).toEqual({ count: 4 });
    expect(model.requests).toHaveLength(4);
    expect(app.database.database.prepare(
      'SELECT COUNT(*) AS count FROM event_logs WHERE event_type = ? AND level = ? AND details_json LIKE ?'
    ).get('AI_PROCESS_FAILED', 'ERROR', '%503%')).toEqual({ count: 1 });
  });

  it('E2E-03 persists held validation failure and failed translations', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-e2e-03-'));
    directories.push(directory);
    const invalidResponse = (request: ModelGenerateRequest) => ({
      ...validResponse(request),
      English: 'English https://mutated.example/register',
      Malay: 'Malay https://mutated.example/register',
      Tamil: 'Tamil https://mutated.example/register',
      Mandarin: 'Mandarin https://mutated.example/register'
    });
    const model = new MockModelProvider([invalidResponse, invalidResponse]);
    const adapter = new MockWhatsAppAdapter();
    const app = createApplication({ config: config(directory), adapter, modelProvider: model, startDeliveryLoop: false });
    applications.push(app);
    await app.start();

    await adapter.injectSyntheticUpsert(textUpsert(
      'validation-failure', 1000, 'Register here: https://source.example/register'
    ));

    const held = app.database.database.prepare(
      'SELECT id, status FROM announcements WHERE status = ?'
    ).get('held_validation_failed') as { id: string; status: string };
    expect(held.status).toBe('held_validation_failed');
    expect(app.database.database.prepare(
      'SELECT COUNT(*) AS count FROM translations WHERE announcement_id = ? AND validation_status = ?'
    ).get(held.id, 'failed')).toEqual({ count: 4 });
    expect(app.database.database.prepare(
      'SELECT COUNT(*) AS count FROM delivery_jobs WHERE announcement_id = ?'
    ).get(held.id)).toEqual({ count: 0 });
  });

  it('E2E-04 reorders separate pending upsert batches by timestamp', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-e2e-04-'));
    directories.push(directory);
    let calls = 0;
    let markFirstCalled: (() => void) | undefined;
    const firstCalled = new Promise<void>(resolve => { markFirstCalled = resolve; });
    let releaseFirst: (() => void) | undefined;
    const firstRelease = new Promise<void>(resolve => { releaseFirst = resolve; });
    const model = new MockModelProvider([async (request: ModelGenerateRequest) => {
      calls += 1;
      if (calls === 1) {
        markFirstCalled?.();
        await firstRelease;
        return validResponse(request);
      }
      return validResponse(request);
    }]);
    const adapter = new MockWhatsAppAdapter();
    const app = createApplication({ config: config(directory), adapter, modelProvider: model, startDeliveryLoop: false });
    applications.push(app);
    await app.start();

    const first = adapter.injectSyntheticUpsert(textUpsert('fifo-first', 1, 'First https://upm.edu.my/first'));
    await firstCalled;
    const batchA = adapter.injectSyntheticUpsert(textUpsert('fifo-late', 3, 'Late https://upm.edu.my/late'));
    const batchB = adapter.injectSyntheticUpsert(textUpsert('fifo-middle', 2, 'Middle https://upm.edu.my/middle'));
    releaseFirst?.();
    await Promise.all([first, batchA, batchB]);

    expect(app.database.database.prepare(
      'SELECT message_id FROM source_messages ORDER BY ingestion_seq ASC'
    ).all()).toEqual([
      { message_id: 'fifo-first' },
      { message_id: 'fifo-middle' },
      { message_id: 'fifo-late' }
    ]);
  });

  it('E2E-05 records a unified CP01-CP09 journey summary', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-e2e-05-'));
    directories.push(directory);
    const model = new MockModelProvider([validResponse]);
    const adapter = new MockWhatsAppAdapter();
    const app = createApplication({ config: config(directory), adapter, modelProvider: model, startDeliveryLoop: false });
    applications.push(app);
    const summaryLog = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    try {
      await app.start();
      await adapter.injectSyntheticUpsert(textUpsert('journey', 1, 'Journey https://upm.edu.my/journey'));
      await app.dispatcher.dispatchUntilIdle();

      const announcement = app.database.database.prepare('SELECT id FROM announcements').get() as { id: string };
      const tracer = app.getPipelineTracer(announcement.id);
      const checkpoints = tracer?.getCheckpoints().map(checkpoint => checkpoint.name);
      expect(checkpoints?.slice(0, 7)).toEqual([
        'CP01_INGEST_NORMALIZE', 'CP02_FIFO_WAIT', 'CP03_GATE_CHECKS', 'CP04_CONTEXT_ASSEMBLY',
        'CP05_AI_PROCESS', 'CP06_VALIDATION', 'CP07_QUEUE_PERSIST'
      ]);
      expect(checkpoints?.filter(name => name === 'CP08_MSG_RECONSTRUCT')).toHaveLength(4);
      expect(checkpoints).toEqual(expect.arrayContaining([
        'CP09_DISPATCH_ms', 'CP09_DISPATCH_en', 'CP09_DISPATCH_zh-CN', 'CP09_DISPATCH_ta'
      ]));
      expect(summaryLog).toHaveBeenCalledWith(
        expect.stringContaining('[JOURNEY_SUMMARY]'),
        expect.objectContaining({ totalPipelineUs: expect.any(Number) })
      );
    } finally {
      summaryLog.mockRestore();
    }
  });

  it('E2E-06 drains an in-flight send before disconnecting', async () => {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-e2e-06-'));
    directories.push(directory);
    class TrackingAdapter extends MockWhatsAppAdapter {
      private markSendStarted!: () => void;
      readonly sendStarted = new Promise<void>(resolve => { this.markSendStarted = resolve; });
      sendCompleted = false;
      disconnectedAfterSend = false;

      override async sendMessage(targetGroupJid: string, payload: OutboundMessagePayload): Promise<SendMessageResult> {
        this.markSendStarted();
        const result = await super.sendMessage(targetGroupJid, payload);
        this.sendCompleted = true;
        return result;
      }

      override async disconnect(): Promise<void> {
        this.disconnectedAfterSend = this.sendCompleted;
        await super.disconnect();
      }
    }
    const adapter = new TrackingAdapter({ latencyMs: 200 });
    const app = createApplication({ config: config(directory), adapter, modelProvider: new MockModelProvider([validResponse]), startDeliveryLoop: false });
    applications.push(app);
    await app.start();
    await adapter.injectSyntheticUpsert(textUpsert('shutdown-send', 1, 'Shutdown https://upm.edu.my/shutdown'));
    const dispatch = app.dispatcher.dispatchOnce();
    await adapter.sendStarted;
    await app.stop();
    await dispatch;
    expect(adapter.sendCompleted).toBe(true);
    expect(adapter.disconnectedAfterSend).toBe(true);
  });
});
