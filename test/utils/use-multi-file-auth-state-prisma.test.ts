import { BufferJSON, proto } from 'baileys';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({
  loggers: [] as any[],
  cacheConf: { REDIS: { ENABLED: false } },
  sessions: new Map<string, string>(),
  files: new Map<string, string>(),
}));

vi.mock('@config/logger.config', () => ({
  Logger: class {
    info = vi.fn();
    warn = vi.fn();
    error = vi.fn();
    constructor() {
      mocks.loggers.push(this);
    }
  },
}));
vi.mock('@config/env.config', () => ({ configService: { get: vi.fn(() => mocks.cacheConf) } }));
vi.mock('@config/path.config', () => ({ INSTANCE_DIR: '/instances' }));
vi.mock('@api/services/cache.service', () => ({ CacheService: class {} }));
vi.mock('@api/server.module', () => ({
  prismaRepository: {
    session: {
      findUnique: vi.fn(async ({ where }) =>
        mocks.sessions.has(where.sessionId)
          ? { sessionId: where.sessionId, creds: mocks.sessions.get(where.sessionId) }
          : null,
      ),
      create: vi.fn(async ({ data }) => mocks.sessions.set(data.sessionId, data.creds)),
      update: vi.fn(async ({ where, data }) => mocks.sessions.set(where.sessionId, data.creds)),
      delete: vi.fn(async ({ where }) => mocks.sessions.delete(where.sessionId)),
    },
  },
}));
vi.mock('fs/promises', () => {
  const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });
  const fs = {
    mkdir: vi.fn(async () => undefined),
    stat: vi.fn(async (file: string) => {
      if (!mocks.files.has(file)) throw enoent();
      return { isFile: () => true };
    }),
    readFile: vi.fn(async (file: string) => {
      if (!mocks.files.has(file)) throw enoent();
      return mocks.files.get(file);
    }),
    writeFile: vi.fn(async (file: string, data: string) => {
      mocks.files.set(file, data);
    }),
    unlink: vi.fn(async (file: string) => {
      if (!mocks.files.delete(file)) throw enoent();
    }),
  };
  return { default: fs, ...fs };
});

import { prismaRepository } from '@api/server.module';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import fs from 'fs/promises';

const createCache = () => {
  const hashes = new Map<string, Map<string, string>>();
  const hash = (key: string) => {
    if (!hashes.has(key)) hashes.set(key, new Map());
    return hashes.get(key);
  };
  return {
    hashes,
    hSet: vi.fn(async (key: string, field: string, value: any) => {
      hash(key).set(field, JSON.stringify(value, BufferJSON.replacer));
    }),
    hGet: vi.fn(async (key: string, field: string) => {
      const data = hash(key).get(field);
      return data ? JSON.parse(data, BufferJSON.reviver) : null;
    }),
    hDelete: vi.fn(async (key: string, field: string) => {
      hash(key).delete(field);
      return true;
    }),
    delete: vi.fn(async (key: string) => {
      hashes.delete(key);
    }),
  };
};

const lastLogger = () => mocks.loggers[mocks.loggers.length - 1];

describe('useMultiFileAuthStatePrisma', () => {
  let cache: ReturnType<typeof createCache>;

  beforeEach(() => {
    vi.clearAllMocks();
    mocks.sessions.clear();
    mocks.files.clear();
    mocks.cacheConf.REDIS.ENABLED = false;
    cache = createCache();
  });

  const open = () => useMultiFileAuthStatePrisma('session', cache as any);

  it('creates and persists fresh creds when nothing is stored', async () => {
    const { state } = await open();

    expect(state.creds.registered).toBe(false);
    expect(state.creds.noiseKey.private).toHaveLength(32);
    expect(prismaRepository.session.create).toHaveBeenCalledTimes(1);
    expect(typeof JSON.parse(mocks.sessions.get('session'))).toBe('string');
  });

  it('restores saved creds with binary fields intact after reopening', async () => {
    const first = await open();
    first.state.creds.registered = true;
    await first.saveCreds();

    expect(prismaRepository.session.update).toHaveBeenCalledTimes(1);

    const second = await open();

    expect(second.state.creds).toEqual(first.state.creds);
    expect(second.state.creds.registered).toBe(true);
    expect(Buffer.isBuffer(second.state.creds.noiseKey.private)).toBe(true);
    expect(Buffer.from(second.state.creds.signedIdentityKey.public)).toEqual(
      Buffer.from(first.state.creds.signedIdentityKey.public),
    );
  });

  describe.each([
    ['local files', false],
    ['redis', true],
  ])('keys stored in %s', (_, redisEnabled) => {
    beforeEach(() => {
      mocks.cacheConf.REDIS.ENABLED = redisEnabled;
    });

    const storedKeys = () =>
      redisEnabled ? [...(cache.hashes.get('session')?.keys() ?? [])] : [...mocks.files.keys()];

    it('round trips pre-keys and sessions through serialized storage', async () => {
      const { state } = await open();
      const preKey = { public: Buffer.from([1, 2, 3]), private: new Uint8Array([4, 5, 6]) };
      const session = Buffer.from('session-bytes');

      await state.keys.set({ 'pre-key': { '1': preKey }, session: { '123@s.whatsapp.net:1': session } });

      const preKeys = await state.keys.get('pre-key', ['1', '2']);
      const sessions = await state.keys.get('session', ['123@s.whatsapp.net:1']);

      expect(Buffer.isBuffer(preKeys['1'].public)).toBe(true);
      expect(Buffer.from(preKeys['1'].private)).toEqual(Buffer.from([4, 5, 6]));
      expect(preKeys['2']).toBeNull();
      expect(Buffer.from(sessions['123@s.whatsapp.net:1'] as any)).toEqual(session);
      if (!redisEnabled) expect(storedKeys()).toContain('/instances/session/session-123@s.whatsapp.net-1.json');
    });

    it('restores app state sync keys as protobuf messages with byte key data', async () => {
      const { state } = await open();
      const keyData = new Uint8Array([9, 8, 7, 6]);
      const value = proto.Message.AppStateSyncKeyData.create({ keyData, timestamp: 1700 });

      await state.keys.set({ 'app-state-sync-key': { AAA: value } });

      const result = await state.keys.get('app-state-sync-key', ['AAA']);

      expect(result.AAA).toBeInstanceOf(proto.Message.AppStateSyncKeyData);
      expect(result.AAA.keyData).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(result.AAA.keyData)).toEqual(Buffer.from(keyData));
    });

    it('decodes app state sync key data persisted as a base64 string', async () => {
      const raw = JSON.stringify({ keyData: 'AQID' });
      if (redisEnabled) cache.hashes.set('session', new Map([['app-state-sync-key-BBB', raw]]));
      else mocks.files.set('/instances/session/app-state-sync-key-BBB.json', raw);
      const { state } = await open();

      const result = await state.keys.get('app-state-sync-key', ['BBB']);

      expect(result.BBB.keyData).toBeInstanceOf(Uint8Array);
      expect(Buffer.from(result.BBB.keyData)).toEqual(Buffer.from([1, 2, 3]));
    });

    it('removes keys set to null or undefined', async () => {
      const { state } = await open();
      await state.keys.set({ 'pre-key': { '1': { public: Buffer.from([1]), private: Buffer.from([2]) } } });
      await state.keys.set({ session: { a: Buffer.from([1]) } });

      await state.keys.set({ 'pre-key': { '1': null }, session: { a: undefined } });

      expect(storedKeys()).toEqual([]);
      expect(await state.keys.get('pre-key', ['1'])).toEqual({ '1': null });
    });
  });

  it('removes only the database creds on removeCreds without redis and leaves key files behind', async () => {
    const { state, removeCreds } = await open();
    await state.keys.set({ session: { a: Buffer.from([1]) } });

    await removeCreds();

    expect(mocks.sessions.has('session')).toBe(false);
    expect(mocks.files.size).toBe(1);
    expect(lastLogger().info).toHaveBeenCalledWith({ action: 'auth.key.delete', sessionId: 'session' });
  });

  it('clears the redis hash but keeps the database creds on removeCreds with redis', async () => {
    mocks.cacheConf.REDIS.ENABLED = true;
    const { state, removeCreds } = await open();
    await state.keys.set({ session: { a: Buffer.from([1]) } });

    await removeCreds();

    expect(cache.hashes.has('session')).toBe(false);
    expect(mocks.sessions.has('session')).toBe(true);
    expect(lastLogger().info).toHaveBeenCalledWith({ action: 'redis.delete', sessionId: 'session' });
  });

  it('logs the redis failure and falls back to deleting database creds', async () => {
    mocks.cacheConf.REDIS.ENABLED = true;
    const error = new Error('redis down');
    cache.delete.mockRejectedValue(error);
    const { removeCreds } = await open();

    await removeCreds();

    expect(lastLogger().warn).toHaveBeenCalledWith({ action: 'redis.delete', sessionId: 'session', err: error });
    expect(mocks.sessions.has('session')).toBe(false);
  });

  it('swallows database and file read errors without logging them', async () => {
    vi.mocked(prismaRepository.session.findUnique).mockRejectedValueOnce(new Error('db down'));
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('disk error'));
    mocks.files.set('/instances/session/session-a.json', '{}');

    const { state } = await open();
    const result = await state.keys.get('session', ['a']);

    expect(state.creds.registered).toBe(false);
    expect(result).toEqual({ a: null });
    expect(lastLogger().error).not.toHaveBeenCalled();
  });

  it('swallows database write errors and leaves creds unsaved', async () => {
    vi.mocked(prismaRepository.session.create).mockRejectedValue(new Error('db down'));

    const { saveCreds } = await open();

    await expect(saveCreds()).resolves.toBeUndefined();
    expect(mocks.sessions.has('session')).toBe(false);
    expect(lastLogger().error).not.toHaveBeenCalled();
  });

  it('propagates local file write errors from keys.set', async () => {
    const { state } = await open();
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('disk full'));

    await expect(state.keys.set({ session: { a: Buffer.from([1]) } })).rejects.toThrow('disk full');
  });

  it('swallows unlink errors when removing a missing key file', async () => {
    const { state } = await open();

    await expect(state.keys.set({ session: { missing: null } })).resolves.toBeUndefined();
  });
});
