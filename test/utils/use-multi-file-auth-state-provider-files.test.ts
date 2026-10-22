import { proto } from 'baileys';
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

import { AuthStateProvider } from '@utils/use-multi-file-auth-state-provider-files';

const createProviderFiles = () => {
  const files = new Map<string, string>();
  const path = (instance: string, key: string) => `${instance}/${key}`;
  return {
    files,
    parseResponses: true,
    create: vi.fn(async (): Promise<[any, any?]> => [{ status: 201 }]),
    write: vi.fn(async (instance: string, key: string, body: { data: string }): Promise<[any, any?]> => {
      files.set(path(instance, key), body.data);
      return [{ status: 201, data: 'ok' }];
    }),
    read: vi.fn(async function (instance: string, key: string): Promise<[any, any?]> {
      const stored = files.get(path(instance, key));
      if (stored === undefined) return [{ status: 404 }, new Error('not found')];
      return [{ status: 200, data: this.parseResponses ? JSON.parse(stored) : stored }];
    }),
    delete: vi.fn(async (instance: string, key: string): Promise<[any, any?]> => {
      files.delete(path(instance, key));
      return [{ status: 200 }];
    }),
    removeSession: vi.fn(async (instance: string): Promise<[any, any?]> => {
      for (const key of [...files.keys()]) if (key.startsWith(`${instance}/`)) files.delete(key);
      return [{ status: 200, data: 'removed' }];
    }),
  };
};

describe('AuthStateProvider', () => {
  let providerFiles: ReturnType<typeof createProviderFiles>;

  beforeEach(() => {
    providerFiles = createProviderFiles();
  });

  const open = () => new AuthStateProvider(providerFiles as any).authStateProvider('instance');

  it('starts with fresh creds when nothing is stored', async () => {
    const { state } = await open();

    expect(providerFiles.create).toHaveBeenCalledWith('instance');
    expect(state.creds.registered).toBe(false);
    expect(state.creds.noiseKey.private).toHaveLength(32);
  });

  it('restores saved creds with binary fields intact after reopening', async () => {
    const first = await open();
    await first.saveCreds();

    expect(typeof providerFiles.files.get('instance/creds')).toBe('string');

    const second = await open();

    expect(second.state.creds).toEqual(first.state.creds);
    expect(Buffer.isBuffer(second.state.creds.noiseKey.private)).toBe(true);
    expect(Buffer.from(second.state.creds.signedIdentityKey.public)).toEqual(
      Buffer.from(first.state.creds.signedIdentityKey.public),
    );
  });

  it('KNOWN BUG: returns creds as an unparsed string when the provider responds with raw text (current behavior)', async () => {
    const first = await open();
    await first.saveCreds();
    providerFiles.parseResponses = false;

    const second = await open();

    expect(typeof second.state.creds).toBe('string');
  });

  it.fails('parses creds when the provider responds with raw text', async () => {
    const first = await open();
    await first.saveCreds();
    providerFiles.parseResponses = false;

    const second = await open();

    expect(second.state.creds).toEqual(first.state.creds);
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
    expect(preKeys['2']).toBeUndefined();
    expect(Buffer.from(sessions['jid.0'] as any)).toEqual(session);
  });

  it('restores app state sync keys as protobuf messages with byte key data', async () => {
    const { state } = await open();
    const keyData = new Uint8Array([9, 8, 7, 6]);
    const value = proto.Message.AppStateSyncKeyData.create({ keyData, timestamp: 1700 });

    await state.keys.set({ 'app-state-sync-key': { AAA: value } });

    expect(JSON.parse(providerFiles.files.get('instance/app-state-sync-key-AAA')).keyData).toBe('CQgHBg==');

    const result = await state.keys.get('app-state-sync-key', ['AAA']);

    expect(result.AAA).toBeInstanceOf(proto.Message.AppStateSyncKeyData);
    expect(result.AAA.keyData).toBeInstanceOf(Uint8Array);
    expect(Buffer.from(result.AAA.keyData)).toEqual(Buffer.from(keyData));
  });

  it('decodes app state sync key data persisted as a base64 string', async () => {
    providerFiles.files.set('instance/app-state-sync-key-BBB', JSON.stringify({ keyData: 'AQID' }));
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

    expect(providerFiles.delete).toHaveBeenCalledWith('instance', 'pre-key-1');
    expect(providerFiles.delete).toHaveBeenCalledWith('instance', 'session-a');
    expect(providerFiles.files.size).toBe(0);
  });

  it('removes the whole session on removeCreds', async () => {
    const { saveCreds, removeCreds } = await open();
    await saveCreds();

    await removeCreds();

    expect(providerFiles.removeSession).toHaveBeenCalledWith('instance');
    expect(providerFiles.files.size).toBe(0);
    expect(mocks.loggers.some((logger) => logger.info.mock.calls.length > 0)).toBe(true);
  });

  it('returns undefined and logs when the session folder cannot be created', async () => {
    const error = new Error('provider offline');
    providerFiles.create.mockResolvedValue([{ status: 500 }, error]);

    const result = await open();

    expect(result).toBeUndefined();
    expect(mocks.loggers.some((logger) => logger.error.mock.calls.length > 0)).toBe(true);
  });

  it('KNOWN BUG: swallows read, write and delete errors without logging them (current behavior)', async () => {
    const error = new Error('provider down');
    providerFiles.read.mockResolvedValue([{ status: 500 }, error]);
    providerFiles.write.mockResolvedValue([{ status: 500 }, error]);
    providerFiles.delete.mockResolvedValue([{ status: 500 }, error]);
    providerFiles.removeSession.mockResolvedValue([{ status: 500 }, error]);

    const { state, saveCreds, removeCreds } = await open();

    expect(state.creds.registered).toBe(false);
    await expect(saveCreds()).resolves.toBeUndefined();
    await expect(state.keys.set({ session: { a: Buffer.from([1]), b: null } })).resolves.toBeUndefined();
    await expect(state.keys.get('session', ['a'])).resolves.toEqual({ a: undefined });
    await expect(removeCreds()).resolves.toBeUndefined();

    for (const logger of mocks.loggers) {
      expect(logger.error).not.toHaveBeenCalled();
      expect(logger.info).not.toHaveBeenCalled();
    }
  });

  it.fails('logs read, write and delete errors', async () => {
    const error = new Error('provider down');
    providerFiles.read.mockResolvedValue([{ status: 500 }, error]);
    providerFiles.write.mockResolvedValue([{ status: 500 }, error]);
    providerFiles.delete.mockResolvedValue([{ status: 500 }, error]);
    providerFiles.removeSession.mockResolvedValue([{ status: 500 }, error]);

    const { state, saveCreds, removeCreds } = await open();
    await saveCreds();
    await state.keys.set({ session: { a: Buffer.from([1]), b: null } });
    await state.keys.get('session', ['a']);
    await removeCreds();

    expect(mocks.loggers.some((logger) => logger.error.mock.calls.length > 0)).toBe(true);
  });
});
