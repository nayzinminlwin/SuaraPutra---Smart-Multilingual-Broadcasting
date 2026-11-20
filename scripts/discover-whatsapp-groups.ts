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
  jid: string;
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

function readConfiguredJids(envContent: string): Map<string, string> {
  const configuredJids = new Map<string, string>();
  for (const [, envKey] of GROUP_ENV_KEYS) {
    const match = envContent.match(new RegExp(`^${envKey}=([^\\r\\n]*)$`, 'm'));
    if (match?.[1]?.trim()) configuredJids.set(envKey, match[1].trim());
  }
  return configuredJids;
}

function readConfiguredSourceJids(envContent: string, configuredJids: Map<string, string>): string[] {
  const match = envContent.match(/^WHATSAPP_SOURCE_GROUP_JIDS=([^\r\n]*)$/m);
  const configured = match?.[1]?.split(',').map(jid => jid.trim()).filter(Boolean) ?? [];
  return [...new Set([configuredJids.get('WHATSAPP_SOURCE_GROUP_JID'), ...configured].filter(
    (jid): jid is string => Boolean(jid)
  ))];
}

async function updateEnvFile(envPath: string, groups: ResolvedGroup[], sourceJids: readonly string[]): Promise<boolean> {
  const original = await readFile(envPath, 'utf8');
  const values = new Map(groups.map(group => [group.envKey, group.jid]));
  values.set('WHATSAPP_SOURCE_GROUP_JIDS', sourceJids.join(','));
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

async function resolveSourceInviteLinks(inviteLinks: readonly string[]): Promise<string[]> {
  const resolved: string[] = [];
  for (const inviteLink of inviteLinks) {
    const inviteCode = extractInviteCode(inviteLink);
    console.log('Resolving an additional source group...');
    const metadata = await currentSocket.groupGetInviteInfo(inviteCode);
    if (!metadata.id || !/^[0-9-]+@g\.us$/.test(metadata.id)) {
      throw new Error('Baileys returned an invalid group JID for an additional source group');
    }
    console.log(`Resolved additional source: ${metadata.subject ?? '(unnamed group)'} -> ${metadata.id}`);
    resolved.push(metadata.id);
  }
  return resolved;
}

async function verifyEnvWritable(envPath: string): Promise<void> {
  try {
    await access(envPath, constants.W_OK);
  } catch {
    throw new Error(`The running user cannot write ${envPath}; fix its ownership or permissions before entering group links`);
  }
}

async function askForGroups(
  readline: ReturnType<typeof createInterface>,
  configuredJids: Map<string, string>
): Promise<ResolvedGroup[]> {
  const groups: ResolvedGroup[] = [];
  for (const [role, envKey] of GROUP_ENV_KEYS) {
    const inviteLink = (await readline.question(
      `Enter the ${role} group invite link (press Enter to keep the current JID): `
    )).trim();
    if (!inviteLink) {
      const currentJid = configuredJids.get(envKey);
      if (!currentJid || !/^[0-9-]+@g\.us$/.test(currentJid)) {
        throw new Error(`No valid existing JID is configured for the ${role} group`);
      }
      console.log(`Keeping ${role}: ${currentJid}`);
      groups.push({ role, envKey, jid: currentJid });
      continue;
    }
    const inviteCode = extractInviteCode(inviteLink);
    console.log(`Resolving the ${role} group...`);
    const metadata = await currentSocket.groupGetInviteInfo(inviteCode);
    if (!metadata.id || !/^[0-9-]+@g\.us$/.test(metadata.id)) {
      throw new Error(`Baileys returned an invalid group JID for the ${role} group`);
    }
    console.log(`Resolved ${role}: ${metadata.subject ?? '(unnamed group)'} -> ${metadata.id}`);
    groups.push({ role, envKey, jid: metadata.id });
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
    const envContent = await readFile(envPath, 'utf8');
    const configuredJids = readConfiguredJids(envContent);
    const configuredSourceJids = readConfiguredSourceJids(envContent, configuredJids);
    currentSocket = await connect(authDir);
    const groups = await askForGroups(readline, configuredJids);
    const primarySourceJid = groups.find(group => group.envKey === 'WHATSAPP_SOURCE_GROUP_JID')?.jid;
    if (!primarySourceJid) throw new Error('The primary source group must be configured');
    const currentAdditionalSources = configuredSourceJids.filter(jid => jid !== configuredJids.get('WHATSAPP_SOURCE_GROUP_JID'));
    const additionalInput = (await readline.question(
      'Enter additional source group invite links separated by commas (press Enter to keep current additional sources): '
    )).trim();
    const additionalSourceJids = additionalInput
      ? await resolveSourceInviteLinks(additionalInput.split(',').map(link => link.trim()).filter(Boolean))
      : currentAdditionalSources;
    const sourceJids = [...new Set([primarySourceJid, ...additionalSourceJids])];

    const seenJids = new Set<string>();
    const duplicateGroup = groups.find(group => {
      if (seenJids.has(group.jid)) return true;
      seenJids.add(group.jid);
      return false;
    });
    const destinationJids = new Set(
      groups.filter(group => group.envKey !== 'WHATSAPP_SOURCE_GROUP_JID').map(group => group.jid)
    );
    const duplicateSource = sourceJids.find(jid => destinationJids.has(jid));
    if (duplicateGroup) {
      throw new Error(`The ${duplicateGroup.role} group uses a duplicate JID; each configured group must be distinct`);
    }
    if (duplicateSource) {
      throw new Error(`Source group ${duplicateSource} duplicates another configured group`);
    }

    console.log('\nResolved group mappings:');
    for (const group of groups) {
      console.log(`${group.envKey}=${group.jid}`);
    }
    console.log(`WHATSAPP_SOURCE_GROUP_JIDS=${sourceJids.join(',')}`);
    const confirmation = (await readline.question(`\nUpdate ${envPath} with these group mappings? (yes/no): `)).trim().toLowerCase();
    if (confirmation !== 'yes') {
      console.log('No changes made to .env.');
      return;
    }

    const updatedAtomically = await updateEnvFile(envPath, groups, sourceJids);
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
