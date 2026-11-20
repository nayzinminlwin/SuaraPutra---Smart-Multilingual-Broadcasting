import type { EnvConfig } from './env.js';

export const LANGUAGE_CODES = ['ms', 'en', 'zh-CN', 'ta'] as const;
export type LanguageCode = (typeof LANGUAGE_CODES)[number];

export function getSourceGroupJids(config: Pick<EnvConfig, 'WHATSAPP_SOURCE_GROUP_JID' | 'WHATSAPP_SOURCE_GROUP_JIDS'>): readonly string[] {
  return [...new Set([
    config.WHATSAPP_SOURCE_GROUP_JID,
    ...(config.WHATSAPP_SOURCE_GROUP_JIDS ?? '').split(',').map(jid => jid.trim()).filter(Boolean)
  ])];
}

export function getGroupRouting(config: EnvConfig): Readonly<Record<LanguageCode, string>> {
  return {
    ms: config.WHATSAPP_MALAY_GROUP_JID,
    en: config.WHATSAPP_ENGLISH_GROUP_JID,
    'zh-CN': config.WHATSAPP_MANDARIN_GROUP_JID,
    ta: config.WHATSAPP_TAMIL_GROUP_JID
  };
}
