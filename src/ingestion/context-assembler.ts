import { PipelineTracer } from '../observability/telemetry.js';
import type { SourceMessageRepository } from '../database/repositories/source-message.repo.js';
import type { NormalizedInboundMessage } from '../whatsapp/adapter.js';
import type { SourceMessage } from '../shared/types.js';

export type AssembledContext = Readonly<{
  primary: NormalizedInboundMessage;
  quoted: SourceMessage | { messageId: string; text: string } | null;
  recent: readonly SourceMessage[];
  sourceMessageIds: readonly string[];
}>;

export class ContextAssembler {
  constructor(
    private readonly sources: SourceMessageRepository,
    private readonly maxMessages: number,
    private readonly windowSeconds: number
  ) {
    if (!Number.isInteger(maxMessages) || maxMessages < 0) throw new Error('Context maxMessages must be non-negative');
    if (!Number.isInteger(windowSeconds) || windowSeconds <= 0) throw new Error('Context windowSeconds must be positive');
  }

  assemble(message: NormalizedInboundMessage, persisted: SourceMessage): AssembledContext {
    const tracer = new PipelineTracer({
      messageId: message.messageId,
      waSourceSentTimestampMs: message.timestampMs
    });
    tracer.startCheckpoint('CP04_CONTEXT_ASSEMBLY');
    try {
      const quotedRecord = message.quotedMessageId
        ? this.sources.findQuoted(message.chatJid, message.quotedMessageId)
        : null;
      const quoted = quotedRecord ?? (
        message.quotedMessageId && message.quotedText
          ? { messageId: message.quotedMessageId, text: message.quotedText }
          : null
      );
      const recent = this.sources.findRecent(
        message.chatJid,
        Math.max(0, message.timestampMs - this.windowSeconds * 1000),
        this.maxMessages,
        message.timestampMs
      ).filter(source => source.id !== persisted.id);
      const sourceMessageIds = [
        persisted.id,
        ...(quoted && 'id' in quoted ? [quoted.id] : []),
        ...recent.map(source => source.id)
      ];
      tracer.endCheckpoint('CP04_CONTEXT_ASSEMBLY', {
        quotedResolved: quoted !== null,
        recentCount: recent.length,
        sourceMessageIds
      });
      return { primary: message, quoted, recent, sourceMessageIds };
    } catch (error) {
      console.error(`[TRACE:${tracer.traceId}] [CP04_CONTEXT_ASSEMBLY] FAILED`, {
        messageId: message.messageId,
        error: error instanceof Error ? error.message : 'unknown error'
      });
      throw error;
    }
  }
}
