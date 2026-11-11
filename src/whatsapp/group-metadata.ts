import type { GroupMetadata } from '@whiskeysockets/baileys';
import type { GroupMetadataSummary } from './adapter.js';

export function summarizeGroupMetadata(
  metadata: GroupMetadata,
  botJid: string | null
): GroupMetadataSummary {
  const botBaseJid = botJid?.split(':')[0] ?? null;
  const participant = metadata.participants.find((entry) => {
    const jid = entry.id?.split(':')[0];
    return jid !== undefined && (jid === botJid || jid === botBaseJid);
  });

  return {
    groupJid: metadata.id,
    subject: metadata.subject,
    isCommunity: metadata.isCommunity === true,
    isCommunityAnnounce: metadata.isCommunityAnnounce === true,
    linkedParentJid: metadata.linkedParent ?? null,
    botIsParticipant: participant !== undefined,
    botCanSend: participant !== undefined && metadata.announce !== true
  };
}
