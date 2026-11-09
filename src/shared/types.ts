import type { LanguageCode } from '../config/groups.js';

export type MessageKind = 'TEXT' | 'IMAGE_CAPTION' | 'IMAGE_ONLY';
export type AnnouncementClassification = 'announcement' | 'not_announcement';
export type AnnouncementStatus =
  | 'processing'
  | 'ignored'
  | 'held_validation_failed'
  | 'queued'
  | 'completed'
  | 'partial_failure';
export type DeliveryStatus =
  | 'pending'
  | 'sending'
  | 'sent'
  | 'retry_wait'
  | 'uncertain'
  | 'failed_permanent'
  | 'cancelled';
export type ValidationStatus = 'passed' | 'failed';
export type SourceLinkRole = 'primary' | 'quoted' | 'window_context';
export type EventLevel = 'DEBUG' | 'INFO' | 'WARN' | 'ERROR' | 'CRITICAL';

export interface SourceMessageInput {
  id: string;
  chatJid: string;
  messageId: string;
  senderJid: string;
  senderPushName?: string | null;
  timestampMs: number;
  messageKind: MessageKind;
  textContent?: string | null;
  contentHash: string;
  quotedMessageId?: string | null;
  quotedParticipantJid?: string | null;
  quotedText?: string | null;
  mediaLocalPath?: string | null;
  mediaMimeType?: string | null;
  mediaSha256Hex?: string | null;
  rawPayloadJson: string;
}

export interface AnnouncementInput {
  id: string;
  primarySourceMessageId: string;
  sourceTimestampMs: number;
  classification: AnnouncementClassification;
  evaluationScore: number;
  status: AnnouncementStatus;
  payloadType: MessageKind;
  mediaLocalPath?: string | null;
  mediaMimeType?: string | null;
  rawAiResponseJson?: string | null;
}

export interface TranslationInput {
  id: string;
  announcementId: string;
  languageCode: LanguageCode;
  content: string;
  validationStatus: ValidationStatus;
  validationErrorsJson?: string | null;
}

export interface DeliveryJobInput {
  id: string;
  announcementId: string;
  announcementSeq: number;
  sourceTimestampMs: number;
  languageCode: LanguageCode;
  languageOrder: 1 | 2 | 3 | 4;
  targetGroupJid: string;
  payloadType: MessageKind;
  textContent?: string | null;
  mediaLocalPath?: string | null;
  mediaMimeType?: string | null;
  idempotencyKey: string;
  maxAttempts?: number;
}

export type SourceMessage = SourceMessageInput & { ingestionSeq: number; ingestedAt: string };
export type Announcement = AnnouncementInput & { announcementSeq: number; createdAt: string; updatedAt: string };
export type Translation = TranslationInput & { createdAt: string };
export type DeliveryJob = DeliveryJobInput & {
  status: DeliveryStatus;
  attempts: number;
  maxAttempts: number;
  nextAttemptAt: string;
  leaseOwner: string | null;
  leaseExpiresAt: string | null;
  outgoingMessageId: string | null;
  lastErrorCode: string | null;
  lastErrorMessage: string | null;
  createdAt: string;
  sentAt: string | null;
  updatedAt: string;
};
