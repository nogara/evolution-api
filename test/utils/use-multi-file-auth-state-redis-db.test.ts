import { BufferJSON, initAuthCreds, proto } from 'baileys';
import { beforeEach, describe, expect, it, vi } from 'vitest';

const mocks = vi.hoisted(() => ({ loggers: [] as any[] }));

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

import { useMultiFileAuthStateRedisDb } from '@utils/use-multi-file-auth-state-redis-db';

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

describe('useMultiFileAuthStateRedisDb', () => {
  let cache: ReturnType<typeof createCache>;

  beforeEach(() => {
    mocks.loggers.length = 0;
    cache = createCache();
  });

  const open = () => useMultiFileAuthStateRedisDb('instance', cache as any);

  it('starts with fresh creds when nothing is stored', async () => {
    const { state } = await open();

    expect(state.creds.registered).toBe(false);
    expect(state.creds.noiseKey.private).toHaveLength(32);
    expect(cache.hashes.get('instance')?.has('creds')).toBe(false);
  });

  it('restores saved creds with binary fields intact after reopening', async () => {
    const first = await open();
    await first.saveCreds();

    const stored = cache.hashes.get('instance').get('creds');
    expect(typeof stored).toBe('string');

    const second = await open();

    expect(second.state.creds).toEqual(first.state.creds);
    expect(Buffer.isBuffer(second.state.creds.noiseKey.private)).toBe(true);
    expect(Buffer.from(second.state.creds.signedIdentityKey.public)).toEqual(
      Buffer.from(first.state.creds.signedIdentityKey.public),
    );
  });

  it('round trips pre-keys and sessions through serialized storage', async () => {
    const { state } = await open();
    const preKey = { public: Buffer.from([1, 2, 3]), private: new Uint8Array([4, 5, 6]) };
    const session = Buffer.from('session-bytes');

    await state.keys.set({ 'pre-key': { '1': preKey }, session: { 'jid.0': session } });

    const preKeys = await state.keys.get('pre-key', ['1', '2']);
    const sessions = await state.keys.get('session', ['jid.0']);

    expect(Buffer.isBuffer(preKeys['1'].public)).toBe(true);
    expect(Buffer.from(preKeys['1'].private)).toEqual(Buffer.from([4, 5, 6]));
    expect(preKeys['2']).toBeNull();
    expect(Buffer.from(sessions['jid.0'] as any)).toEqual(session);
  });

  it('restores app state sync keys as protobuf messages with byte key data', async () => {
    const { state } = await open();
    const keyData = new Uint8Array([9, 8, 7, 6]);
    const value = proto.Message.AppStateSyncKeyData.create({ keyData, timestamp: 1700 });

    await state.keys.set({ 'app-state-sync-key': { AAA: value } });

    expect(JSON.parse(cache.hashes.get('instance').get('app-state-sync-key-AAA')).keyData).toBe('CQgHBg==');

    const result = await state.keys.get('app-state-sync-key', ['AAA']);

    expect(result.AAA).toBeInstanceOf(proto.Message.AppStateSyncKeyData);
    expect(result.AAA.keyData).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result.AAA.keyData)).toEqual(Buffer.from(keyData));
  });

  it('decodes app state sync key data persisted as a base64 string', async () => {
    cache.hashes.set('instance', new Map([['app-state-sync-key-BBB', JSON.stringify({ keyData: 'AQID' })]]));
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

    expect(cache.hDelete).toHaveBeenCalledWith('instance', 'pre-key-1');
    expect(cache.hDelete).toHaveBeenCalledWith('instance', 'session-a');
    expect(await state.keys.get('pre-key', ['1'])).toEqual({ '1': null });
    expect(await state.keys.get('session', ['a'])).toEqual({ a: null });
  });

  it('clears the whole instance hash on removeCreds', async () => {
    const { saveCreds, removeCreds } = await open();
    await saveCreds();

    await removeCreds();

    expect(cache.delete).toHaveBeenCalledWith('instance');
    expect(cache.hashes.has('instance')).toBe(false);
    expect(lastLogger().warn).toHaveBeenCalledWith({ action: 'redis.delete', instanceName: 'instance' });
  });

  it('logs and swallows read, write and delete errors', async () => {
    const error = new Error('redis down');
    cache.hGet.mockRejectedValue(error);
    cache.hSet.mockRejectedValue(error);
    cache.hDelete.mockRejectedValue(error);
    cache.delete.mockRejectedValue(error);

    const { state, saveCreds, removeCreds } = await open();
    const logger = lastLogger();

    expect(state.creds.registered).toBe(false);
    await expect(saveCreds()).resolves.toBeUndefined();
    await expect(state.keys.set({ session: { a: Buffer.from([1]), b: null } })).resolves.toBeUndefined();
    await expect(state.keys.get('session', ['a'])).resolves.toEqual({ a: undefined });
    await expect(removeCreds()).resolves.toBeUndefined();

    expect(logger.error).toHaveBeenCalledWith({ localError: 'readData', error });
    expect(logger.error).toHaveBeenCalledWith({ localError: 'writeData', error });
    expect(logger.error).toHaveBeenCalledWith({ readData: 'removeData', error });
  });

  it('keeps the initial creds object when a fresh instance has nothing stored', async () => {
    const fresh = initAuthCreds();
    const { state } = await open();

    expect(Object.keys(state.creds).sort()).toEqual(Object.keys(fresh).sort());
  });
});
