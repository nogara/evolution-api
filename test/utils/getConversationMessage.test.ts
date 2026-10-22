import { beforeEach, describe, expect, it, vi } from 'vitest';

const s3 = vi.hoisted(() => ({ ENABLE: false, SAVE_VIDEO: false }));

vi.mock('@config/env.config', () => ({
  configService: { get: vi.fn(() => s3) },
}));

import { getConversationMessage } from '@utils/getConversationMessage';

const key = { id: 'MSG1' };

describe('getConversationMessage', () => {
  beforeEach(() => {
    s3.ENABLE = false;
    s3.SAVE_VIDEO = false;
  });

  it('returns plain conversation text', () => {
    expect(getConversationMessage({ key, message: { conversation: 'hello' } })).toBe('hello');
  });

  it('returns extended text message text', () => {
    expect(getConversationMessage({ key, message: { extendedTextMessage: { text: 'link' } } })).toBe('link');
  });

  it('formats images with the key id when S3 is disabled', () => {
    expect(getConversationMessage({ key, message: { imageMessage: {} } })).toBe('imageMessage|MSG1');
    expect(getConversationMessage({ key, message: { imageMessage: { caption: 'pic' } } })).toBe(
      'imageMessage|MSG1|pic',
    );
  });

  it('formats images with the media url when S3 is enabled', () => {
    s3.ENABLE = true;

    expect(getConversationMessage({ key, message: { imageMessage: {}, mediaUrl: 'https://s3/x.jpg' } })).toBe(
      'imageMessage|https://s3/x.jpg',
    );
  });

  it('formats videos with and without caption', () => {
    expect(getConversationMessage({ key, message: { videoMessage: {} } })).toBe('videoMessage|MSG1');
    expect(getConversationMessage({ key, message: { videoMessage: { caption: 'clip' } } })).toBe(
      'videoMessage|MSG1|clip',
    );
  });

  it('uses the key id for videos when S3 is enabled but video saving is off', () => {
    s3.ENABLE = true;

    expect(getConversationMessage({ key, message: { videoMessage: {}, mediaUrl: 'https://s3/v.mp4' } })).toBe(
      'videoMessage|MSG1',
    );
  });

  it('uses the media url for videos when S3 and video saving are enabled', () => {
    s3.ENABLE = true;
    s3.SAVE_VIDEO = true;

    expect(getConversationMessage({ key, message: { videoMessage: {}, mediaUrl: 'https://s3/v.mp4' } })).toBe(
      'videoMessage|https://s3/v.mp4',
    );
  });

  it('formats documents with and without caption', () => {
    expect(getConversationMessage({ key, message: { documentMessage: {} } })).toBe('documentMessage|MSG1');
    expect(getConversationMessage({ key, message: { documentMessage: { caption: 'doc' } } })).toBe(
      'documentMessage|MSG1|doc',
    );
  });

  it('formats documents wrapped with a caption', () => {
    expect(
      getConversationMessage({
        key,
        message: { documentWithCaptionMessage: { message: { documentMessage: { caption: 'cv' } } } },
      }),
    ).toBe('documentWithCaptionMessage|MSG1|cv');
  });

  it('formats audio with the media id', () => {
    expect(getConversationMessage({ key, message: { audioMessage: {} } })).toBe('audioMessage|MSG1');
  });

  it('prefers speech to text over the audio reference', () => {
    expect(getConversationMessage({ key, message: { audioMessage: {}, speechToText: 'transcribed' } })).toBe(
      'transcribed',
    );
  });

  it('returns the latitude for location messages', () => {
    expect(
      getConversationMessage({ key, message: { locationMessage: { degreesLatitude: -32.89, degreesLongitude: -68 } } }),
    ).toBe('-32.89');
  });

  it('KNOWN BUG: throws for location messages without latitude (current behavior)', () => {
    expect(() => getConversationMessage({ key, message: { locationMessage: {} } })).toThrow(TypeError);
  });

  it.fails('does not throw for location messages without latitude', () => {
    expect(() => getConversationMessage({ key, message: { locationMessage: {} } })).not.toThrow();
  });

  it('returns the contact display name', () => {
    expect(getConversationMessage({ key, message: { contactMessage: { displayName: 'Ana' } } })).toBe('Ana');
  });

  it('returns the list response title', () => {
    expect(
      getConversationMessage({
        key,
        message: { listResponseMessage: { title: 'Option A', singleSelectReply: { selectedRowId: 'row-1' } } },
      }),
    ).toBe('Option A');
  });

  it('returns the selected row id when the list response has no title', () => {
    expect(
      getConversationMessage({
        key,
        message: { listResponseMessage: { singleSelectReply: { selectedRowId: 'row-1' } } },
      }),
    ).toBe('row-1');
  });

  it('returns the selected id of template and buttons responses', () => {
    expect(getConversationMessage({ key, message: { templateButtonReplyMessage: { selectedId: 'tpl' } } })).toBe('tpl');
    expect(getConversationMessage({ key, message: { buttonsResponseMessage: { selectedButtonId: 'btn' } } })).toBe(
      'btn',
    );
  });

  it('returns view once media urls', () => {
    expect(
      getConversationMessage({ key, message: { viewOnceMessageV2: { message: { imageMessage: { url: 'u1' } } } } }),
    ).toBe('u1');
  });

  it('appends the external ad reply body on a new line', () => {
    expect(
      getConversationMessage({
        key,
        message: { conversation: 'hi' },
        contextInfo: { externalAdReply: { body: 'Ad text' } },
      }),
    ).toBe('hi\nexternalAdReplyBody|Ad text');
  });

  it('KNOWN BUG: duplicates the external ad reply body when it is the only content (current behavior)', () => {
    expect(getConversationMessage({ key, message: {}, contextInfo: { externalAdReply: { body: 'Ad' } } })).toBe(
      'externalAdReplyBody\nexternalAdReplyBody|Ad',
    );
  });

  it.fails('returns only the external ad reply body when it is the only content', () => {
    expect(getConversationMessage({ key, message: {}, contextInfo: { externalAdReply: { body: 'Ad' } } })).toBe(
      'externalAdReplyBody|Ad',
    );
  });

  it('returns the first matching type when several are present', () => {
    expect(getConversationMessage({ key, message: { conversation: 'text', imageMessage: {} } })).toBe('text');
  });

  it('returns the message type name for unknown messages', () => {
    expect(getConversationMessage({ key, message: { reactionMessage: { text: '👍' } } })).toBe('unknown');
  });
});
