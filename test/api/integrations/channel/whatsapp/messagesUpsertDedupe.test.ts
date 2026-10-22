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
    DATABASE: { SAVE_DATA: { NEW_MESSAGE: true, HISTORIC: true, CHATS: false, CONTACTS: false } },
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
    },
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

const message = (key: Record<string, unknown>) => ({
  key: { id: 'MSG-1', fromMe: false, ...key },
  message: { conversation: 'hello' },
  messageTimestamp: 1700000000,
  pushName: 'Someone',
});

const upsertWebhooks = (service: any) =>
  service.sendDataWebhook.mock.calls.filter(([event]) => event === Events.MESSAGES_UPSERT);

const syncHistory = (service: any, messages: unknown[]) =>
  service.messageHandle['messaging-history.set']({ messages, chats: [], contacts: [], isLatest: true, progress: 100 });

const storedHistoryRows = (prismaRepository: any) =>
  prismaRepository.message.createMany.mock.calls.flatMap(([{ data }]) => data);

const deliver = (service: any, received: unknown) =>
  service.messageHandle['messages.upsert']({ messages: [received], type: 'notify' }, {});

describe('messages.upsert dedupe', () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });

  it('stores and emits a redelivered message once', async () => {
    const { service, prismaRepository } = buildService();
    const received = { remoteJid: '5491123456789@s.whatsapp.net' };

    await deliver(service, message(received));
    await deliver(service, message(received));

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(1);
    expect(upsertWebhooks(service)).toHaveLength(1);
  });

  it('stores a message delivered with lid and phone jids once', async () => {
    const { service, prismaRepository } = buildService();

    await deliver(service, message({ remoteJid: '123456789@lid', remoteJidAlt: '5491123456789@s.whatsapp.net' }));
    await deliver(service, message({ remoteJid: '5491123456789@s.whatsapp.net' }));

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(1);
    expect(upsertWebhooks(service)).toHaveLength(1);
  });

  it('processes the phone delivery again when the first lid delivery had no phone', async () => {
    const { service, prismaRepository } = buildService();

    await deliver(service, message({ remoteJid: '123456789@lid' }));
    await deliver(service, message({ remoteJid: '123456789@lid' }));
    await deliver(service, message({ remoteJid: '5491123456789@s.whatsapp.net' }));

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(2);
    expect(upsertWebhooks(service)).toHaveLength(2);
  });

  it('processes a redelivery when storing the first delivery failed', async () => {
    const { service, prismaRepository } = buildService();
    prismaRepository.message.create.mockRejectedValueOnce(new Error('database unavailable'));
    const received = { remoteJid: '5491123456789@s.whatsapp.net' };

    await deliver(service, message(received));
    await deliver(service, message(received));

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(2);
    expect(upsertWebhooks(service)).toHaveLength(1);
  });

  it('keeps processing when the dedupe cache fails', async () => {
    const cache = buildCache();
    const failOnDedupeKey = async (key: string) => {
      if (key.startsWith('message_seen_')) throw new Error('cache down');
      return undefined;
    };
    cache.get.mockImplementation(failOnDedupeKey);
    cache.set.mockImplementation(failOnDedupeKey);
    const { service, prismaRepository } = buildService(cache);

    await deliver(service, message({ remoteJid: '5491123456789@s.whatsapp.net' }));

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(1);
    expect(upsertWebhooks(service)).toHaveLength(1);
  });

  it('processes every message that has no id', async () => {
    const { service, prismaRepository } = buildService();

    await deliver(service, message({ id: undefined, remoteJid: '5491123456789@s.whatsapp.net' }));
    await deliver(service, message({ id: undefined, remoteJid: '5491187654321@s.whatsapp.net' }));

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(2);
  });

  it('stores a history message delivered with lid and phone jids once', async () => {
    const { service, prismaRepository } = buildService();

    await syncHistory(service, [
      message({ remoteJid: '123456789@lid', remoteJidAlt: '5491123456789@s.whatsapp.net' }),
      message({ remoteJid: '5491123456789@s.whatsapp.net' }),
    ]);

    expect(storedHistoryRows(prismaRepository)).toHaveLength(1);
  });

  it('keeps the phone copy of a history message whose lid copy had no phone', async () => {
    const { service, prismaRepository } = buildService();

    await syncHistory(service, [
      message({ remoteJid: '123456789@lid' }),
      message({ remoteJid: '5491123456789@s.whatsapp.net' }),
    ]);

    expect(storedHistoryRows(prismaRepository)).toHaveLength(2);
  });

  it('skips a live redelivery of a message stored by history sync', async () => {
    const { service, prismaRepository } = buildService();
    const received = message({ remoteJid: '5491123456789@s.whatsapp.net' });

    await syncHistory(service, [received]);
    await deliver(service, received);

    expect(storedHistoryRows(prismaRepository)).toHaveLength(1);
    expect(prismaRepository.message.create).not.toHaveBeenCalled();
  });

  it('processes a live delivery when storing the history batch failed', async () => {
    const { service, prismaRepository } = buildService();
    prismaRepository.message.createMany.mockRejectedValueOnce(new Error('database unavailable'));
    const received = message({ remoteJid: '5491123456789@s.whatsapp.net' });

    await syncHistory(service, [received]);
    await deliver(service, received);

    expect(prismaRepository.message.create).toHaveBeenCalledTimes(1);
  });
});
