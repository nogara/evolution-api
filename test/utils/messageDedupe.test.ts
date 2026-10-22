import { MESSAGE_DEDUPE_TTL_SECONDS, messageDedupeKey } from '@utils/messageDedupe';
import { describe, expect, it } from 'vitest';

const phone = '5491123456789@s.whatsapp.net';
const lidKey = { id: 'MSG-1', remoteJid: '123456789@lid', fromMe: false };
const pnKey = { id: 'MSG-1', remoteJid: phone, fromMe: false };

describe('messageDedupeKey', () => {
  it('shares a key between a lid copy with phone alternative and the phone copy', () => {
    expect(messageDedupeKey('instance-id', { ...lidKey, remoteJidAlt: phone })).toBe(
      messageDedupeKey('instance-id', pnKey),
    );
    expect(messageDedupeKey('instance-id', pnKey)).toBe(`message_seen_instance-id_MSG-1_0_${phone}`);
  });

  it('separates copies sent to different recipients', () => {
    expect(messageDedupeKey('instance-id', { ...pnKey, fromMe: true })).not.toBe(
      messageDedupeKey('instance-id', { ...pnKey, fromMe: true, remoteJid: '5491187654321@s.whatsapp.net' }),
    );
  });

  it('separates a lid copy without phone alternative from the phone copy', () => {
    expect(messageDedupeKey('instance-id', lidKey)).not.toBe(messageDedupeKey('instance-id', pnKey));
  });

  it('separates messages sent by me from received ones', () => {
    expect(messageDedupeKey('instance-id', { ...pnKey, fromMe: true })).toBe(
      `message_seen_instance-id_MSG-1_1_${phone}`,
    );
    expect(messageDedupeKey('instance-id', { ...pnKey, fromMe: true })).not.toBe(
      messageDedupeKey('instance-id', pnKey),
    );
  });

  it('separates instances', () => {
    expect(messageDedupeKey('a', pnKey)).not.toBe(messageDedupeKey('b', pnKey));
  });

  it('keeps entries for 24 hours in seconds', () => {
    expect(MESSAGE_DEDUPE_TTL_SECONDS).toBe(86400);
  });
});
