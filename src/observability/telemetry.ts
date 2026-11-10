import { randomUUID } from 'node:crypto';

export const PIPELINE_CHECKPOINTS = [
  'CP01_INGEST_NORMALIZE',
  'CP02_FIFO_WAIT',
  'CP03_GATE_CHECKS',
  'CP04_CONTEXT_ASSEMBLY',
  'CP05_AI_PROCESS',
  'CP06_VALIDATION',
  'CP07_QUEUE_PERSIST',
  'CP08_MSG_RECONSTRUCT',
  'CP09_DISPATCH'
] as const;

export type PipelineCheckpoint = (typeof PIPELINE_CHECKPOINTS)[number];

export type CheckpointRecord = Readonly<{
  name: string;
  durationUs: number;
  outcome?: 'completed' | 'failed';
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type JourneySummary = Readonly<{
  traceId: string;
  messageId: string;
  waSourceSentTimestampMs: number;
  finalDispatchTimestampMs: number;
  totalPipelineUs: number;
  totalE2eWallMs: number;
  checkpoints: readonly CheckpointRecord[];
}>;

type ActiveCheckpoint = { name: string; startedAt: bigint };

export class PipelineTracer {
  readonly traceId: string;
  readonly messageId: string;
  readonly waSourceSentTimestampMs: number;
  private readonly startedAt = process.hrtime.bigint();
  private readonly active = new Map<string, ActiveCheckpoint>();
  private readonly records: CheckpointRecord[] = [];

  constructor(options: { traceId?: string; messageId: string; waSourceSentTimestampMs: number }) {
    this.traceId = options.traceId ?? randomUUID();
    this.messageId = options.messageId;
    this.waSourceSentTimestampMs = options.waSourceSentTimestampMs;
  }

  startCheckpoint(name: string): void {
    if (this.active.has(name)) {
      throw new Error(`Checkpoint already active: ${name}`);
    }
    this.active.set(name, { name, startedAt: process.hrtime.bigint() });
  }

  endCheckpoint(name: string, metadata?: Readonly<Record<string, unknown>>): CheckpointRecord {
    const checkpoint = this.active.get(name);
    if (!checkpoint) {
      throw new Error(`Checkpoint is not active: ${name}`);
    }
    const durationUs = Number((process.hrtime.bigint() - checkpoint.startedAt) / 1000n);
    const record = { name, durationUs, outcome: 'completed' as const, ...(metadata ? { metadata } : {}) };
    this.active.delete(name);
    this.records.push(record);
    console.log(`[TRACE:${this.traceId}] ✔ [${name}] DONE (${durationUs} μs)`, metadata ?? '');
    return record;
  }

  recordCheckpointFailure(
    name: string,
    errorCode: string,
    details?: Readonly<Record<string, unknown>>
  ): CheckpointRecord | null {
    const checkpoint = this.active.get(name);
    if (!checkpoint) return null;
    const durationUs = Number((process.hrtime.bigint() - checkpoint.startedAt) / 1000n);
    const metadata = { errorCode, ...(details ? { details } : {}) };
    const record = { name, durationUs, outcome: 'failed' as const, metadata };
    this.active.delete(name);
    this.records.push(record);
    console.error(`[TRACE:${this.traceId}] ✖ [${name}] FAILED after ${durationUs} μs`, metadata);
    return record;
  }

  hasActiveCheckpoint(name: string): boolean {
    return this.active.has(name);
  }

  failCheckpoint(name: string, errorCode: string, details?: Readonly<Record<string, unknown>>): never {
    this.recordCheckpointFailure(name, errorCode, details);
    throw new Error(`${name} failed: ${errorCode}`);
  }

  logRetryOrWarning(
    checkpointName: string,
    attempt: number,
    maxAttempts: number,
    errorReason: string,
    backoffMs: number
  ): void {
    console.warn(
      `[TRACE:${this.traceId}] [WARN] [${checkpointName}:RETRY] ` +
        `Attempt ${attempt}/${maxAttempts} | reason=${errorReason} | nextRetryBackoffMs=${backoffMs}`
    );
  }

  finalizeJourney(finalDispatchTimestampMs: number): JourneySummary {
    if (this.active.size > 0) {
      throw new Error(`Cannot finalize journey with active checkpoints: ${[...this.active.keys()].join(', ')}`);
    }
    if (this.records.some((record) => record.outcome === 'failed')) {
      throw new Error('Cannot finalize journey with failed checkpoints');
    }
    const totalPipelineUs = Number((process.hrtime.bigint() - this.startedAt) / 1000n);
    const summary = {
      traceId: this.traceId,
      messageId: this.messageId,
      waSourceSentTimestampMs: this.waSourceSentTimestampMs,
      finalDispatchTimestampMs,
      totalPipelineUs,
      totalE2eWallMs: finalDispatchTimestampMs - this.waSourceSentTimestampMs,
      checkpoints: [...this.records]
    };
    console.log(`[TRACE:${this.traceId}] 🏁 [JOURNEY_SUMMARY]`, summary);
    return summary;
  }

  get checkpoints(): readonly CheckpointRecord[] {
    return [...this.records];
  }
}
