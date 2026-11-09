import type { EnvConfig } from './env.js';

export const LANGUAGE_CODES = ['ms', 'en', 'zh-CN', 'ta'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export function getGroupRouting(config: EnvConfig): Readonly<Record<LanguageCode, string>> {
  return {
    ms: config.WHATSAPP_MALAY_GROUP_JID,
    en: config.WHATSAPP_ENGLISH_GROUP_JID,
    'zh-CN': config.WHATSAPP_MANDARIN_GROUP_JID,
    ta: config.WHATSAPP_TAMIL_GROUP_JID
  };
}
