export type MessageDedupeMark = 'phone' | 'no-phone';

export type MessageDedupeKeyInput = {
  id?: string;
  fromMe?: boolean;
  remoteJid?: string;
  remoteJidAlt?: string;
  senderPn?: string;
  participantAlt?: string;
};

export const MESSAGE_DEDUPE_TTL_SECONDS = 24 * 60 * 60;

const PHONE_SUFFIX = '@s.whatsapp.net';
const NON_PERSONAL_SUFFIXES = ['@g.us', '@broadcast', '@newsletter'];

const isPhoneJid = (jid?: string) => typeof jid === 'string' && jid.endsWith(PHONE_SUFFIX);

export function messageDedupeKey(instanceId: string, key: MessageDedupeKeyInput): string {
  return `message_seen_${instanceId}_${key.id}_${key.fromMe ? 1 : 0}`;
}

export function hasResolvablePhone(key: MessageDedupeKeyInput): boolean {
  const remoteJid = key.remoteJid ?? '';

  if (NON_PERSONAL_SUFFIXES.some((suffix) => remoteJid.endsWith(suffix))) {
    return true;
  }

  return [key.remoteJid, key.remoteJidAlt, key.senderPn, key.participantAlt].some(isPhoneJid);
}

export function messageDedupeMark(key: MessageDedupeKeyInput): MessageDedupeMark {
  return hasResolvablePhone(key) ? 'phone' : 'no-phone';
}

export function shouldProcessMessage(seen: MessageDedupeMark | null | undefined, key: MessageDedupeKeyInput): boolean {
  if (!seen) {
    return true;
  }

  return seen === 'no-phone' && hasResolvablePhone(key);
}
