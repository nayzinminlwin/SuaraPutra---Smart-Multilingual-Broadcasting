import { randomUUID } from 'node:crypto';

export type CheckpointRecord = Readonly<{
  name: string;
  durationUs: number;
  metadata?: Readonly<Record<string, unknown>>;
}>;

export type JourneySummary = Readonly<{
  traceId: string;
  messageId: string;
  waSourceSentTimestampMs: number;
  finalDispatchTimestampMs: number;
  totalPipelineUs: number;
  totalE2eWallMs: number;
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
    const record = { name, durationUs, ...(metadata ? { metadata } : {}) };
    this.active.delete(name);
    this.records.push(record);
    console.log(`[TRACE:${this.traceId}] ✔ [${name}] DONE (${durationUs} μs)`, metadata ?? '');
    return record;
  }

  failCheckpoint(name: string, errorCode: string, details?: Readonly<Record<string, unknown>>): never {
    const checkpoint = this.active.get(name);
    const durationUs = checkpoint
      ? Number((process.hrtime.bigint() - checkpoint.startedAt) / 1000n)
      : 0;
    this.active.delete(name);
    console.error(`[TRACE:${this.traceId}] ✖ [${name}] FAILED after ${durationUs} μs`, {
      errorCode,
      details
    });
    throw new Error(`${name} failed: ${errorCode}`);
  }

  finalizeJourney(finalDispatchTimestampMs: number): JourneySummary {
    if (this.active.size > 0) {
      throw new Error(`Cannot finalize journey with active checkpoints: ${[...this.active.keys()].join(', ')}`);
    }
    const totalPipelineUs = Number((process.hrtime.bigint() - this.startedAt) / 1000n);
    const summary = {
      traceId: this.traceId,
      messageId: this.messageId,
      waSourceSentTimestampMs: this.waSourceSentTimestampMs,
      finalDispatchTimestampMs,
      totalPipelineUs,
      totalE2eWallMs: finalDispatchTimestampMs - this.waSourceSentTimestampMs
    };
    console.log(`[TRACE:${this.traceId}] 🏁 [JOURNEY_SUMMARY]`, summary);
    return summary;
  }

  get checkpoints(): readonly CheckpointRecord[] {
    return [...this.records];
  }
}
