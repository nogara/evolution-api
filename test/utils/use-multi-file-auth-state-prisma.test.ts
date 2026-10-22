import { prismaRepository } from '@api/server.module';
import { CacheService } from '@api/services/cache.service';
import useMultiFileAuthStatePrisma from '@utils/use-multi-file-auth-state-prisma';
import { proto } from 'baileys';
import fs from 'fs/promises';
import { beforeEach, describe, expect, it, vi } from 'vitest';

import { createCacheService, InMemoryRedisCache } from '../helpers/cache';
import { files } from '../helpers/fs-promises';
import { loggersNamed, onlyLoggerNamed } from '../helpers/logger';

const mocks = vi.hoisted(() => ({
  cacheConf: { REDIS: { ENABLED: false } },
  sessions: new Map<string, string>(),
}));

vi.mock('@config/logger.config', async () => (await import('../helpers/logger')).loggerModule);
vi.mock('@config/env.config', () => ({ configService: { get: vi.fn(() => mocks.cacheConf) } }));
vi.mock('@config/path.config', () => ({ INSTANCE_DIR: '/instances' }));
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
vi.mock('fs/promises', async () => (await import('../helpers/fs-promises')).fsPromisesModule);

describe('useMultiFileAuthStatePrisma', () => {
  let inner: InMemoryRedisCache;
  let cache: CacheService;

  beforeEach(() => {
    mocks.sessions.clear();
    files.clear();
    mocks.cacheConf.REDIS.ENABLED = false;
    ({ inner, service: cache } = createCacheService());
  });

  const open = () => useMultiFileAuthStatePrisma('session', cache);
  const authLogger = () => onlyLoggerNamed('useMultiFileAuthStatePrisma');

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

    const storedKeys = () => (redisEnabled ? [...(inner.hashes.get('session')?.keys() ?? [])] : [...files.keys()]);

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
      if (redisEnabled) inner.writeRaw('session', 'app-state-sync-key-BBB', raw);
      else files.set('/instances/session/app-state-sync-key-BBB.json', raw);
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

  it('maps slashes in key names to double underscores in local file paths', async () => {
    const { state } = await open();

    await state.keys.set({ session: { 'a/b': Buffer.from([1]) } });

    expect([...files.keys()]).toContain('/instances/session/session-a__b.json');
  });

  it('KNOWN BUG: leaves local key files behind on removeCreds without redis (current behavior)', async () => {
    const { state, removeCreds } = await open();
    await state.keys.set({ session: { a: Buffer.from([1]) } });

    await removeCreds();

    expect(mocks.sessions.has('session')).toBe(false);
    expect(files.size).toBe(1);
    expect(authLogger().info).toHaveBeenCalledWith({ action: 'auth.key.delete', sessionId: 'session' });
  });

  it.fails('removes the database creds and local key files on removeCreds without redis', async () => {
    const { state, removeCreds } = await open();
    await state.keys.set({ session: { a: Buffer.from([1]) } });

    await removeCreds();

    expect(mocks.sessions.has('session')).toBe(false);
    expect(files.size).toBe(0);
  });

  it('KNOWN BUG: keeps the database creds on removeCreds with redis (current behavior)', async () => {
    mocks.cacheConf.REDIS.ENABLED = true;
    const { state, removeCreds } = await open();
    await state.keys.set({ session: { a: Buffer.from([1]) } });

    await removeCreds();

    expect(inner.hashes.has('session')).toBe(false);
    expect(mocks.sessions.has('session')).toBe(true);
    expect(authLogger().info).toHaveBeenCalledWith({ action: 'redis.delete', sessionId: 'session' });
  });

  it.fails('clears the redis hash and the database creds on removeCreds with redis', async () => {
    mocks.cacheConf.REDIS.ENABLED = true;
    const { state, removeCreds } = await open();
    await state.keys.set({ session: { a: Buffer.from([1]) } });

    await removeCreds();

    expect(inner.hashes.has('session')).toBe(false);
    expect(mocks.sessions.has('session')).toBe(false);
  });

  it('logs the redis failure and falls back to deleting database creds', async () => {
    mocks.cacheConf.REDIS.ENABLED = true;
    const { removeCreds } = await open();
    inner.down = true;

    await removeCreds();

    expect(authLogger().warn).toHaveBeenCalledWith({ action: 'redis.delete', sessionId: 'session', err: inner.error });
    expect(mocks.sessions.has('session')).toBe(false);
  });

  it('drops redis key writes and reads without throwing when redis is down', async () => {
    mocks.cacheConf.REDIS.ENABLED = true;
    const { state } = await open();
    inner.down = true;

    await expect(state.keys.set({ session: { a: Buffer.from([1]), b: null } })).resolves.toBeUndefined();
    await expect(state.keys.get('session', ['a'])).resolves.toEqual({ a: null });
    inner.down = false;

    expect(inner.hashes.get('session')?.has('session-a')).toBeFalsy();
    expect(await state.keys.get('session', ['a'])).toEqual({ a: null });
    expect(loggersNamed('CacheService').slice(-1)[0].error).toHaveBeenCalledWith(inner.error);
  });

  it('swallows database and file read errors without logging them', async () => {
    vi.mocked(prismaRepository.session.findUnique).mockRejectedValueOnce(new Error('db down'));
    vi.mocked(fs.readFile).mockRejectedValueOnce(new Error('disk error'));
    files.set('/instances/session/session-a.json', '{}');

    const { state } = await open();
    const result = await state.keys.get('session', ['a']);

    expect(state.creds.registered).toBe(false);
    expect(result).toEqual({ a: null });
    expect(authLogger().error).not.toHaveBeenCalled();
  });

  it('swallows database write errors and leaves creds unsaved', async () => {
    vi.mocked(prismaRepository.session.create).mockRejectedValue(new Error('db down'));

    const { saveCreds } = await open();

    await expect(saveCreds()).resolves.toBeUndefined();
    expect(mocks.sessions.has('session')).toBe(false);
    expect(authLogger().error).not.toHaveBeenCalled();
  });

  it('KNOWN BUG: rejects keys.set when a local file write fails (current behavior)', async () => {
    const { state } = await open();
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('disk full'));

    await expect(state.keys.set({ session: { a: Buffer.from([1]) } })).rejects.toThrow('disk full');
  });

  it.fails('swallows local file write errors in keys.set like other storage errors', async () => {
    const { state } = await open();
    vi.mocked(fs.writeFile).mockRejectedValueOnce(new Error('disk full'));

    await expect(state.keys.set({ session: { a: Buffer.from([1]) } })).resolves.toBeUndefined();
  });

  it('swallows unlink errors when removing a missing key file', async () => {
    const { state } = await open();

    await expect(state.keys.set({ session: { missing: null } })).resolves.toBeUndefined();
  });
});
