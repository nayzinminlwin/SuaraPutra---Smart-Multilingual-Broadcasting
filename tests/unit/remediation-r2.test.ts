import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import pino from 'pino';
import { createApplication } from '../../src/app.js';
import { getSafeConfig, parseEnv, type EnvConfig } from '../../src/config/env.js';
import { DatabaseClient } from '../../src/database/client.js';
import { MigrationRunner } from '../../src/database/migrator.js';
import { SourceMessageRepository } from '../../src/database/repositories/source-message.repo.js';
import { logSafeConfig } from '../../src/observability/logger.js';
import { MockWhatsAppAdapter } from '../../src/whatsapp/mock-adapter.js';

const source = '120000000001@g.us';
const destinations = {
  ms: '120000000002@g.us',
  en: '120000000003@g.us',
  'zh-CN': '120000000004@g.us',
  ta: '120000000005@g.us'
} as const;

describe('remediation R2 dependency injection and config contracts', () => {
  const directories: string[] = [];
  const applications: Array<ReturnType<typeof createApplication>> = [];
  const clients: DatabaseClient[] = [];

  afterEach(async () => {
    for (const application of applications.splice(0)) await application.stop();
    for (const client of clients.splice(0)) client.close();
    vi.restoreAllMocks();
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function createDirectory(): string {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-r2-'));
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
      AI_API_KEY: 'test-key-not-for-logs',
      ANNOUNCEMENT_SCORE_THRESHOLD: 4,
      CONTEXT_MAX_MESSAGES: 5,
      CONTEXT_WINDOW_SECONDS: 300,
      MAX_CONCURRENT_INGESTIONS: 1,
      MAX_MEDIA_BYTES: 1024 * 1024,
      DELIVERY_POLL_INTERVAL_MS: 200,
      DELIVERY_PACING_MS: 500,
      DELIVERY_SEND_TIMEOUT_MS: 5000,
      DATA_RETENTION_DAYS: 14,
      BROADCAST_KILL_SWITCH: false,
      WEB_ADMIN_ENABLED: 'false',
      WEB_ADMIN_PORT: 3000,
      ...overrides
    };
  }

  it('uses an injected source repository instead of constructing the default', async () => {
    const directory = createDirectory();
    const injectedClient = new DatabaseClient(join(directory, 'automation.sqlite'));
    clients.push(injectedClient);
    new MigrationRunner(injectedClient).migrate();
    const sources = new SourceMessageRepository(injectedClient);
    const exists = vi.spyOn(sources, 'exists').mockReturnValue(true);
    const adapter = new MockWhatsAppAdapter();
    const application = createApplication({
      config: config(directory),
      dependencies: { sources },
      adapter
    });
    applications.push(application);

    await application.start();
    await adapter.injectSyntheticUpsert({
      type: 'notify',
      messages: [{
        key: { remoteJid: source, fromMe: false, id: 'injected-source', participant: '60100000001@s.whatsapp.net' },
        messageTimestamp: 1000,
        message: { conversation: 'Synthetic duplicate' }
      }]
    });

    expect(exists).toHaveBeenCalledWith(source, 'injected-source');
    expect(application.database.database.prepare('SELECT COUNT(*) AS count FROM source_messages').get())
      .toEqual({ count: 0 });
  });

  it('parses the broadcast kill switch as a boolean for both environment values', () => {
    const common = {
      WHATSAPP_SOURCE_GROUP_JID: source,
      WHATSAPP_MALAY_GROUP_JID: destinations.ms,
      WHATSAPP_ENGLISH_GROUP_JID: destinations.en,
      WHATSAPP_MANDARIN_GROUP_JID: destinations['zh-CN'],
      WHATSAPP_TAMIL_GROUP_JID: destinations.ta,
      AI_API_KEY: 'synthetic-key'
    };

    const defaulted = parseEnv(common);
    const enabled = parseEnv({ ...common, BROADCAST_KILL_SWITCH: 'true' });
    const disabled = parseEnv({ ...common, BROADCAST_KILL_SWITCH: 'false' });

    expect(defaulted.BROADCAST_KILL_SWITCH).toBe(false);
    expect(typeof defaulted.BROADCAST_KILL_SWITCH).toBe('boolean');
    expect(enabled.BROADCAST_KILL_SWITCH).toBe(true);
    expect(typeof enabled.BROADCAST_KILL_SWITCH).toBe('boolean');
    expect(disabled.BROADCAST_KILL_SWITCH).toBe(false);
    expect(typeof disabled.BROADCAST_KILL_SWITCH).toBe('boolean');
  });

  it('passes only safe config fields through the logger data path', async () => {
    const records: string[] = [];
    const destination = new Writable({
      write(chunk: Buffer, _encoding, callback) {
        records.push(chunk.toString('utf8'));
        callback();
      }
    });
    const logger = pino({ level: 'debug' }, destination);
    const parsedConfig = parseEnv({
      WHATSAPP_SOURCE_GROUP_JID: source,
      WHATSAPP_MALAY_GROUP_JID: destinations.ms,
      WHATSAPP_ENGLISH_GROUP_JID: destinations.en,
      WHATSAPP_MANDARIN_GROUP_JID: destinations['zh-CN'],
      WHATSAPP_TAMIL_GROUP_JID: destinations.ta,
      AI_API_KEY: 'must-not-be-logged'
    });

    logSafeConfig(logger, getSafeConfig(parsedConfig));
    await new Promise<void>((resolve) => logger.flush(() => resolve()));

    expect(records.join('')).toContain('Loaded non-secret configuration');
    expect(records.join('')).not.toContain('must-not-be-logged');
  });

  it('wires a boolean kill switch to stop dispatch without dropping pending jobs', async () => {
    const directory = createDirectory();
    const adapter = new MockWhatsAppAdapter();
    const application = createApplication({
      config: config(directory, { BROADCAST_KILL_SWITCH: true }),
      adapter,
      startDeliveryLoop: false
    });
    applications.push(application);

    await application.start();
    await adapter.injectSyntheticUpsert({
      type: 'notify',
      messages: [{
        key: { remoteJid: source, fromMe: false, id: 'kill-switch', participant: '60100000001@s.whatsapp.net' },
        messageTimestamp: 1000,
        message: { conversation: 'Notice https://upm.edu.my/notice' }
      }]
    });

    expect(await application.dispatcher.dispatchOnce()).toBe('paused');
    expect(adapter.getSentMessages()).toHaveLength(0);
    expect(application.database.database.prepare(
      'SELECT COUNT(*) AS count FROM delivery_jobs WHERE status = ?'
    ).get('pending')).toEqual({ count: 4 });
  });
});
