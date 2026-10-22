import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  database: { SAVE_DATA: { IS_ON_WHATSAPP: true, IS_ON_WHATSAPP_DAYS: 7 } },
  isOnWhatsapp: { findFirst: vi.fn(), findMany: vi.fn(), create: vi.fn(), update: vi.fn() },
}));

vi.mock('@api/server.module', () => ({ prismaRepository: { isOnWhatsapp: mocks.isOnWhatsapp } }));
vi.mock('@config/env.config', () => ({ configService: { get: vi.fn(() => mocks.database) } }));
vi.mock('@config/logger.config', () => ({
  Logger: class {
    verbose = vi.fn();
    warn = vi.fn();
    error = vi.fn();
  },
}));

import { getOnWhatsappCache, saveOnWhatsappCache } from '@utils/onWhatsappCache';

const { isOnWhatsapp } = mocks;

const queriedJids = () =>
  isOnWhatsapp.findMany.mock.calls[0][0].where.OR.map((clause: any) => clause.jidOptions.contains);

describe('getOnWhatsappCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
    vi.clearAllMocks();
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = true;
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP_DAYS = 7;
    isOnWhatsapp.findMany.mockResolvedValue([]);
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('returns an empty list without querying when the cache is disabled', async () => {
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = false;

    expect(await getOnWhatsappCache(['5511987654321@s.whatsapp.net'])).toEqual([]);
    expect(isOnWhatsapp.findMany).not.toHaveBeenCalled();
  });

  it('only returns records updated within the configured number of days', async () => {
    await getOnWhatsappCache(['15551234567@s.whatsapp.net']);

    expect(isOnWhatsapp.findMany.mock.calls[0][0].where.updatedAt.gte).toEqual(new Date('2026-01-08T12:00:00.000Z'));
  });

  it('maps cache hits to remote jid, number, jid options and lid', async () => {
    isOnWhatsapp.findMany.mockResolvedValue([
      { remoteJid: '5511987654321@s.whatsapp.net', jidOptions: 'a@s.whatsapp.net,b@lid', lid: 'lid' },
    ]);

    expect(await getOnWhatsappCache(['5511987654321@s.whatsapp.net'])).toEqual([
      {
        remoteJid: '5511987654321@s.whatsapp.net',
        number: '5511987654321',
        jidOptions: ['a@s.whatsapp.net', 'b@lid'],
        lid: 'lid',
      },
    ]);
  });

  it('searches Brazilian numbers with and without the ninth digit', async () => {
    await getOnWhatsappCache(['5511987654321@s.whatsapp.net', '551187654321@s.whatsapp.net']);

    expect(queriedJids()).toEqual([
      '5511987654321@s.whatsapp.net',
      '551187654321@s.whatsapp.net',
      '5511987654321@s.whatsapp.net',
      '551187654321@s.whatsapp.net',
    ]);
  });

  it('searches Argentine numbers with and without the 9 prefix', async () => {
    await getOnWhatsappCache(['5492616107398@s.whatsapp.net', '542616107398@s.whatsapp.net']);

    expect(queriedJids()).toEqual([
      '5492616107398@s.whatsapp.net',
      '542616107398@s.whatsapp.net',
      '5492616107398@s.whatsapp.net',
      '542616107398@s.whatsapp.net',
    ]);
  });

  it('searches Mexican numbers with and without the 1 prefix', async () => {
    await getOnWhatsappCache(['525512345678@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['5215512345678@s.whatsapp.net', '525512345678@s.whatsapp.net']);
  });

  it('searches other numbers without the plus sign but with the domain appended twice', async () => {
    await getOnWhatsappCache(['+15551234567@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['15551234567@s.whatsapp.net@s.whatsapp.net']);
  });

  it('searches lid and group jids as given', async () => {
    await getOnWhatsappCache(['123456@lid', '5511999999999-1623281429@g.us']);

    expect(queriedJids()).toEqual(['123456@lid', '5511999999999-1623281429@g.us']);
  });

  it('appends an undefined domain to numbers without a domain', async () => {
    await getOnWhatsappCache(['15551234567']);

    expect(queriedJids()).toEqual(['15551234567@undefined']);
  });
});

describe('saveOnWhatsappCache', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = true;
    isOnWhatsapp.findFirst.mockResolvedValue(null);
  });

  it('does nothing when the cache is disabled', async () => {
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = false;

    await saveOnWhatsappCache([{ remoteJid: '15551234567@s.whatsapp.net' }]);

    expect(isOnWhatsapp.findFirst).not.toHaveBeenCalled();
  });

  it('skips items without a remote jid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '' }]);

    expect(isOnWhatsapp.findFirst).not.toHaveBeenCalled();
  });

  it('creates a record with sorted jid options when none exists', async () => {
    await saveOnWhatsappCache([{ remoteJid: '+5511987654321@s.whatsapp.net' }]);

    expect(isOnWhatsapp.create).toHaveBeenCalledWith({
      data: {
        remoteJid: '5511987654321@s.whatsapp.net',
        jidOptions: '551187654321@s.whatsapp.net,5511987654321@s.whatsapp.net',
        lid: null,
      },
    });
  });

  it('looks up existing records by jid options and remote jid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '15551234567@s.whatsapp.net' }]);

    expect(isOnWhatsapp.findFirst).toHaveBeenCalledWith({
      where: {
        OR: [
          { jidOptions: { contains: '15551234567@s.whatsapp.net@s.whatsapp.net' } },
          { remoteJid: '15551234567@s.whatsapp.net' },
        ],
      },
    });
  });

  it('adds a lid alternate jid and marks the record as lid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net', remoteJidAlt: '999@lid', lid: 'lid' }]);

    expect(isOnWhatsapp.create).toHaveBeenCalledWith({
      data: {
        remoteJid: '5511987654321@s.whatsapp.net',
        jidOptions: '551187654321@s.whatsapp.net,5511987654321@s.whatsapp.net,999@lid',
        lid: 'lid',
      },
    });
  });

  it('ignores alternate jids that are not lids', async () => {
    await saveOnWhatsappCache([{ remoteJid: '999@lid', remoteJidAlt: '15550000000@s.whatsapp.net' }]);

    expect(isOnWhatsapp.create.mock.calls[0][0].data.jidOptions).toBe('999@lid');
  });

  it('marks lid remote jids as lid', async () => {
    await saveOnWhatsappCache([{ remoteJid: '999@lid' }]);

    expect(isOnWhatsapp.create).toHaveBeenCalledWith({
      data: { remoteJid: '999@lid', jidOptions: '999@lid', lid: 'lid' },
    });
  });

  it('skips the update when the existing record is identical', async () => {
    isOnWhatsapp.findFirst.mockResolvedValue({
      id: 'r1',
      remoteJid: '5511987654321@s.whatsapp.net',
      jidOptions: '5511987654321@s.whatsapp.net,551187654321@s.whatsapp.net',
      lid: null,
    });

    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net' }]);

    expect(isOnWhatsapp.update).not.toHaveBeenCalled();
    expect(isOnWhatsapp.create).not.toHaveBeenCalled();
  });

  it('merges existing jid options into an update when data differs', async () => {
    isOnWhatsapp.findFirst.mockResolvedValue({
      id: 'r1',
      remoteJid: '15551234567@s.whatsapp.net',
      jidOptions: '888@lid',
      lid: null,
    });

    await saveOnWhatsappCache([{ remoteJid: '15551234567@s.whatsapp.net' }]);

    expect(isOnWhatsapp.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        remoteJid: '15551234567@s.whatsapp.net',
        jidOptions: '15551234567@s.whatsapp.net@s.whatsapp.net,888@lid',
        lid: null,
      },
    });
  });

  it('keeps processing other items when one fails', async () => {
    isOnWhatsapp.findFirst.mockRejectedValueOnce(new Error('db down')).mockResolvedValueOnce(null);

    await expect(
      saveOnWhatsappCache([{ remoteJid: '111@s.whatsapp.net' }, { remoteJid: '222@s.whatsapp.net' }]),
    ).resolves.toBeUndefined();
    expect(isOnWhatsapp.create).toHaveBeenCalledTimes(1);
  });
});
