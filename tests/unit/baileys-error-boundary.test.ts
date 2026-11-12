import { describe, expect, it, vi } from 'vitest';
import type { WAMessage, WASocket } from '@whiskeysockets/baileys';
import { BaileysWhatsAppAdapter } from '../../src/whatsapp/baileys-client.js';

const config = {
  WHATSAPP_AUTH_DIR: 'unused',
  MAX_MEDIA_BYTES: 1024,
  LOG_LEVEL: 'error' as const,
  NODE_ENV: 'test' as const
};

class TestAdapter extends BaileysWhatsAppAdapter {
  invoke(socket: WASocket, messages: WAMessage[]): Promise<void> {
    return this.handleUpsert(socket, { type: 'notify', messages });
  }
}

function message(id: string, content: WAMessage['message']): WAMessage {
  return {
    key: { remoteJid: '120000000001@g.us', id, fromMe: false },
    messageTimestamp: 1,
    pushName: 'Synthetic',
    message: content
  };
}

function socket(): WASocket {
  return {
    logger: {},
    updateMediaMessage: vi.fn()
  } as unknown as WASocket;
}

describe('Baileys inbound error boundaries', () => {
  it('catches media download failures and continues with subsequent messages', async () => {
    const error = vi.fn();
    const downloadMedia = vi.fn().mockRejectedValue(new Error('media unavailable'));
    const adapter = new TestAdapter(config, {
      downloadMedia,
      logger: { error, warn: vi.fn(), fatal: vi.fn() }
    });
    const handled: string[] = [];
    adapter.onMessage(async item => { handled.push(item.messageId); });

    await expect(adapter.invoke(socket(), [
      message('media-failure', { imageMessage: { mimetype: 'image/jpeg', caption: 'caption' } }),
      message('after-media-failure', { conversation: 'later message' })
    ])).resolves.toBeUndefined();

    expect(downloadMedia).toHaveBeenCalledOnce();
    expect(error).toHaveBeenCalledOnce();
    expect(handled).toEqual(['after-media-failure']);
  });

  it('catches normalization failures and continues with subsequent messages', async () => {
    const error = vi.fn();
    const normalizeMessageContent = vi.fn()
      .mockImplementationOnce(() => { throw new Error('invalid message shape'); })
      .mockImplementation((content) => content);
    const adapter = new TestAdapter(config, {
      normalizeMessageContent,
      logger: { error, warn: vi.fn(), fatal: vi.fn() }
    });
    const handled: string[] = [];
    adapter.onMessage(async item => { handled.push(item.messageId); });

    await expect(adapter.invoke(socket(), [
      message('normalization-failure', { conversation: 'bad' }),
      message('after-normalization-failure', { conversation: 'later message' })
    ])).resolves.toBeUndefined();

    expect(error).toHaveBeenCalledOnce();
    expect(handled).toEqual(['after-normalization-failure']);
  });
});
