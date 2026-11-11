import { describe, expect, it, vi } from 'vitest';
import { EnvConfigSchema, getSafeConfig, parseEnv } from '../../src/config/env.js';
import { getGroupRouting } from '../../src/config/groups.js';
import { TARGET_LANGUAGES } from '../../src/config/languages.js';
import { PIPELINE_CHECKPOINTS, PipelineTracer } from '../../src/observability/telemetry.js';

const validEnvironment = {
  WHATSAPP_SOURCE_GROUP_JID: '111-222@g.us',
  WHATSAPP_MALAY_GROUP_JID: '111-223@g.us',
  WHATSAPP_ENGLISH_GROUP_JID: '111-224@g.us',
  WHATSAPP_MANDARIN_GROUP_JID: '111-225@g.us',
  WHATSAPP_TAMIL_GROUP_JID: '111-226@g.us',
  AI_API_KEY: 'test-key'
};

describe('Phase 0 initialization', () => {
  it('validates required environment and keeps secrets out of safe config', () => {
    const config = parseEnv(validEnvironment);
    expect(config.AI_MODEL).toBe('gemini-3.8-flash');
    expect(config.ANNOUNCEMENT_SCORE_THRESHOLD).toBe(4);
    expect(config.MAX_CONCURRENT_INGESTIONS).toBe(1);
    expect(config.MAX_MEDIA_BYTES).toBe(10485760);
    expect(config.DATA_RETENTION_DAYS).toBe(14);
    expect(getSafeConfig(config)).not.toHaveProperty('AI_API_KEY');
    expect(EnvConfigSchema.safeParse({ ...validEnvironment, WHATSAPP_SOURCE_GROUP_JID: 'not-a-group' }).success).toBe(false);
    expect(EnvConfigSchema.safeParse({ ...validEnvironment, MAX_CONCURRENT_INGESTIONS: 2 }).success).toBe(false);
  });

  it('maps all four canonical languages to static configured groups', () => {
    const routing = getGroupRouting(parseEnv(validEnvironment));
    expect(Object.keys(routing)).toEqual(['ms', 'en', 'zh-CN', 'ta']);
    expect(TARGET_LANGUAGES.map((language) => language.code)).toEqual(['ms', 'en', 'zh-CN', 'ta']);
  });

  it('records microsecond checkpoints and computes the E2E wall duration', () => {
    const output = vi.spyOn(console, 'log').mockImplementation(() => undefined);
    const warning = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    const tracer = new PipelineTracer({
      traceId: 'test-trace',
      messageId: 'message-1',
      waSourceSentTimestampMs: 1000
    });
    for (const checkpointName of PIPELINE_CHECKPOINTS) {
      tracer.startCheckpoint(checkpointName);
      tracer.endCheckpoint(checkpointName);
    }
    tracer.logRetryOrWarning('CP05_AI_PROCESS', 1, 3, 'HTTP_503_UNAVAILABLE', 1000);
    const checkpoint = tracer.checkpoints[0];
    const summary = tracer.finalizeJourney(1250);
    expect(checkpoint.durationUs).toBeGreaterThanOrEqual(0);
    expect(summary.totalE2eWallMs).toBe(250);
    expect(tracer.checkpoints.map(({ name }) => name)).toEqual([...PIPELINE_CHECKPOINTS]);
    expect(output).toHaveBeenCalledWith(expect.stringContaining('[JOURNEY_SUMMARY]'), expect.anything());
    expect(warning).toHaveBeenCalledWith(expect.stringContaining('[CP05_AI_PROCESS:RETRY]'));
    output.mockRestore();
    warning.mockRestore();
  });
});
