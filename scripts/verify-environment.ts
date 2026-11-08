import { access, constants, mkdir, stat } from 'node:fs/promises';
import process from 'node:process';
import Database from 'better-sqlite3';
import { PipelineTracer } from '../src/observability/telemetry.js';

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
  tracer.startCheckpoint('CP01_ENVIRONMENT_TIMER');
  tracer.endCheckpoint('CP01_ENVIRONMENT_TIMER', { node: process.versions.node });
  tracer.finalizeJourney(Date.now());
  console.log(`Node.js ${process.versions.node}`);
  console.log('better-sqlite3: loaded');
  console.log(directories.join('\n'));
}

await main();
