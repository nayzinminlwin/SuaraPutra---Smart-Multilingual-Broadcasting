import type { GroupMetadata } from '@whiskeysockets/baileys';
import { isSameWhatsAppIdentity } from './adapter.js';
import type { GroupMetadataSummary } from './adapter.js';

export function summarizeGroupMetadata(
  metadata: GroupMetadata,
  botIdentities: string | string[] | null
): GroupMetadataSummary {
  const identities = Array.isArray(botIdentities) ? botIdentities : [botIdentities];
  const participant = metadata.participants.find((entry) => {
    return isSameWhatsAppIdentity([entry.id, entry.lid, entry.phoneNumber], identities);
  });
  const botIsParticipant = participant !== undefined;
  const botCanSend = botIsParticipant && (
    metadata.announce !== true ||
    participant.admin === 'admin' ||
    participant.admin === 'superadmin'
  );

  return {
    groupJid: metadata.id,
    subject: metadata.subject,
    isCommunity: metadata.isCommunity === true,
    isCommunityAnnounce: metadata.isCommunityAnnounce === true,
    linkedParentJid: metadata.linkedParent ?? null,
    botIsParticipant,
    botCanSend
  };
}
