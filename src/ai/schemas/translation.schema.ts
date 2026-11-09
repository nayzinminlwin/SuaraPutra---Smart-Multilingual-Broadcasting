import { z } from 'zod';

export const TranslationResponseSchema = z.object({
  id: z.string().min(1),
  score: z.number().min(1).max(10),
  English: z.string().min(1).max(4096).nullable(),
  Malay: z.string().min(1).max(4096).nullable(),
  Tamil: z.string().min(1).max(4096).nullable(),
  Mandarin: z.string().min(1).max(4096).nullable()
});

export type TranslationResponse = z.infer<typeof TranslationResponseSchema>;
