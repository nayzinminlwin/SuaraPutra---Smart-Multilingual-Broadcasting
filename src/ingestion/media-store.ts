import { createWriteStream } from 'node:fs';
import { mkdir, readFile, rename, stat, unlink } from 'node:fs/promises';
import { dirname, join, relative, resolve } from 'node:path';
import { sha256Hex } from '../shared/crypto.js';

const extensionForMime = (mimeType: string): string => {
  const subtype = mimeType.split('/')[1]?.split(';')[0]?.toLowerCase();
  return subtype === 'jpeg' ? '.jpg' : subtype ? `.${subtype.replace(/[^a-z0-9]/g, '')}` : '.bin';
};

export type StoredMedia = Readonly<{
  localPath: string;
  sha256Hex: string;
  byteLength: number;
  mimeType: string;
}>;

export class MediaStore {
  private readonly root: string;

  constructor(rootDirectory: string, private readonly maxBytes: number) {
    if (!Number.isInteger(maxBytes) || maxBytes <= 0) throw new Error('MediaStore maxBytes must be positive');
    this.root = resolve(rootDirectory);
  }

  async save(messageId: string, mimeType: string, buffer: Buffer): Promise<StoredMedia> {
    if (!messageId || /[\\/\0]/.test(messageId)) throw new Error('Invalid media message ID');
    if (!Buffer.isBuffer(buffer) || buffer.byteLength === 0) throw new Error(`Media for ${messageId} is empty`);
    if (buffer.byteLength > this.maxBytes) throw new Error(`Media for ${messageId} exceeds configured limit`);
    const localPath = join(this.root, `${messageId}${extensionForMime(mimeType)}`);
    const temporaryPath = `${localPath}.${process.pid}.${Date.now()}.tmp`;
    await mkdir(dirname(localPath), { recursive: true });
    try {
      await new Promise<void>((resolvePromise, reject) => {
        const stream = createWriteStream(temporaryPath, { flags: 'wx' });
        stream.once('error', reject);
        stream.once('finish', resolvePromise);
        stream.end(buffer);
      });
      const written = await stat(temporaryPath);
      if (written.size !== buffer.byteLength || written.size === 0) {
        throw new Error(`Media write verification failed for ${messageId}`);
      }
      await rename(temporaryPath, localPath);
    } catch (error) {
      await unlink(temporaryPath).catch(() => undefined);
      throw error;
    }
    return { localPath, sha256Hex: sha256Hex(buffer), byteLength: buffer.byteLength, mimeType };
  }

  async load(localPath: string): Promise<Buffer> {
    const resolved = resolve(localPath);
    const relativePath = relative(this.root, resolved);
    if (relativePath.startsWith('..') || relativePath.includes('\0')) {
      throw new Error('Media path is outside the configured media store');
    }
    const buffer = await readFile(resolved);
    if (buffer.byteLength === 0 || buffer.byteLength > this.maxBytes) {
      throw new Error(`Stored media has invalid size: ${localPath}`);
    }
    return buffer;
  }
}
