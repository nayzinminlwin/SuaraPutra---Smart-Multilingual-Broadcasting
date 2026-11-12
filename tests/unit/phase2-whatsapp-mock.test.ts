import { readFileSync } from 'node:fs';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppAmbiguousTimeoutError, WhatsAppInvalidInputError, WhatsAppPermanentError, WhatsAppTransientError } from '../../src/whatsapp/errors.js';
import { MockWhatsAppAdapter } from '../../src/whatsapp/mock-adapter.js';
import { normalizeUpsert } from '../../src/whatsapp/event-normalizer.js';

const fixture = (name: string): unknown =>
  JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'baileys-events', name), 'utf8'));

const image = Buffer.from('synthetic-image');

describe('Phase 2 WhatsApp transport and mock adapter', () => {
  it('normalizes text and extended text quotes', () => {
    const text = normalizeUpsert(fixture('01_text_english_only.json'), {}, { maxMediaBytes: 1024 })[0];
    const quote = normalizeUpsert(fixture('06_quoted_reply_deadline_extension.json'), {}, { maxMediaBytes: 1024 })[0];
    expect(text).toMatchObject({ kind: 'TEXT', text: 'Registration opens today. Please submit the form by Friday.', timestampMs: 1794227520000 });
    expect(quote).toMatchObject({ kind: 'TEXT', quotedMessageId: 'fixture-01', quotedText: 'Registration opens today. Please submit the form by Friday.' });
  });

  it('normalizes captioned and unc captioned images and preserves media bytes', () => {
    const caption = normalizeUpsert(fixture('04_image_with_caption_event.json'), { 'fixture-04': image }, { maxMediaBytes: 1024 })[0];
    const only = normalizeUpsert(fixture('05_image_only_infographic.json'), { 'fixture-05': image }, { maxMediaBytes: 1024 })[0];
    expect(caption).toMatchObject({ kind: 'IMAGE_CAPTION', text: 'Open day details are on the poster.', media: { buffer: image } });
    expect(only).toMatchObject({ kind: 'IMAGE_ONLY', text: null, media: { buffer: image } });
  });

  it('sorts batched messages chronologically and captures source time', () => {
    const messages = normalizeUpsert(fixture('07_multi_message_split_announcement.json'), {}, { maxMediaBytes: 1024 });
    expect(messages.map(message => message.messageId)).toEqual(['fixture-07-text', 'fixture-07-caption', 'fixture-07-image']);
    expect(messages[0].timestampMs).toBe(1794227520000);
  });

  it('rejects image metadata or buffers above the configured media limit', () => {
    expect(() => normalizeUpsert(fixture('04_image_with_caption_event.json'), { 'fixture-04': Buffer.alloc(1025) }, { maxMediaBytes: 1024 }))
      .toThrow(WhatsAppInvalidInputError);
  });

  it('does not classify empty extended text as TEXT', () => {
    const result = normalizeUpsert({
      type: 'notify',
      messages: [{
        key: { remoteJid: '120000000001@g.us', id: 'empty-extended' },
        messageTimestamp: 1794228000,
        message: { extendedTextMessage: { text: '   ' } }
      }]
    }, {}, { maxMediaBytes: 1024 })[0];
    expect(result.kind).toBe('UNSUPPORTED');
    expect(result.text).toBeNull();
  });

  it('emits CP01-style timing through the normalizer caller boundary without changing normalized data', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const result = normalizeUpsert(fixture('01_text_english_only.json'), {}, { maxMediaBytes: 1024 })[0];
    expect(result.messageId).toBe('fixture-01');
    expect(spy).toHaveBeenCalledWith(
      expect.stringContaining('[CP01_INGEST_NORMALIZE] DONE'),
      expect.objectContaining({ t_wa_source_sent_ms: 1794227520000 })
    );
    expect(result.tracer?.getCheckpoints().map(checkpoint => checkpoint.name))
      .toEqual(['CP01_INGEST_NORMALIZE']);
    spy.mockRestore();
  });

  it.each([
    ['TRANSIENT_ERROR', WhatsAppTransientError],
    ['AMBIGUOUS_TIMEOUT', WhatsAppAmbiguousTimeoutError],
    ['PERMANENT_ERROR', WhatsAppPermanentError]
  ] as const)('reports typed %s fault', async (faultMode, errorType) => {
    const adapter = new MockWhatsAppAdapter({ faultMode });
    await expect(adapter.sendMessage('120000000001@g.us', { type: 'TEXT', text: 'synthetic' })).rejects.toBeInstanceOf(errorType);
  });

  it('records successful sends in the inspectable outbox', async () => {
    const adapter = new MockWhatsAppAdapter();
    const result = await adapter.sendMessage('120000000001@g.us', { type: 'TEXT', text: 'synthetic' });
    expect(result.outgoingMessageId).toMatch(/^mock-out-1-/);
    expect(adapter.getSentMessages()).toHaveLength(1);
    expect(adapter.getSentMessages()[0].t_wa_translated_sent_ms).toEqual(expect.any(Number));
  });

  it('supports deterministic fault injection by call index', async () => {
    const adapter = new MockWhatsAppAdapter({
      faultModesByCallIndex: { 2: 'PERMANENT_ERROR' }
    });
    await expect(adapter.sendMessage('120000000001@g.us', { type: 'TEXT', text: 'first' })).resolves.toBeDefined();
    await expect(adapter.sendMessage('120000000002@g.us', { type: 'TEXT', text: 'second' }))
      .rejects.toBeInstanceOf(WhatsAppPermanentError);
  });

  it('writes file-backed text and image outbox entries', async () => {
    const outboxDir = await mkdtemp(join(tmpdir(), 'suara-putra-outbox-'));
    try {
      const adapter = new MockWhatsAppAdapter({
        fileOutboxDir: outboxDir,
        groupJidToLanguageMap: { '120000000001@g.us': 'en' }
      });
      await adapter.sendMessage('120000000001@g.us', { type: 'TEXT', text: 'synthetic text' });
      await adapter.sendMessage('120000000001@g.us', {
        type: 'IMAGE',
        imageBuffer: image,
        mimeType: 'image/jpeg',
        caption: 'synthetic caption'
      });
      const groupEntries = JSON.parse(await readFile(join(outboxDir, 'groups', 'en.json'), 'utf8')) as Array<Record<string, unknown>>;
      const broadcastEntries = JSON.parse(await readFile(join(outboxDir, 'broadcast-log.json'), 'utf8')) as Array<Record<string, unknown>>;
      expect(groupEntries).toHaveLength(2);
      expect(broadcastEntries).toHaveLength(2);
      expect(groupEntries[0]).toMatchObject({ payloadType: 'TEXT', text: 'synthetic text', language: 'en' });
      expect(groupEntries[1].savedMediaPath).toBe('media/en/2_' + groupEntries[1].outgoingMessageId + '.jpg');
      await expect(readFile(join(outboxDir, groupEntries[1].savedMediaPath as string))).resolves.toEqual(image);
    } finally {
      await rm(outboxDir, { recursive: true, force: true });
    }
  });
});
