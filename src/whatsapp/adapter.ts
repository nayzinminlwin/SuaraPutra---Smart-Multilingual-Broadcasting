export type SupportedMessageKind = 'TEXT' | 'IMAGE_CAPTION' | 'IMAGE_ONLY' | 'UNSUPPORTED';
export type ConnectionStatus = 'connecting' | 'open' | 'close' | 'logged_out';

export interface NormalizedInboundMessage {
  chatJid: string;
  messageId: string;
  senderJid: string;
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
  onMessage(handler: InboundMessageHandler): void;
  onConnectionChange(handler: ConnectionChangeHandler): void;
  sendMessage(targetGroupJid: string, payload: OutboundMessagePayload): Promise<SendMessageResult>;
  getGroupMetadata(groupJid: string): Promise<GroupMetadataSummary>;
}
