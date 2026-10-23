import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { Events } from '@api/types/wa.types';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@api/server.module', () => ({
  chatbotController: { emit: vi.fn(async () => undefined) },
  waMonitor: {},
}));

vi.mock('@utils/onWhatsappCache', () => ({
  getOnWhatsappCache: vi.fn(async () => []),
  saveOnWhatsappCache: vi.fn(async () => undefined),
}));

vi.mock('@utils/sendTelemetry', () => ({ sendTelemetry: vi.fn() }));

vi.mock('@api/integrations/chatbot/chatwoot/utils/chatwoot-import-helper', () => ({
  chatwootImport: { getRepositoryMessagesCache: vi.fn(() => null), setRepositoryMessagesCache: vi.fn() },
}));

const buildCache = () => {
  const store = new Map<string, unknown>();
  return {
    store,
    get: vi.fn(async (key: string) => store.get(key)),
    set: vi.fn(async (key: string, value: unknown) => {
      store.set(key, value);
    }),
  };
};

const buildService = (baileysCache = buildCache()) => {
  const config: Record<string, unknown> = {
    LOG: { BAILEYS: 'error' },
    DATABASE: { SAVE_DATA: { NEW_MESSAGE: true, HISTORIC: true, MESSAGE_UPDATE: true, CHATS: false, CONTACTS: false } },
    CHATWOOT: { ENABLED: false },
    OPENAI: { ENABLED: false },
    S3: { ENABLE: false },
  };
  const configService = { get: vi.fn((key: string) => config[key]) } as any;
  const prismaRepository = {
    chat: { findFirst: vi.fn(async () => null), findMany: vi.fn(async () => []), createMany: vi.fn(async () => ({})) },
    message: {
      create: vi.fn(async ({ data }) => ({ id: 'row-id', ...data })),
      createMany: vi.fn(async () => ({})),
      findMany: vi.fn(async () => []),
      update: vi.fn(async () => ({})),
    },
    messageUpdate: { create: vi.fn(async () => ({})) },
    contact: { findFirst: vi.fn(async () => null) },
  } as any;
  const service = new BaileysStartupService(
    configService,
    { emit: vi.fn() } as any,
    prismaRepository,
    {} as any,
    {} as any,
    baileysCache as any,
    {} as any,
  ) as any;
  service.instance.id = 'instance-id';
  service.instance.name = 'instance-name';
  service.sendDataWebhook = vi.fn();
  service.profilePicture = vi.fn(async () => ({ profilePictureUrl: null }));
  service.updateMessagesReadedByTimestamp = vi.fn(async () => undefined);
  service.updateChatUnreadMessages = vi.fn(async () => undefined);
  service.client = { readMessages: vi.fn() };
  service.contactHandle = { 'contacts.upsert': vi.fn(async () => undefined) };
  return { service, prismaRepository, baileysCache };
};

const storedMessage = (id: string, remoteJid: string) => ({
  id: `row-${id}`,
  key: { id, remoteJid, fromMe: true },
  status: 'SERVER_ACK',
  messageTimestamp: 1700000000,
});

const updateWebhooks = (service: any) =>
  service.sendDataWebhook.mock.calls.filter(([event]) => event === Events.MESSAGES_UPDATE).map(([, data]) => data);

describe('messages.update without a remote jid in the key', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('records and emits the update with the stored message remote jid and keeps processing the batch', async () => {
    const { service, prismaRepository } = buildService();
    prismaRepository.$queryRaw = vi.fn(async (_strings: TemplateStringsArray, _instanceId: string, id: string) => [
      storedMessage(id, `${id === 'MSG-1' ? '5491111111111' : '5492222222222'}@s.whatsapp.net`),
    ]);

    await service.messageHandle['messages.update'](
      [
        { key: { id: 'MSG-1', fromMe: true }, update: { status: 3 } },
        { key: { id: 'MSG-2', fromMe: true, remoteJid: '5492222222222@s.whatsapp.net' }, update: { status: 3 } },
      ],
      {},
    );

    const recorded = prismaRepository.messageUpdate.create.mock.calls.map(([{ data }]) => data);
    expect(recorded.map((data) => [data.keyId, data.remoteJid])).toEqual([
      ['MSG-1', '5491111111111@s.whatsapp.net'],
      ['MSG-2', '5492222222222@s.whatsapp.net'],
    ]);
    expect(updateWebhooks(service).map((data) => data.remoteJid)).toEqual([
      '5491111111111@s.whatsapp.net',
      '5492222222222@s.whatsapp.net',
    ]);
  });
});
