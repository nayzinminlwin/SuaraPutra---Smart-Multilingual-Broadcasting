import type { LanguageCode } from '../config/groups.js';
import type { DeliveryJobInput, MessageKind } from '../shared/types.js';
import { newId } from '../shared/crypto.js';

export const LANGUAGE_ORDER: readonly { code: LanguageCode; order: 1 | 2 | 3 | 4 }[] = [
  { code: 'ms', order: 1 },
  { code: 'en', order: 2 },
  { code: 'zh-CN', order: 3 },
  { code: 'ta', order: 4 }
];

export type RoutedTranslation = Readonly<{
  languageCode: LanguageCode;
  content: string;
}>;

export class MessageRouter {
  constructor(private readonly destinations: Readonly<Record<LanguageCode, string>>) {}

  createDeliveryJobs(input: {
    announcementId: string;
    announcementSeq: number;
    sourceTimestampMs: number;
    payloadType: MessageKind;
    translations: ReadonlyArray<RoutedTranslation>;
    mediaLocalPath?: string | null;
    mediaMimeType?: string | null;
  }): DeliveryJobInput[] {
    const contents = new Map(input.translations.map((translation) => [
      translation.languageCode,
      translation.content
    ]));

    return LANGUAGE_ORDER.map(({ code, order }) => {
      const targetGroupJid = this.destinations[code];
      if (!targetGroupJid) throw new Error(`Missing configured destination for ${code}`);
      return {
        id: newId(),
        announcementId: input.announcementId,
        announcementSeq: input.announcementSeq,
        sourceTimestampMs: input.sourceTimestampMs,
        languageCode: code,
        languageOrder: order,
        targetGroupJid,
        payloadType: input.payloadType,
        textContent: contents.get(code) ?? null,
        mediaLocalPath: input.mediaLocalPath ?? null,
        mediaMimeType: input.mediaMimeType ?? null,
        idempotencyKey: `${input.announcementId}:${code}:${targetGroupJid}`
      };
    });
  }
}
