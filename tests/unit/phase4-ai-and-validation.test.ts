import { describe, expect, it, vi } from 'vitest';
import { AiProcessor } from '../../src/ai/ai-processor.js';
import { MockModelProvider } from '../../src/ai/model-provider.js';
import { TranslationValidator } from '../../src/validation/translation-validator.js';

function response(
  id: string,
  score: number,
  values: { English: string | null; Malay: string | null; Tamil: string | null; Mandarin: string | null }
) {
  return { id, score, ...values };
}

const translated = (id: string, text: string) => response(id, 8, {
  English: text, Malay: text, Tamil: text, Mandarin: text
});

describe('Phase 4 AI processor and validation', () => {
  it('returns low-scoring casual chat as ignored with null translations', async () => {
    const id = 'fixture-08';
    const processor = new AiProcessor({
      provider: new MockModelProvider([response(id, 2.5, {
        English: null, Malay: null, Tamil: null, Mandarin: null
      })]),
      sleep: async () => undefined
    });

    const result = await processor.process({
      id, type: 'TEXT-MESSAGE', content: 'Thanks! Can someone share the slides?'
    });

    expect(result.status).toBe('ignored');
    expect(result.response.English).toBeNull();
  });

  it('translates image captions without worthiness evaluation', async () => {
    const id = 'fixture-04';
    const provider = new MockModelProvider([response(id, 10, {
      English: 'Registration opens 11.3.2026',
      Malay: 'Pendaftaran dibuka 11.3.2026',
      Tamil: 'பதிவு 11.3.2026 அன்று தொடங்கும்',
      Mandarin: '报名于 11.3.2026 开始'
    })]);
    const result = await new AiProcessor({ provider, sleep: async () => undefined }).process({
      id, type: 'TEXT CAPTION FROM IMAGE', content: 'Registration opens 11.3.2026'
    });

    expect(result.status).toBe('translated');
    expect(result.response.score).toBe(10);
    expect(provider.requests[0]?.prompt).toContain('TEXT CAPTION FROM IMAGE');
  });

  it('keeps the protected source URL in every language', async () => {
    const id = 'fixture-02';
    const url = 'https://upm.edu.my/register';
    const result = await new AiProcessor({
      provider: new MockModelProvider([translated(id, `Hari ini we open registration ${url}`)]),
      sleep: async () => undefined
    }).process({
      id, type: 'TEXT-MESSAGE', content: `Hari ini, we will open registration ${url}`
    });

    expect(result.validation?.valid).toBe(true);
    expect(result.response.Malay).toContain(url);
  });

  it('preserves separated language versions supplied by the model', async () => {
    const id = 'fixture-03';
    const english = 'English version: Registration is open now.';
    const malay = 'Versi Melayu: Pendaftaran kini dibuka.';
    const result = await new AiProcessor({
      provider: new MockModelProvider([response(id, 8, {
        English: english, Malay: malay, Tamil: 'பதிவு இப்போது திறக்கப்பட்டுள்ளது.', Mandarin: '报名现已开放。'
      })]),
      sleep: async () => undefined
    }).process({
      id, type: 'TEXT-MESSAGE',
      content: `${english}\n---\n${malay}`
    });

    expect(result.response.English).toBe(english);
    expect(result.response.Malay).toBe(malay);
  });

  it('passes a standalone date and URL through every output', () => {
    const validator = new TranslationValidator();
    const id = 'fixture-09';
    const text = '11.3.2026 - https://upm.edu.my';
    const result = validator.validate(text, response(id, 10, {
      English: text, Malay: text, Tamil: text, Mandarin: text
    }));

    expect(result.valid).toBe(true);
    expect(result.durationUs).toBeGreaterThanOrEqual(0);
  });

  it('retries transient 503 failures twice and recovers', async () => {
    const id = 'retry-success';
    const provider = new MockModelProvider(
      [translated(id, 'Announcement https://upm.edu.my')],
      [Object.assign(new Error('Service Unavailable'), { status: 503 }), Object.assign(new Error('Service Unavailable'), { status: 503 })]
    );
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const result = await new AiProcessor({ provider, sleep: async () => undefined }).process({
      id, type: 'TEXT-MESSAGE', content: 'Announcement https://upm.edu.my'
    });

    expect(result.status).toBe('translated');
    expect(result.attempts).toBe(3);
    expect(warn.mock.calls.filter(([value]) => String(value).includes('CP05_AI_PROCESS:RETRY'))).toHaveLength(2);
    warn.mockRestore();
  });

  it('performs one validation regeneration and holds a second invalid response', async () => {
    const id = 'validation-failure';
    const invalid = translated(id, 'Announcement without the source link');
    const provider = new MockModelProvider([invalid, invalid]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    const result = await new AiProcessor({ provider, sleep: async () => undefined }).process({
      id, type: 'TEXT-MESSAGE', content: 'Announcement https://upm.edu.my'
    });

    expect(result.status).toBe('held_validation_failed');
    expect(result.validationAttempts).toBe(2);
    expect(error.mock.calls.some(([value]) => String(value).includes('CP05_AI_PROCESS:FAILED'))).toBe(true);
    error.mockRestore();
  });

  it('holds a regeneration that violates the original score contract', async () => {
    const id = 'validation-contract-failure';
    const provider = new MockModelProvider([
      translated(id, 'Announcement without the source link'),
      response(id, 2, { English: null, Malay: null, Tamil: null, Mandarin: null })
    ]);
    const result = await new AiProcessor({ provider, sleep: async () => undefined }).process({
      id, type: 'TEXT-MESSAGE', content: 'Announcement https://upm.edu.my'
    });

    expect(result.status).toBe('held_validation_failed');
    expect(result.validation?.valid).toBe(false);
  });

  it('holds malformed model output instead of accepting or silently dropping it', async () => {
    const id = 'malformed-response';
    const provider = new MockModelProvider([{ id, score: 8, English: 'only one field' }]);
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    await expect(new AiProcessor({ provider, sleep: async () => undefined }).process({
      id, type: 'TEXT-MESSAGE', content: 'Announcement'
    })).rejects.toThrow('Invalid AI response');

    expect(error.mock.calls.some(([value]) => String(value).includes('CP05_AI_PROCESS:FAILED'))).toBe(true);
    error.mockRestore();
  });
});
