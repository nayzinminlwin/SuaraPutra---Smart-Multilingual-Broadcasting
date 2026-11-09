import pino, { type Logger } from 'pino';
import type { EnvConfig } from '../config/env.js';

export function createLogger(config: Pick<EnvConfig, 'LOG_LEVEL' | 'NODE_ENV'>): Logger {
  return pino({
    level: config.LOG_LEVEL,
    redact: {
      paths: ['AI_API_KEY', '*.AI_API_KEY', 'authToken', 'accessToken', 'sessionToken'],
      censor: '[REDACTED]'
    },
    transport: config.NODE_ENV === 'development'
      ? { target: 'pino-pretty', options: { colorize: false, translateTime: 'SYS:standard' } }
      : undefined
  });
}

export function logSafeConfig(logger: Logger, config: Record<string, unknown>): void {
  logger.debug({ config }, 'Loaded non-secret configuration');
}
