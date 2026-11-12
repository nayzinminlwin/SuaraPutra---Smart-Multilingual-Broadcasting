import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../src/app.js';
import { MockModelProvider } from '../../src/ai/model-provider.js';
import { MockWhatsAppAdapter } from '../../src/whatsapp/mock-adapter.js';
import type { ModelGenerateRequest } from '../../src/ai/model-provider.js';

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
      config: {
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
        WEB_ADMIN_ENABLED: 'false', WEB_ADMIN_PORT: 3000
      },
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
});
