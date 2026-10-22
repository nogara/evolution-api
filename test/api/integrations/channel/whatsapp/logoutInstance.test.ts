import { BaileysStartupService } from '@api/integrations/channel/whatsapp/whatsapp.baileys.service';
import { Events } from '@api/types/wa.types';
import { Boom } from '@hapi/boom';
import { DisconnectReason } from 'baileys';
import { beforeEach, describe, expect, it, vi } from 'vitest';

vi.mock('@utils/use-multi-file-auth-state-prisma', () => ({
  default: vi.fn(async () => ({ removeCreds: vi.fn() })),
}));

vi.mock('@utils/use-multi-file-auth-state-redis-db', () => ({
  useMultiFileAuthStateRedisDb: vi.fn(async () => ({ removeCreds: vi.fn() })),
}));

const buildService = () => {
  const service = Object.create(BaileysStartupService.prototype) as any;
  const config: Record<string, unknown> = {
    DATABASE: { SAVE_DATA: { INSTANCE: true } },
    CACHE: { REDIS: { ENABLED: false } },
    PROVIDER: { ENABLED: false },
    CHATWOOT: { ENABLED: false },
  };
  service.messageProcessor = { onDestroy: vi.fn() };
  service.client = { logout: vi.fn(async () => undefined), ws: { close: vi.fn() }, end: vi.fn() };
  service.configService = { get: vi.fn((key: string) => config[key]) };
  service.prismaRepository = {
    instance: { update: vi.fn(async () => ({})) },
    session: { findFirst: vi.fn(async () => null), delete: vi.fn() },
  };
  service.instance = { id: 'instance-id', name: 'instance-name', wuid: 'wuid' };
  service.eventEmitter = { emit: vi.fn() };
  service.sendDataWebhook = vi.fn();
  service.connectToWhatsapp = vi.fn();
  service.localChatwoot = { enabled: false };
  service.cache = {};
  service.stateConnection = { state: 'open' };
  service.endSession = false;
  return service;
};

const connectionUpdates = (service: any) =>
  service.sendDataWebhook.mock.calls.filter(([event]: [string]) => event === Events.CONNECTION_UPDATE);

const logoutEmits = (service: any) =>
  service.eventEmitter.emit.mock.calls.filter(([event]: [string]) => event === 'logout.instance');

describe('BaileysStartupService.logoutInstance', () => {
  let service: any;

  beforeEach(() => {
    service = buildService();
  });

  it('closes the connection state immediately without waiting for Baileys', async () => {
    await service.logoutInstance();

    expect(service.connectionStatus).toEqual({ state: 'close', statusReason: DisconnectReason.loggedOut });
    expect(service.prismaRepository.instance.update).toHaveBeenCalledWith({
      where: { id: 'instance-id' },
      data: expect.objectContaining({
        connectionStatus: 'close',
        disconnectionReasonCode: DisconnectReason.loggedOut,
      }),
    });
    expect(connectionUpdates(service)).toEqual([
      [Events.CONNECTION_UPDATE, expect.objectContaining({ instance: 'instance-name', state: 'close' })],
    ]);
    expect(logoutEmits(service)).toHaveLength(1);
    expect(service.connectToWhatsapp).not.toHaveBeenCalled();
  });

  it('ignores the late Baileys loggedOut close event after logout', async () => {
    await service.logoutInstance();

    await service.connectionUpdate({
      connection: 'close',
      lastDisconnect: { error: new Boom('logged out', { statusCode: DisconnectReason.loggedOut }), date: new Date() },
    });

    expect(connectionUpdates(service)).toHaveLength(1);
    expect(logoutEmits(service)).toHaveLength(1);
    expect(service.connectToWhatsapp).not.toHaveBeenCalled();
  });

  it('emits logout.instance only after the session row is deleted', async () => {
    service.prismaRepository.session.findFirst.mockResolvedValue({ sessionId: 'instance-id' });

    await service.logoutInstance();

    const sessionDeleteOrder = service.prismaRepository.session.delete.mock.invocationCallOrder[0];
    const logoutEmitOrder =
      service.eventEmitter.emit.mock.invocationCallOrder[
        service.eventEmitter.emit.mock.calls.findIndex(([event]: [string]) => event === 'logout.instance')
      ];
    expect(sessionDeleteOrder).toBeLessThan(logoutEmitOrder);
  });

  it('still removes the session and emits logout.instance when persisting the closed state fails', async () => {
    service.prismaRepository.instance.update.mockRejectedValue(new Error('database unavailable'));
    service.prismaRepository.session.findFirst.mockResolvedValue({ sessionId: 'instance-id' });
    service.logger = { error: vi.fn() };

    await expect(service.logoutInstance()).resolves.toBeUndefined();

    expect(service.connectionStatus).toEqual({ state: 'close', statusReason: 401 });
    expect(service.prismaRepository.session.delete).toHaveBeenCalledWith({ where: { sessionId: 'instance-id' } });
    expect(logoutEmits(service)).toHaveLength(1);
    expect(service.logger.error).toHaveBeenCalled();
  });
});
