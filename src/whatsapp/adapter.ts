import type { PipelineTracer } from '../observability/telemetry.js';

export type SupportedMessageKind = 'TEXT' | 'IMAGE_CAPTION' | 'IMAGE_ONLY' | 'UNSUPPORTED';
export type ConnectionStatus = 'connecting' | 'open' | 'close' | 'logged_out';

export function normalizeUserJid(jid: string | null | undefined): string | null {
  const value = jid?.trim();
  if (!value) return null;
  const match = /^([^:@\s]+)(?::[^@\s]+)?@(s\.whatsapp\.net|lid)$/.exec(value);
  return match ? `${match[1]}@${match[2]}` : null;
}

export function isSameWhatsAppIdentity(
  candidates: Array<string | null | undefined>,
  botIdentities: Array<string | null | undefined>
): boolean {
  const normalizedBots = botIdentities.map(normalizeUserJid).filter((jid): jid is string => jid !== null);
  return candidates.some((candidate) => {
    const normalizedCandidate = normalizeUserJid(candidate);
    return normalizedCandidate !== null && normalizedBots.includes(normalizedCandidate);
  });
}

export interface NormalizedInboundMessage {
  tracer?: PipelineTracer;
  chatJid: string;
  messageId: string;
  senderJid: string;
  senderAltJid?: string | null;
  senderPushName: string | null;
  fromMe: boolean;
  timestampMs: number;
  kind: SupportedMessageKind;
  text: string | null;
  quotedMessageId: string | null;
  quotedParticipantJid: string | null;
  quotedText: string | null;
  media: {
    mimeType: string;
    fileSha256Hex: string | null;
    fileLengthBytes: number | null;
    buffer: Buffer | null;
  } | null;
  rawPayloadJson: string;
}

export type OutboundMessagePayload =
  | { type: 'TEXT'; text: string }
  | { type: 'IMAGE'; imageBuffer: Buffer; mimeType: string; caption?: string };

export interface SendMessageResult {
  outgoingMessageId: string;
  /** UTC timestamp when sendMessage resolved, indicating provider request acceptance, not a client-emitted delivery ACK. */
  acknowledgedAtIso: string;
}

export interface GroupMetadataSummary {
  groupJid: string;
  subject: string;
  isCommunity: boolean;
  isCommunityAnnounce: boolean;
  linkedParentJid: string | null;
  botIsParticipant: boolean;
  botCanSend: boolean;
}

export type InboundMessageHandler = (message: NormalizedInboundMessage) => Promise<void>;
export type ConnectionChangeHandler = (status: ConnectionStatus, reason?: string) => void;

export interface IWhatsAppAdapter {
  connect(): Promise<void>;
  disconnect(): Promise<void>;
  getConnectionStatus(): ConnectionStatus;
  getBotJid(): string | null;
  getBotIdentities(): string[];
  onMessage(handler: InboundMessageHandler): void;
  onConnectionChange(handler: ConnectionChangeHandler): void;
  sendMessage(targetGroupJid: string, payload: OutboundMessagePayload): Promise<SendMessageResult>;
  getGroupMetadata(groupJid: string): Promise<GroupMetadataSummary>;
}
