import {
  hasResolvablePhone,
  MESSAGE_DEDUPE_TTL_SECONDS,
  messageDedupeKey,
  messageDedupeMark,
  shouldProcessMessage,
} from '@utils/messageDedupe';
import { describe, expect, it } from 'vitest';

const lidKey = { id: 'MSG-1', remoteJid: '123456789@lid', fromMe: false };
const pnKey = { id: 'MSG-1', remoteJid: '5491123456789@s.whatsapp.net', fromMe: false };

describe('messageDedupeKey', () => {
  it('ignores the remoteJid so lid and phone deliveries share a key', () => {
    expect(messageDedupeKey('instance-id', lidKey)).toBe(messageDedupeKey('instance-id', pnKey));
    expect(messageDedupeKey('instance-id', pnKey)).toBe('message_seen_instance-id_MSG-1_0');
  });

  it('separates messages sent by me from received ones', () => {
    expect(messageDedupeKey('instance-id', { ...pnKey, fromMe: true })).toBe('message_seen_instance-id_MSG-1_1');
    expect(messageDedupeKey('instance-id', { ...pnKey, fromMe: true })).not.toBe(
      messageDedupeKey('instance-id', pnKey),
    );
  });

  it('separates instances', () => {
    expect(messageDedupeKey('a', pnKey)).not.toBe(messageDedupeKey('b', pnKey));
  });
});

describe('hasResolvablePhone', () => {
  it.each([
    ['phone remoteJid', pnKey],
    ['lid with phone remoteJidAlt', { ...lidKey, remoteJidAlt: '5491123456789@s.whatsapp.net' }],
    ['lid with phone senderPn', { ...lidKey, senderPn: '5491123456789@s.whatsapp.net' }],
    ['lid with phone participantAlt', { ...lidKey, participantAlt: '5491123456789@s.whatsapp.net' }],
    ['group', { id: 'MSG-1', remoteJid: '120363000000000000@g.us' }],
    ['status broadcast', { id: 'MSG-1', remoteJid: 'status@broadcast' }],
    ['newsletter', { id: 'MSG-1', remoteJid: '120363000000000000@newsletter' }],
  ])('is true for %s', (_, key) => {
    expect(hasResolvablePhone(key)).toBe(true);
  });

  it.each([
    ['lid without alternatives', lidKey],
    ['lid with lid alternative', { ...lidKey, remoteJidAlt: '987654321@lid' }],
    ['missing remoteJid', { id: 'MSG-1' }],
  ])('is false for %s', (_, key) => {
    expect(hasResolvablePhone(key)).toBe(false);
  });
});

describe('messageDedupeMark', () => {
  it('marks by phone resolvability', () => {
    expect(messageDedupeMark(pnKey)).toBe('phone');
    expect(messageDedupeMark(lidKey)).toBe('no-phone');
  });
});

describe('shouldProcessMessage', () => {
  it('processes an unseen message', () => {
    expect(shouldProcessMessage(undefined, lidKey)).toBe(true);
    expect(shouldProcessMessage(null, pnKey)).toBe(true);
  });

  it('skips a message already seen with a phone', () => {
    expect(shouldProcessMessage('phone', pnKey)).toBe(false);
    expect(shouldProcessMessage('phone', lidKey)).toBe(false);
  });

  it('processes an upgrade from no-phone to a resolvable phone', () => {
    expect(shouldProcessMessage('no-phone', pnKey)).toBe(true);
  });

  it('skips a repeated no-phone delivery', () => {
    expect(shouldProcessMessage('no-phone', lidKey)).toBe(false);
  });

  it('keeps entries for 24 hours in seconds', () => {
    expect(MESSAGE_DEDUPE_TTL_SECONDS).toBe(86400);
  });
});
