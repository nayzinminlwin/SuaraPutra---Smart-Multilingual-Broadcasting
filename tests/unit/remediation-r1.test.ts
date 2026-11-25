import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { createApplication } from '../../src/app.js';
import { MockModelProvider, type ModelGenerateRequest } from '../../src/ai/model-provider.js';
import type { EnvConfig } from '../../src/config/env.js';
import { DatabaseClient } from '../../src/database/client.js';
import { MigrationRunner } from '../../src/database/migrator.js';
import { MockWhatsAppAdapter } from '../../src/whatsapp/mock-adapter.js';

const source = '120000000001@g.us';
const destinations = {
  ms: '120000000002@g.us',
  en: '120000000003@g.us',
  'zh-CN': '120000000004@g.us',
  ta: '120000000005@g.us'
} as const;

describe('remediation R1 foundation fixes', () => {
  const directories: string[] = [];
  const applications: Array<ReturnType<typeof createApplication>> = [];
  const clients: DatabaseClient[] = [];

  afterEach(async () => {
    for (const application of applications.splice(0)) await application.stop();
    for (const client of clients.splice(0)) client.close();
    vi.useRealTimers();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function createDirectory(prefix: string): string {
    const directory = mkdtempSync(join(tmpdir(), prefix));
    directories.push(directory);
    return directory;
  }

  function config(directory: string, overrides: Partial<EnvConfig> = {}): EnvConfig {
    return {
      NODE_ENV: 'test',
      LOG_LEVEL: 'error',
      DATABASE_URL: join(directory, 'automation.sqlite'),
      MEDIA_STORAGE_DIR: join(directory, 'media'),
      WHATSAPP_ADAPTER_MODE: 'mock',
      WHATSAPP_AUTH_DIR: join(directory, 'auth'),
      WHATSAPP_SOURCE_GROUP_JID: source,
      WHATSAPP_MALAY_GROUP_JID: destinations.ms,
      WHATSAPP_ENGLISH_GROUP_JID: destinations.en,
      WHATSAPP_MANDARIN_GROUP_JID: destinations['zh-CN'],
      WHATSAPP_TAMIL_GROUP_JID: destinations.ta,
      AI_PROVIDER: 'mock',
      AI_MODEL: 'test-model',
      AI_API_KEY: 'test-key',
      ANNOUNCEMENT_SCORE_THRESHOLD: 4,
      CONTEXT_MAX_MESSAGES: 5,
      CONTEXT_WINDOW_SECONDS: 300,
      MAX_CONCURRENT_INGESTIONS: 1,
      MAX_MEDIA_BYTES: 1024 * 1024,
      DELIVERY_POLL_INTERVAL_MS: 10,
      DELIVERY_PACING_MS: 0,
      DELIVERY_SEND_TIMEOUT_MS: 5000,
      DATA_RETENTION_DAYS: 14,
      BROADCAST_KILL_SWITCH: 'false',
      WEB_ADMIN_ENABLED: 'false',
      WEB_ADMIN_PORT: 3000,
      ...overrides
    };
  }

  function modelProvider(): MockModelProvider {
    return new MockModelProvider([({ id, content }: ModelGenerateRequest) => ({
      id,
      score: 8,
      English: content,
      Malay: content,
      Tamil: content,
      Mandarin: content
    })]);
  }

  function textUpsert(messageId: string) {
    return {
      type: 'notify',
      messages: [{
        key: { remoteJid: source, fromMe: false, id: messageId, participant: '60100000001@s.whatsapp.net' },
        messageTimestamp: 1000,
        message: { conversation: 'Notice https://upm.edu.my/notice' }
      }]
    };
  }

  it('does not open the database while constructing the application', () => {
    const directory = createDirectory('suaraputra-r1-constructor-');
    const databasePath = join(directory, 'not-created.sqlite');
    const application = createApplication({
      config: config(directory, { DATABASE_URL: databasePath }),
      adapter: new MockWhatsAppAdapter()
    });
    applications.push(application);

    expect(existsSync(databasePath)).toBe(false);
  });

  it('discovers and applies ordered SQL migrations, including new migration files', () => {
    const directory = createDirectory('suaraputra-r1-migrations-');
    const applicationDatabase = new DatabaseClient(join(directory, 'application.sqlite'));
    clients.push(applicationDatabase);
    new MigrationRunner(applicationDatabase).migrate();
    expect(applicationDatabase.prepare('SELECT version FROM _migrations ORDER BY version').all()).toEqual([
      { version: '001_initial_schema' },
      { version: '002_delivery_attempts' }
    ]);

    const migrations = join(directory, 'migrations');
    mkdirSync(migrations);
    writeFileSync(join(migrations, '001_first.sql'), `
      CREATE TABLE migration_order (version TEXT NOT NULL);
      INSERT INTO migration_order (version) VALUES ('001');
    `);
    writeFileSync(join(migrations, '002_second.sql'), `
      INSERT INTO migration_order (version) VALUES ('002');
    `);
    writeFileSync(join(migrations, '003_remediation.sql'), `
      INSERT INTO migration_order (version) VALUES ('003');
    `);
    writeFileSync(join(migrations, '004-not-a-migration.txt'), 'invalid SQL');
    const client = new DatabaseClient(join(directory, 'test.sqlite'));
    clients.push(client);
    const runner = new MigrationRunner(client, undefined, migrations);

    runner.migrate();
    runner.migrate();

    expect(client.prepare('SELECT version FROM migration_order ORDER BY rowid').all()).toEqual([
      { version: '001' },
      { version: '002' },
      { version: '003' }
    ]);
    expect(client.prepare('SELECT version FROM _migrations ORDER BY version').all()).toEqual([
      { version: '001_first' },
      { version: '002_second' },
      { version: '003_remediation' }
    ]);
  });

  it('waits for WhatsApp connection before starting automatic dispatch', async () => {
    class GatedAdapter extends MockWhatsAppAdapter {
      private markConnectStarted!: () => void;
      private completeConnection: (() => Promise<void>) | null = null;
      private connected = false;
      sendsBeforeConnection = 0;
      readonly connectStarted = new Promise<void>((resolve) => {
        this.markConnectStarted = resolve;
      });

      override connect(): Promise<void> {
        this.markConnectStarted();
        return new Promise<void>((resolve, reject) => {
          this.completeConnection = async () => {
            try {
              await super.connect();
              this.connected = true;
              resolve();
            } catch (error) {
              reject(error);
            }
          };
        });
      }

      async finishConnecting(): Promise<void> {
        if (!this.completeConnection) throw new Error('Connection has not started');
        await this.completeConnection();
      }

      override async sendMessage(
        targetGroupJid: string,
        payload: Parameters<MockWhatsAppAdapter['sendMessage']>[1]
      ): ReturnType<MockWhatsAppAdapter['sendMessage']> {
        if (!this.connected) this.sendsBeforeConnection += 1;
        return super.sendMessage(targetGroupJid, payload);
      }
    }

    const directory = createDirectory('suaraputra-r1-connect-order-');
    const adapter = new GatedAdapter();
    const application = createApplication({
      config: config(directory),
      adapter,
      modelProvider: modelProvider()
    });
    applications.push(application);

    const starting = application.start();
    await adapter.connectStarted;
    await adapter.injectSyntheticUpsert(textUpsert('connect-order'));
    await new Promise((resolve) => setTimeout(resolve, 50));
    expect(adapter.getSentMessages()).toHaveLength(0);

    await adapter.finishConnecting();
    await starting;
    for (let attempt = 0; attempt < 50 && adapter.getSentMessages().length < 4; attempt += 1) {
      await new Promise((resolve) => setTimeout(resolve, 10));
    }
    expect(adapter.sendsBeforeConnection).toBe(0);
    expect(adapter.getSentMessages()).toHaveLength(4);
  });

  it('disconnects and prevents retry after startup fails', async () => {
    class FailingAdapter extends MockWhatsAppAdapter {
      connectCalls = 0;
      disconnectCalls = 0;

      override async connect(): Promise<void> {
        this.connectCalls += 1;
        throw new Error('synthetic connection failure');
      }

      override async disconnect(): Promise<void> {
        this.disconnectCalls += 1;
        await super.disconnect();
      }
    }

    const directory = createDirectory('suaraputra-r1-start-failure-');
    const adapter = new FailingAdapter();
    const application = createApplication({
      config: config(directory),
      adapter,
      startDeliveryLoop: false
    });
    applications.push(application);

    await expect(application.start()).rejects.toThrow('synthetic connection failure');
    expect(adapter.disconnectCalls).toBe(1);
    await expect(application.start()).rejects.toThrow('create a new application instance');
    expect(adapter.connectCalls).toBe(1);
  });

  it('evicts tracers once they are five minutes old', async () => {
    vi.useFakeTimers();
    const directory = createDirectory('suaraputra-r1-tracer-ttl-');
    const adapter = new MockWhatsAppAdapter();
    const application = createApplication({
      config: config(directory),
      adapter,
      modelProvider: modelProvider(),
      startDeliveryLoop: false
    });
    applications.push(application);

    await application.start();
    await adapter.injectSyntheticUpsert(textUpsert('tracer-ttl'));
    const row = application.database.database.prepare('SELECT id FROM announcements').get() as { id: string };
    expect(application.getPipelineTracer(row.id)).toBeDefined();

    await vi.advanceTimersByTimeAsync(299_999);
    expect(application.getPipelineTracer(row.id)).toBeDefined();
    await vi.advanceTimersByTimeAsync(1);
    expect(application.getPipelineTracer(row.id)).toBeUndefined();
  });
});
