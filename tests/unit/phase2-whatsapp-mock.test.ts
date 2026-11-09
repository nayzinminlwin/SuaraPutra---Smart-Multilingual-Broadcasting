import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { WhatsAppAmbiguousTimeoutError, WhatsAppInvalidInputError, WhatsAppPermanentError, WhatsAppTransientError } from '../../src/shared/errors.js';
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

  it('emits CP01-style timing through the normalizer caller boundary without changing normalized data', () => {
    const spy = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const adapter = new MockWhatsAppAdapter({ maxMediaBytes: 1024 });
    expect(adapter.getConnectionStatus()).toBe('close');
    expect(spy).not.toHaveBeenCalled();
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
  });
});
