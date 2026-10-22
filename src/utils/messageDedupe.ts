import { resolvePhoneRemoteJid } from '@utils/resolvePhoneRemoteJid';

export type MessageDedupeKeyInput = {
  id?: string;
  fromMe?: boolean;
  remoteJid?: string;
  remoteJidAlt?: string;
};

export const MESSAGE_DEDUPE_TTL_SECONDS = 24 * 60 * 60;

export function messageDedupeKey(instanceId: string, key: MessageDedupeKeyInput): string {
  return `message_seen_${instanceId}_${key.id}_${key.fromMe ? 1 : 0}_${resolvePhoneRemoteJid(key)}`;
}
