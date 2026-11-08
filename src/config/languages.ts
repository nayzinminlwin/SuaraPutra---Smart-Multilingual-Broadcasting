import { LANGUAGE_CODES, type LanguageCode } from './groups.js';

export type LanguageMetadata = Readonly<{
  code: LanguageCode;
  name: string;
  style: string;
}>;

export const TARGET_LANGUAGES: readonly LanguageMetadata[] = [
  { code: 'ms', name: 'Malay', style: 'Natural Malaysian Malay, formal community announcement tone' },
  { code: 'en', name: 'English', style: 'Clear natural English; preserve official terms and names' },
  { code: 'zh-CN', name: 'Simplified Chinese', style: 'Standardized simplified Chinese community terminology' },
  { code: 'ta', name: 'Tamil', style: 'Natural readable written Tamil for Malaysian community notices' }
];

export { LANGUAGE_CODES };
