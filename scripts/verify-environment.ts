import { access, constants, mkdir, stat } from 'node:fs/promises';
import { createRequire } from 'node:module';
import process from 'node:process';
import { BufferJSON } from '@whiskeysockets/baileys';
import Database from 'better-sqlite3';
import { PIPELINE_CHECKPOINTS, PipelineTracer } from '../src/observability/telemetry.js';

const require = createRequire(import.meta.url);
const EXPECTED_BAILEYS_VERSION = '7.0.0-rc14';

function readPackageVersion(metadata: unknown): string | undefined {
  if (typeof metadata !== 'object' || metadata === null || !('version' in metadata)) return undefined;
  const version = metadata.version;
  return typeof version === 'string' ? version : undefined;
}

async function checkDirectory(path: string): Promise<string> {
  try {
    await access(path, constants.R_OK | constants.W_OK);
    const permissions = (await stat(path)).mode & 0o777;
    return `${path}: accessible (mode ${permissions.toString(8)})`;
  } catch {
    await mkdir(path, { recursive: true });
    return `${path}: created`;
  }
}

async function main(): Promise<void> {
  const major = Number(process.versions.node.split('.')[0]);
  if (major < 22) {
    throw new Error(`Node.js 22 or newer is required; found ${process.versions.node}`);
  }
  const database = new Database(':memory:');
  const journalMode = database.pragma('journal_mode', { simple: true });
  database.close();
  if (journalMode !== 'memory') {
    throw new Error(`better-sqlite3 loaded, but in-memory journal mode was unexpected: ${journalMode}`);
  }
  const baileysVersion = readPackageVersion(require('@whiskeysockets/baileys/package.json'));
  if (baileysVersion !== EXPECTED_BAILEYS_VERSION) {
    throw new Error(`Expected @whiskeysockets/baileys ${EXPECTED_BAILEYS_VERSION}; found ${baileysVersion ?? 'unknown'}`);
  }
  if (typeof BufferJSON.replacer !== 'function') {
    throw new Error('@whiskeysockets/baileys BufferJSON.replacer is unavailable');
  }
  const directories = await Promise.all([
    checkDirectory('./data'),
    checkDirectory('./data/media'),
    checkDirectory('./private'),
    checkDirectory('./private/whatsapp-auth')
  ]);
  const tracer = new PipelineTracer({
    messageId: 'environment-check',
    waSourceSentTimestampMs: Date.now() - 10
  });
  for (const checkpoint of PIPELINE_CHECKPOINTS) {
    tracer.startCheckpoint(checkpoint);
    tracer.endCheckpoint(checkpoint, { node: process.versions.node });
  }
  tracer.logRetryOrWarning('CP05_AI_PROCESS', 1, 3, 'ENVIRONMENT_DIAGNOSTIC', 0);
  tracer.finalizeJourney(Date.now());
  console.log(`Node.js ${process.versions.node}`);
  console.log('better-sqlite3: loaded');
  console.log(`@whiskeysockets/baileys: ${baileysVersion}`);
  console.log('Baileys BufferJSON.replacer: loaded');
  console.log(directories.join('\n'));
}

await main();
