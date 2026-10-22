import { getOnWhatsappCache, saveOnWhatsappCache } from '@utils/onWhatsappCache';
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

const { isOnWhatsapp } = mocks;

const queriedJids = () =>
  isOnWhatsapp.findMany.mock.calls[0][0].where.OR.map((clause: any) => clause.jidOptions.contains);

describe('getOnWhatsappCache', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date('2026-01-15T12:00:00.000Z'));
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

  it('searches other numbers without the plus sign and with a single domain', async () => {
    await getOnWhatsappCache(['+15551234567@s.whatsapp.net']);

    expect(queriedJids()).toEqual(['15551234567@s.whatsapp.net']);
  });

  it('searches lid and group jids as given', async () => {
    await getOnWhatsappCache(['123456@lid', '5511999999999-1623281429@g.us']);

    expect(queriedJids()).toEqual(['123456@lid', '5511999999999-1623281429@g.us']);
  });

  it('searches numbers without a domain as user jids', async () => {
    await getOnWhatsappCache(['15551234567']);

    expect(queriedJids()).toEqual(['15551234567@s.whatsapp.net']);
  });
});

describe('saveOnWhatsappCache', () => {
  beforeEach(() => {
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
        OR: [{ jidOptions: { contains: '15551234567@s.whatsapp.net' } }, { remoteJid: '15551234567@s.whatsapp.net' }],
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

  it('updates when only the lid flag changes', async () => {
    isOnWhatsapp.findFirst.mockResolvedValue({
      id: 'r1',
      remoteJid: '5511987654321@s.whatsapp.net',
      jidOptions: '5511987654321@s.whatsapp.net,551187654321@s.whatsapp.net',
      lid: null,
    });

    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net', lid: 'lid' }]);

    expect(isOnWhatsapp.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        remoteJid: '5511987654321@s.whatsapp.net',
        jidOptions: '551187654321@s.whatsapp.net,5511987654321@s.whatsapp.net',
        lid: 'lid',
      },
    });
  });

  it('updates when only the remote jid changes', async () => {
    isOnWhatsapp.findFirst.mockResolvedValue({
      id: 'r1',
      remoteJid: '551187654321@s.whatsapp.net',
      jidOptions: '5511987654321@s.whatsapp.net,551187654321@s.whatsapp.net',
      lid: null,
    });

    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net' }]);

    expect(isOnWhatsapp.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        remoteJid: '5511987654321@s.whatsapp.net',
        jidOptions: '551187654321@s.whatsapp.net,5511987654321@s.whatsapp.net',
        lid: null,
      },
    });
  });

  it('updates an existing record without jid options with the expanded options', async () => {
    isOnWhatsapp.findFirst.mockResolvedValue({
      id: 'r1',
      remoteJid: '5511987654321@s.whatsapp.net',
      jidOptions: null,
      lid: null,
    });

    await saveOnWhatsappCache([{ remoteJid: '5511987654321@s.whatsapp.net' }]);

    expect(isOnWhatsapp.update).toHaveBeenCalledWith({
      where: { id: 'r1' },
      data: {
        remoteJid: '5511987654321@s.whatsapp.net',
        jidOptions: '551187654321@s.whatsapp.net,5511987654321@s.whatsapp.net',
        lid: null,
      },
    });
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
        jidOptions: '15551234567@s.whatsapp.net,888@lid',
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

describe('saveOnWhatsappCache with concurrent writers', () => {
  const rows: { id: string; remoteJid: string; jidOptions: string; lid: string | null }[] = [];
  const tick = () => new Promise((resolve) => setTimeout(resolve, 0));

  const uniqueViolation = () =>
    Object.assign(new Error('Unique constraint failed on the fields: (`remoteJid`)'), { code: 'P2002' });

  beforeEach(() => {
    rows.length = 0;
    mocks.database.SAVE_DATA.IS_ON_WHATSAPP = true;
    isOnWhatsapp.findFirst.mockImplementation(async ({ where }) => {
      await tick();
      return (
        rows.find((row) =>
          where.OR.some((clause: any) =>
            clause.remoteJid ? row.remoteJid === clause.remoteJid : row.jidOptions.includes(clause.jidOptions.contains),
          ),
        ) ?? null
      );
    });
    isOnWhatsapp.create.mockImplementation(async ({ data }) => {
      await tick();
      if (rows.some((row) => row.remoteJid === data.remoteJid)) throw uniqueViolation();
      const row = { id: `row-${rows.length}`, ...data };
      rows.push(row);
      return row;
    });
    isOnWhatsapp.update.mockImplementation(async ({ where, data }) => {
      await tick();
      const row = rows.find((candidate) => candidate.id === where.id);
      Object.assign(row, data);
      return row;
    });
  });

  it('saves a jid repeated in one batch as a single record without errors', async () => {
    await saveOnWhatsappCache([
      { remoteJid: '5491123456789@s.whatsapp.net' },
      { remoteJid: '5491123456789@s.whatsapp.net', remoteJidAlt: '999@lid' },
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].jidOptions.split(',')).toContain('999@lid');
  });

  it('saves the same jid from concurrent calls as a single record', async () => {
    await Promise.all([
      saveOnWhatsappCache([{ remoteJid: '5491123456789@s.whatsapp.net' }]),
      saveOnWhatsappCache([{ remoteJid: '5491123456789@s.whatsapp.net', remoteJidAlt: '999@lid' }]),
    ]);

    expect(rows).toHaveLength(1);
    expect(rows[0].jidOptions.split(',')).toContain('999@lid');
  });

  it('does not retry a create that fails for another reason', async () => {
    isOnWhatsapp.create.mockRejectedValueOnce(new Error('database unavailable'));

    await expect(saveOnWhatsappCache([{ remoteJid: '5491123456789@s.whatsapp.net' }])).resolves.toBeUndefined();

    expect(isOnWhatsapp.create).toHaveBeenCalledTimes(1);
    expect(rows).toHaveLength(0);
  });

  it('keeps saving other jids when the retry also fails', async () => {
    const conflictingJid = '5491123456789@s.whatsapp.net';
    const createRow = isOnWhatsapp.create.getMockImplementation();
    isOnWhatsapp.create.mockImplementation(async (args) => {
      if (args.data.remoteJid === conflictingJid) throw uniqueViolation();
      return createRow(args);
    });

    await expect(
      saveOnWhatsappCache([{ remoteJid: conflictingJid }, { remoteJid: '5491187654321@s.whatsapp.net' }]),
    ).resolves.toBeUndefined();

    expect(isOnWhatsapp.create.mock.calls.filter(([args]) => args.data.remoteJid === conflictingJid)).toHaveLength(2);
    expect(rows.map((row) => row.remoteJid)).toEqual(['5491187654321@s.whatsapp.net']);
  });
});
