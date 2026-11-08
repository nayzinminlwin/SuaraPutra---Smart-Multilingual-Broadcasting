import 'dotenv/config';
import { z } from 'zod';

const WhatsAppGroupJidSchema = z
  .string()
  .regex(/^[0-9-]+@g\.us$/, 'Must be a valid WhatsApp group JID ending in @g.us');

export const EnvConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  LOG_LEVEL: z.enum(['debug', 'info', 'warn', 'error', 'fatal']).default('info'),
  DATABASE_URL: z.string().default('./data/automation.sqlite'),
  MEDIA_STORAGE_DIR: z.string().default('./data/media'),
  WHATSAPP_ADAPTER_MODE: z.enum(['mock', 'baileys']).default('mock'),
  WHATSAPP_AUTH_DIR: z.string().default('./private/whatsapp-auth'),
  WHATSAPP_SOURCE_GROUP_JID: WhatsAppGroupJidSchema,
  WHATSAPP_MALAY_GROUP_JID: WhatsAppGroupJidSchema,
  WHATSAPP_ENGLISH_GROUP_JID: WhatsAppGroupJidSchema,
  WHATSAPP_MANDARIN_GROUP_JID: WhatsAppGroupJidSchema,
  WHATSAPP_TAMIL_GROUP_JID: WhatsAppGroupJidSchema,
  AI_PROVIDER: z.enum(['gemini', 'mock']).default('gemini'),
  AI_MODEL: z.string().default('gemini-3.8-flash'),
  AI_API_KEY: z.string().min(1, 'AI_API_KEY is required when AI_PROVIDER=gemini'),
  CLASSIFIER_THRESHOLD_HIGH: z.coerce.number().min(0.5).max(1.0).default(0.8),
  CONTEXT_MAX_MESSAGES: z.coerce.number().int().min(0).max(15).default(5),
  CONTEXT_WINDOW_SECONDS: z.coerce.number().int().min(10).max(3600).default(300),
  DELIVERY_POLL_INTERVAL_MS: z.coerce.number().int().min(200).default(1000),
  DELIVERY_PACING_MS: z.coerce.number().int().min(500).default(1500),
  DELIVERY_SEND_TIMEOUT_MS: z.coerce.number().int().min(5000).default(30000),
  DATA_RETENTION_DAYS: z.coerce.number().int().min(1).default(30),
  BROADCAST_KILL_SWITCH: z.enum(['true', 'false']).default('false'),
  WEB_ADMIN_ENABLED: z.enum(['true', 'false']).default('false'),
  WEB_ADMIN_PORT: z.coerce.number().int().min(1024).max(65535).default(3000)
});

export type EnvConfig = z.infer<typeof EnvConfigSchema>;

export function parseEnv(input: Record<string, unknown> = process.env): EnvConfig {
  const result = EnvConfigSchema.safeParse(input);
  if (!result.success) {
    throw new Error(`Invalid environment configuration: ${result.error.message}`);
  }
  return result.data;
}

export function getSafeConfig(config: EnvConfig): Record<string, unknown> {
  const { AI_API_KEY: _apiKey, ...safeConfig } = config;
  return safeConfig;
}
