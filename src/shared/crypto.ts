import { createHash, randomUUID } from 'node:crypto';

export function sha256Hex(value: string | Buffer): string {
  return createHash('sha256').update(value).digest('hex');
}

export function newId(): string {
  return randomUUID();
}

export function deterministicId(...parts: string[]): string {
  return sha256Hex(parts.join('\u001f')).slice(0, 32);
}
