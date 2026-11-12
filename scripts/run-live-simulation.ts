import 'dotenv/config';
import { createHash } from 'node:crypto';
import { existsSync } from 'node:fs';
import { mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { parseEnv } from '../src/config/env.js';
import { createApplication } from '../src/app.js';
import { MockWhatsAppAdapter } from '../src/whatsapp/mock-adapter.js';

type JsonRecord = Record<string, unknown>;

const TERMINAL_DELIVERY_STATES = ['sent', 'failed_permanent', 'uncertain', 'cancelled'] as const;

async function main(): Promise<void> {
  const inboxPath = resolveInboxPath(process.argv.slice(2));
  const outboxDir = path.resolve(process.cwd(), 'simulation', 'outbox');
  const config = parseEnv({
    ...process.env,
    ...(process.env.AI_PROVIDER === 'mock' && !process.env.AI_API_KEY
      ? { AI_API_KEY: 'simulation-key' }
      : {})
  });
  const { payload, mediaBuffers, messageCount } = await loadSimulationInput(inboxPath, config.WHATSAPP_SOURCE_GROUP_JID);
  await rm(outboxDir, { recursive: true, force: true });
  await mkdir(outboxDir, { recursive: true });

  const adapter = new MockWhatsAppAdapter({
    maxMediaBytes: config.MAX_MEDIA_BYTES,
    fileOutboxDir: outboxDir,
    groupJidToLanguageMap: {
      [config.WHATSAPP_MALAY_GROUP_JID]: 'ms',
      [config.WHATSAPP_ENGLISH_GROUP_JID]: 'en',
      [config.WHATSAPP_MANDARIN_GROUP_JID]: 'zh-CN',
      [config.WHATSAPP_TAMIL_GROUP_JID]: 'ta'
    }
  });
  const app = createApplication({
    config: {
      ...config,
      DATABASE_URL: path.join(outboxDir, 'simulation.sqlite'),
      MEDIA_STORAGE_DIR: path.join(outboxDir, 'source-media'),
      WHATSAPP_ADAPTER_MODE: 'mock',
      BROADCAST_KILL_SWITCH: 'false'
    },
    adapter,
    startDeliveryLoop: false
  });

  try {
    await app.start();
    await adapter.injectSyntheticUpsert(payload, mediaBuffers);
    await app.dispatcher.dispatchUntilIdle();
    await waitForTerminalDeliveryState(app);
    const report = buildReport(app, messageCount, inboxPath);
    await writeFile(path.join(outboxDir, 'simulation-report.json'), JSON.stringify(report, null, 2), 'utf8');
    console.log(`[SIMULATION] Wrote output to ${outboxDir}`);
  } finally {
    await app.stop();
  }
}

function resolveInboxPath(args: readonly string[]): string {
  const argument = args.find(value => value.startsWith('--inbox='));
  return path.resolve(process.cwd(), argument?.slice('--inbox='.length) ?? 'simulation/inbox/messages.json');
}

async function loadSimulationInput(
  inboxPath: string,
  sourceGroupJid: string
): Promise<{ payload: { type: 'notify'; messages: JsonRecord[] }; mediaBuffers: Record<string, Buffer>; messageCount: number }> {
  const parsed = JSON.parse(await readFile(inboxPath, 'utf8')) as unknown;
  if (!isRecord(parsed) || !Array.isArray(parsed.messages)) {
    throw new Error(`Simulation inbox must contain a messages array: ${inboxPath}`);
  }
  const mediaBuffers: Record<string, Buffer> = {};
  const messages: JsonRecord[] = [];
  for (const value of parsed.messages) {
    if (!isRecord(value)) throw new Error('Simulation inbox contains a malformed message');
    const message = structuredClone(value);
    const key = requireRecord(message.key, 'message.key');
    if (key.remoteJid === '$SOURCE_GROUP') key.remoteJid = sourceGroupJid;
    const content = isRecord(message.message) ? message.message : null;
    const image = content && isRecord(content.imageMessage) ? content.imageMessage : null;
    const localImagePath = image?._localImagePath;
    if (image && typeof localImagePath === 'string') {
      const messageId = typeof key.id === 'string' ? key.id : null;
      if (!messageId) throw new Error('Simulation image message must have a key.id');
      const mediaPath = resolveMediaPath(localImagePath, inboxPath);
      const buffer = await readFile(mediaPath);
      image.fileLength = buffer.byteLength;
      image.fileSha256 = createHash('sha256').update(buffer).digest('base64');
      delete image._localImagePath;
      mediaBuffers[messageId] = buffer;
    }
    messages.push(message);
  }
  return { payload: { type: 'notify', messages }, mediaBuffers, messageCount: messages.length };
}

function resolveMediaPath(localImagePath: string, inboxPath: string): string {
  if (path.isAbsolute(localImagePath)) return localImagePath;
  const fromWorkspace = path.resolve(process.cwd(), localImagePath);
  return existsSync(fromWorkspace)
    ? fromWorkspace
    : path.resolve(path.dirname(inboxPath), localImagePath);
}

async function waitForTerminalDeliveryState(app: ReturnType<typeof createApplication>): Promise<void> {
  for (let attempt = 0; attempt < 100; attempt += 1) {
    const row = app.database.database.prepare(`
      SELECT COUNT(*) AS count
      FROM delivery_jobs
      WHERE status NOT IN (${TERMINAL_DELIVERY_STATES.map(() => '?').join(', ')})
    `).get(...TERMINAL_DELIVERY_STATES) as { count: number };
    if (row.count === 0) return;
    await new Promise(resolve => setTimeout(resolve, 25));
  }
  throw new Error('Simulation delivery jobs did not reach terminal states');
}

function buildReport(
  app: ReturnType<typeof createApplication>,
  messageCount: number,
  inboxPath: string
): JsonRecord {
  const announcements = app.database.database.prepare(`
    SELECT id, primary_source_message_id, classification, evaluation_score, status, payload_type
    FROM announcements
    ORDER BY announcement_seq
  `).all() as Array<{
    id: string; primary_source_message_id: string; classification: string;
    evaluation_score: number; status: string; payload_type: string;
  }>;
  const translations = app.database.database.prepare(`
    SELECT announcement_id, language_code, content, validation_status
    FROM translations
    ORDER BY announcement_id, language_code
  `).all() as Array<{
    announcement_id: string; language_code: string; content: string; validation_status: string;
  }>;
  const byAnnouncement = new Map<string, Array<JsonRecord>>();
  for (const translation of translations) {
    const entries = byAnnouncement.get(translation.announcement_id) ?? [];
    entries.push({
      language: translation.language_code,
      content: translation.content,
      validationStatus: translation.validation_status
    });
    byAnnouncement.set(translation.announcement_id, entries);
  }
  return {
    generatedAtIso: new Date().toISOString(),
    inboxPath,
    totalMessagesIngested: messageCount,
    announcementsQueued: announcements.filter(item => ['queued', 'completed', 'partial_failure'].includes(item.status)).length,
    ignored: announcements.filter(item => item.status === 'ignored').length,
    held: announcements.filter(item => item.status === 'held_validation_failed').length,
    announcements: announcements.map(item => {
      const tracer = app.getPipelineTracer(item.id);
      const checkpoints = tracer?.getCheckpoints() ?? [];
      return {
        id: item.id,
        primarySourceMessageId: item.primary_source_message_id,
        classification: item.classification,
        evaluationScore: item.evaluation_score,
        status: item.status,
        payloadType: item.payload_type,
        translations: byAnnouncement.get(item.id) ?? [],
        telemetry: {
          totalPipelineUs: checkpoints.reduce((total, checkpoint) => total + checkpoint.durationUs, 0),
          checkpoints
        }
      };
    })
  };
}

function requireRecord(value: unknown, name: string): JsonRecord {
  if (!isRecord(value)) throw new Error(`Simulation input requires ${name} to be an object`);
  return value;
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

void main().catch(error => {
  console.error('[SIMULATION] Failed', error instanceof Error ? error.message : error);
  process.exitCode = 1;
});
