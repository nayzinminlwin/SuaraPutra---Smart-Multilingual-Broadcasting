import 'dotenv/config';
import { access, chmod, constants, readFile, rename, stat, unlink, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { createInterface } from 'node:readline/promises';
import { stdin as input, stdout as output } from 'node:process';
import { Boom } from '@hapi/boom';
import pino from 'pino';
import {
  DisconnectReason,
  fetchLatestWaWebVersion,
  makeWASocket,
  useMultiFileAuthState,
  type GroupMetadata,
  type WASocket
} from '@whiskeysockets/baileys';

const GROUP_ENV_KEYS = [
  ['source', 'WHATSAPP_SOURCE_GROUP_JID'],
  ['Malay', 'WHATSAPP_MALAY_GROUP_JID'],
  ['English', 'WHATSAPP_ENGLISH_GROUP_JID'],
  ['Mandarin', 'WHATSAPP_MANDARIN_GROUP_JID'],
  ['Tamil', 'WHATSAPP_TAMIL_GROUP_JID']
] as const;

type GroupRole = typeof GROUP_ENV_KEYS[number][0];
type ResolvedGroup = {
  role: GroupRole;
  envKey: string;
  inviteLink: string;
  metadata: GroupMetadata;
};

function extractInviteCode(value: string): string {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error('Enter a complete WhatsApp invite link, for example https://chat.whatsapp.com/INVITE_CODE');
  }
  if (url.protocol !== 'https:' || url.hostname.toLowerCase() !== 'chat.whatsapp.com') {
    throw new Error('The link must use https://chat.whatsapp.com/');
  }
  const code = url.pathname.split('/').filter(Boolean)[0];
  if (!code || !/^[A-Za-z0-9_-]+$/.test(code)) {
    throw new Error('The WhatsApp invite link does not contain a valid invite code');
  }
  return code;
}

async function connect(authDir: string): Promise<WASocket> {
  const { state, saveCreds } = await useMultiFileAuthState(authDir);
  const waWebVersion = await fetchLatestWaWebVersion({});
  const socket = makeWASocket({
    auth: state,
    version: waWebVersion.version,
    markOnlineOnConnect: false,
    syncFullHistory: false,
    logger: pino({ level: 'silent' })
  });
  socket.ev.on('creds.update', saveCreds);

  await new Promise<void>((resolveConnection, rejectConnection) => {
    const handleUpdate = (update: { connection?: 'open' | 'connecting' | 'close'; lastDisconnect?: { error?: Error } }): void => {
      if (update.connection === 'open') {
        resolveConnection();
        return;
      }
      if (update.connection !== 'close') return;
      const error = update.lastDisconnect?.error;
      const statusCode = error instanceof Boom ? error.output.statusCode : undefined;
      rejectConnection(new Error(
        statusCode === DisconnectReason.loggedOut
          ? 'WhatsApp auth state is logged out; pair the account again before running discovery'
          : 'WhatsApp connection closed before discovery completed'
      ));
    };
    socket.ev.on('connection.update', handleUpdate);
  });

  return socket;
}

async function updateEnvFile(envPath: string, groups: ResolvedGroup[]): Promise<boolean> {
  const original = await readFile(envPath, 'utf8');
  const values = new Map(groups.map(group => [group.envKey, group.metadata.id]));
  let updated = original;

  for (const [envKey, value] of values) {
    const line = `${envKey}=${value}`;
    const pattern = new RegExp(`^${envKey}=.*$`, 'm');
    updated = pattern.test(updated)
      ? updated.replace(pattern, line)
      : `${updated.trimEnd()}\n${line}\n`;
  }

  const fileStats = await stat(envPath);
  const temporaryPath = `${envPath}.tmp`;
  try {
    await writeFile(temporaryPath, updated, { encoding: 'utf8', mode: fileStats.mode & 0o777 });
    await chmod(temporaryPath, fileStats.mode & 0o777);
    await rename(temporaryPath, envPath);
    return true;
  } catch (error) {
    if (!(error instanceof Error) || (error as NodeJS.ErrnoException).code !== 'EACCES') throw error;
    console.warn('The .env directory is not writable by the service user; updating the existing .env file in place.');
    try {
      await unlink(temporaryPath);
    } catch (cleanupError) {
      if (!(cleanupError instanceof Error) || (cleanupError as NodeJS.ErrnoException).code !== 'ENOENT') throw cleanupError;
    }
    await writeFile(envPath, updated, { encoding: 'utf8' });
    return false;
  }
}

async function verifyEnvWritable(envPath: string): Promise<void> {
  try {
    await access(envPath, constants.W_OK);
  } catch {
    throw new Error(`The running user cannot write ${envPath}; fix its ownership or permissions before entering group links`);
  }
}

async function askForGroups(readline: ReturnType<typeof createInterface>): Promise<ResolvedGroup[]> {
  const groups: ResolvedGroup[] = [];
  for (const [role, envKey] of GROUP_ENV_KEYS) {
    const inviteLink = (await readline.question(`Enter the ${role} group invite link: `)).trim();
    const inviteCode = extractInviteCode(inviteLink);
    console.log(`Resolving the ${role} group...`);
    const metadata = await currentSocket.groupGetInviteInfo(inviteCode);
    if (!metadata.id || !/^[0-9-]+@g\.us$/.test(metadata.id)) {
      throw new Error(`Baileys returned an invalid group JID for the ${role} group`);
    }
    console.log(`Resolved ${role}: ${metadata.subject ?? '(unnamed group)'} -> ${metadata.id}`);
    groups.push({ role, envKey, inviteLink, metadata });
  }
  return groups;
}

let currentSocket: WASocket;

async function main(): Promise<void> {
  const authDir = resolve(process.env.WHATSAPP_AUTH_DIR ?? './private/whatsapp-auth');
  const envPath = resolve(process.env.ENV_FILE ?? './.env');
  const readline = createInterface({ input, output });

  try {
    console.log(`Using WhatsApp auth directory: ${authDir}`);
    console.log('The account must already be paired. This script does not join groups.');
    await verifyEnvWritable(envPath);
    currentSocket = await connect(authDir);
    const groups = await askForGroups(readline);

    const seenJids = new Set<string>();
    const duplicate = groups.find(group => {
      if (seenJids.has(group.metadata.id)) return true;
      seenJids.add(group.metadata.id);
      return false;
    });
    if (duplicate) {
      throw new Error(`The ${duplicate.role} group uses a duplicate JID; each configured group must be distinct`);
    }

    console.log('\nResolved group mappings:');
    for (const group of groups) {
      console.log(`${group.envKey}=${group.metadata.id}`);
    }
    const confirmation = (await readline.question(`\nUpdate ${envPath} with these five JIDs? (yes/no): `)).trim().toLowerCase();
    if (confirmation !== 'yes') {
      console.log('No changes made to .env.');
      return;
    }

    const updatedAtomically = await updateEnvFile(envPath, groups);
    console.log(updatedAtomically
      ? `Updated ${envPath} atomically.`
      : `Updated ${envPath} in place.`);
  } finally {
    readline.close();
    if (currentSocket) currentSocket.end(undefined);
  }
}

void main().catch(error => {
  console.error(`[GROUP_DISCOVERY] Failed: ${error instanceof Error ? error.message : 'Unknown error'}`);
  process.exitCode = 1;
});
