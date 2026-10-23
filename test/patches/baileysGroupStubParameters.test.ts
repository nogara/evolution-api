import { proto, WAMessageStubType } from 'baileys';
import processMessage from 'baileys/lib/Utils/process-message.js';
import { describe, expect, it, vi } from 'vitest';

const groupStub = (messageStubType: number, messageStubParameters: string[]) =>
  ({
    key: { remoteJid: '120363000000000000@g.us', fromMe: false, id: 'STUB-1', participant: '111111111111111@lid' },
    messageStubType,
    messageStubParameters,
    messageTimestamp: 1700000000,
  }) as proto.IWebMessageInfo;

const run = async (message: proto.IWebMessageInfo) => {
  const ev = { emit: vi.fn() };
  await processMessage(
    message as any,
    {
      shouldProcessHistoryMsg: false,
      ev,
      creds: { me: { id: '5491100000000@s.whatsapp.net', lid: '999999999999999@lid' } },
      signalRepository: {},
      keyStore: {},
      logger: undefined,
      options: {},
      getMessage: vi.fn(),
    } as any,
  );
  return ev.emit.mock.calls.filter(([event]) => event === 'group-participants.update').map(([, data]) => data);
};

describe('processMessage group stub parameters', () => {
  it('emits a number change whose parameters are plain jids', async () => {
    const updates = await run(groupStub(WAMessageStubType.GROUP_PARTICIPANT_CHANGE_NUMBER, ['222222222222222@lid']));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ id: '120363000000000000@g.us', action: 'modify' });
    expect(updates[0].participants).toEqual([{ id: '222222222222222@lid' }]);
  });

  it('keeps parsing participants serialized as JSON', async () => {
    const participant = { id: '333333333333333@lid', phoneNumber: '5491133333333@s.whatsapp.net' };
    const updates = await run(groupStub(WAMessageStubType.GROUP_PARTICIPANT_ADD, [JSON.stringify(participant)]));

    expect(updates).toHaveLength(1);
    expect(updates[0]).toMatchObject({ action: 'add', participants: [participant] });
  });
});
