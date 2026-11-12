import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { DatabaseClient } from '../../src/database/client.js';
import { MigrationRunner } from '../../src/database/migrator.js';
import { AnnouncementRepository } from '../../src/database/repositories/announcement.repo.js';
import { DeliveryJobRepository } from '../../src/database/repositories/delivery-job.repo.js';
import { DeliveryQueue } from '../../src/delivery/queue.js';
import { SourceMessageRepository } from '../../src/database/repositories/source-message.repo.js';
import { TranslationRepository } from '../../src/database/repositories/translation.repo.js';
import { AiProcessor } from '../../src/ai/ai-processor.js';
import { MockModelProvider } from '../../src/ai/model-provider.js';
import type { ModelGenerateRequest } from '../../src/ai/model-provider.js';
import { ContextAssembler } from '../../src/ingestion/context-assembler.js';
import { MediaStore } from '../../src/ingestion/media-store.js';
import { MessageIngestor } from '../../src/ingestion/message-ingestor.js';
import { normalizeUpsert } from '../../src/whatsapp/event-normalizer.js';
import { sha256Hex } from '../../src/shared/crypto.js';
import type { NormalizedInboundMessage } from '../../src/whatsapp/adapter.js';

const sourceJid = '120000000001@g.us';
const destinationGroups = {
  ms: '120000000002@g.us',
  en: '120000000003@g.us',
  'zh-CN': '120000000004@g.us',
  ta: '120000000005@g.us'
} as const;

describe('Phase 3 ingestion pipeline', () => {
  const resources: Array<{ client: DatabaseClient; directory: string }> = [];

  afterEach(() => {
    for (const resource of resources.splice(0)) {
      resource.client.close();
      rmSync(resource.directory, { recursive: true, force: true });
    }
  });

  function createIngestor(aiProcessor?: AiProcessor) {
    const directory = mkdtempSync(join(tmpdir(), 'suaraputra-phase3-'));
    const client = new DatabaseClient(join(directory, 'test.sqlite'));
    new MigrationRunner(client).migrate();
    resources.push({ client, directory });
    const sources = new SourceMessageRepository(client);
    const announcements = new AnnouncementRepository(client);
    const jobs = new DeliveryJobRepository(client);
    const queue = new DeliveryQueue(client, announcements, new TranslationRepository(client), jobs, destinationGroups);
    return {
      directory,
      client,
      sources,
      ingestor: new MessageIngestor({
        sourceGroupJid: sourceJid,
        botJid: '60100000000@s.whatsapp.net',
        contextMaxMessages: 5,
        contextWindowSeconds: 300,
        destinationGroups,
        mediaStore: new MediaStore(join(directory, 'media'), 1024 * 1024),
        sources,
        announcements,
        deliveryJobs: jobs,
        database: client,
        aiProcessor,
        deliveryQueue: queue
      })
    };
  }

  function textMessage(messageId: string): NormalizedInboundMessage {
    return {
      chatJid: sourceJid, messageId, senderJid: '60100000001@s.whatsapp.net',
      senderPushName: null, fromMe: false, timestampMs: 1794227520000, kind: 'TEXT',
      text: 'Community notice https://upm.edu.my/notice', quotedMessageId: null,
      quotedParticipantJid: null, quotedText: null, media: null, rawPayloadJson: '{}'
    };
  }

  it('drops out-of-scope, self-echo, unsupported, and duplicate messages at their gates', async () => {
    const { ingestor, sources } = createIngestor();
    const base: NormalizedInboundMessage = {
      chatJid: sourceJid, messageId: 'gate-message', senderJid: '60100000001@s.whatsapp.net',
      senderPushName: null, fromMe: false, timestampMs: 1794227520000, kind: 'TEXT',
      text: 'Synthetic notice', quotedMessageId: null, quotedParticipantJid: null, quotedText: null,
      media: null, rawPayloadJson: '{}'
    };
    expect((await ingestor.enqueue({ ...base, chatJid: '120000000099@g.us' })).reason).toBe('out_of_scope');
    expect((await ingestor.enqueue({ ...base, messageId: 'self', fromMe: true })).reason).toBe('self_echo');
    expect((await ingestor.enqueue({ ...base, messageId: 'unsupported', kind: 'UNSUPPORTED' })).reason).toBe('unsupported');
    expect((await ingestor.enqueue(base)).accepted).toBe(true);
    expect((await ingestor.enqueue(base)).reason).toBe('duplicate');
    expect(sources.findById('does-not-exist')).toBeNull();
  });

  it('uses the architecture-defined content hash formulas', async () => {
    const { ingestor, sources } = createIngestor();
    const message: NormalizedInboundMessage = {
      chatJid: sourceJid, messageId: 'hash-message', senderJid: '60100000001@s.whatsapp.net',
      senderPushName: null, fromMe: false, timestampMs: 1794227520000, kind: 'TEXT',
      text: '  A   notice\nwith spacing  ', quotedMessageId: null, quotedParticipantJid: null,
      quotedText: null, media: null, rawPayloadJson: '{}'
    };
    await ingestor.enqueue(message);
    expect(sources.findRecent(sourceJid, 0, 10)[0]?.contentHash)
      .toBe(sha256Hex('A notice with spacing'));
  });

  it('persists image media and releases the inbound buffer before returning', async () => {
    const { ingestor, directory, client } = createIngestor();
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'baileys-events', '07_multi_message_split_announcement.json'), 'utf8')) as unknown;
    const messages = normalizeUpsert(raw, {
      'fixture-07-caption': Buffer.from('synthetic-caption-image'),
      'fixture-07-image': Buffer.from('synthetic-image-only')
    }, { maxMediaBytes: 1024 });
    const captionResult = await ingestor.enqueue(messages[1]);
    const imageResult = await ingestor.enqueue(messages[2]);
    expect(captionResult.message.media?.buffer).toBeNull();
    expect(imageResult.message.media?.buffer).toBeNull();
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM source_messages').get()).toEqual({ count: 2 });
    expect(readFileSync(join(directory, 'media', 'fixture-07-caption.jpg')).byteLength).toBeGreaterThan(0);
    expect(readFileSync(join(directory, 'media', 'fixture-07-image.jpg')).byteLength).toBeGreaterThan(0);
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM delivery_jobs').get()).toEqual({ count: 4 });
  });

  it('serializes a chronological burst and preserves bounded quoted context', async () => {
    const { ingestor, sources, client } = createIngestor();
    const raw = JSON.parse(readFileSync(join(process.cwd(), 'tests', 'fixtures', 'baileys-events', '07_multi_message_split_announcement.json'), 'utf8')) as unknown;
    const messages = normalizeUpsert(raw, {
      'fixture-07-caption': Buffer.from('synthetic-caption-image'),
      'fixture-07-image': Buffer.from('synthetic-image-only')
    }, { maxMediaBytes: 1024 });
    const results = await Promise.all(messages.map(message => ingestor.enqueue(message)));
    expect(results.map(result => result.message.messageId)).toEqual([
      'fixture-07-text', 'fixture-07-caption', 'fixture-07-image'
    ]);
    expect(sources.findRecent(sourceJid, 0, 10).map(source => source.messageId)).toEqual([
      'fixture-07-text', 'fixture-07-caption', 'fixture-07-image'
    ]);
    expect(results[2].announcementId).toBeDefined();
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM announcements').get()).toEqual({ count: 1 });
  });

  it('resolves a quoted message from the persisted source record before fallback text', async () => {
    const { client, sources } = createIngestor();
    const original = sources.insert({
      id: 'original', chatJid: sourceJid, messageId: 'quoted-id', senderJid: 'person@s.whatsapp.net',
      timestampMs: 1794227520000, messageKind: 'TEXT', textContent: 'Original notice',
      contentHash: 'hash-original', rawPayloadJson: '{}'
    });
    const message: NormalizedInboundMessage = {
      chatJid: sourceJid, messageId: 'reply', senderJid: 'person@s.whatsapp.net', senderPushName: null,
      fromMe: false, timestampMs: 1794227580000, kind: 'TEXT', text: 'More details',
      quotedMessageId: 'quoted-id', quotedParticipantJid: null, quotedText: 'Fallback',
      media: null, rawPayloadJson: '{}'
    };
    const context = new ContextAssembler(sources, 5, 300).assemble(message, original);
    expect(context.quoted).toMatchObject({ id: 'original', textContent: 'Original notice' });
    expect(context.sourceMessageIds).toContain('original');
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM source_messages').get()).toEqual({ count: 1 });
  });

  it('durably records ignored AI results with the primary source and no delivery jobs', async () => {
    const id = 'ignored-durable';
    const processor = new AiProcessor({
      provider: new MockModelProvider([(request: ModelGenerateRequest) => ({
        id: request.id,
        score: 2,
        English: null,
        Malay: null,
        Tamil: null,
        Mandarin: null
      })]),
      sleep: async () => undefined
    });
    const { ingestor, client } = createIngestor(processor);

    await ingestor.enqueue(textMessage(id));

    expect(client.database.prepare(
      'SELECT classification, evaluation_score, status FROM announcements'
    ).get()).toEqual({ classification: 'not_announcement', evaluation_score: 2, status: 'ignored' });
    expect(client.database.prepare(
      "SELECT role FROM announcement_sources WHERE role = 'primary'"
    ).get()).toEqual({ role: 'primary' });
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM delivery_jobs').get()).toEqual({ count: 0 });
  });

  it('holds exhausted provider failures without masking them as missing announcements', async () => {
    const processor = new AiProcessor({
      provider: new MockModelProvider([], [
        Object.assign(new Error('Service Unavailable'), { status: 503 }),
        Object.assign(new Error('Service Unavailable'), { status: 503 }),
        Object.assign(new Error('Service Unavailable'), { status: 503 })
      ]),
      sleep: async () => undefined
    });
    const { ingestor, client } = createIngestor(processor);

    await expect(ingestor.enqueue(textMessage('provider-held'))).resolves.toMatchObject({ accepted: true });

    expect(client.database.prepare('SELECT status FROM announcements').get()).toEqual({
      status: 'held_validation_failed'
    });
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM delivery_jobs').get()).toEqual({ count: 0 });
  });

  it('persists returned translations as failed when validation remains invalid', async () => {
    const invalid = {
      id: 'placeholder',
      score: 8,
      English: 'Notice without the required URL',
      Malay: 'Notis tanpa URL diperlukan',
      Tamil: 'தேவையான URL இல்லாத அறிவிப்பு',
      Mandarin: '缺少所需网址的通知'
    };
    const processor = new AiProcessor({
      provider: new MockModelProvider([
        (request: ModelGenerateRequest) => ({ ...invalid, id: request.id }),
        (request: ModelGenerateRequest) => ({ ...invalid, id: request.id })
      ]),
      sleep: async () => undefined
    });
    const { ingestor, client } = createIngestor(processor);

    await ingestor.enqueue(textMessage('validation-held'));

    expect(client.database.prepare(
      "SELECT status FROM announcements WHERE status = 'held_validation_failed'"
    ).get()).toEqual({ status: 'held_validation_failed' });
    expect(client.database.prepare(
      "SELECT COUNT(*) AS count FROM translations WHERE validation_status = 'failed'"
    ).get()).toEqual({ count: 4 });
    expect(client.database.prepare('SELECT COUNT(*) AS count FROM delivery_jobs').get()).toEqual({ count: 0 });
  });
});
