import { AsyncLocalStorage } from 'async_hooks';
import { addTransactionCapability, SignalKeyStore } from 'baileys';
import { describe, expect, it, vi } from 'vitest';

const silentLogger = (): any => ({
  level: 'silent',
  child: () => silentLogger(),
  trace: () => {},
  debug: () => {},
  info: () => {},
  warn: () => {},
  error: () => {},
  fatal: () => {},
});

const makeInMemoryStore = () => {
  const data: Record<string, Record<string, unknown>> = {};
  const store: SignalKeyStore = {
    async get(type: string, ids: string[]) {
      const bucket = data[type] ?? {};
      const out: Record<string, unknown> = {};
      for (const id of ids) {
        if (bucket[id] !== undefined) out[id] = bucket[id];
      }
      return out as any;
    },
    async set(d: any) {
      for (const type of Object.keys(d)) {
        data[type] = data[type] ?? {};
        for (const id of Object.keys(d[type])) {
          const v = d[type][id];
          if (v === null || v === undefined) delete data[type][id];
          else data[type][id] = v;
        }
      }
    },
  } as any;
  return store;
};

const opts = { maxCommitRetries: 1, delayBetweenTriesMs: 1 };
const read = async (store: SignalKeyStore, id = '1') => (await store.get('app-state-sync-key', [id]))[id];
const write = (keyId: number, id = '1') => ({ 'app-state-sync-key': { [id]: { keyId } } }) as any;

describe('addTransactionCapability isolation', () => {
  it('writes to store B inside a transaction of store A go to B only', async () => {
    const backingA = makeInMemoryStore();
    const backingB = makeInMemoryStore();
    const a = addTransactionCapability(backingA, silentLogger(), opts);
    const b = addTransactionCapability(backingB, silentLogger(), opts);

    await a.transaction(async () => {
      expect(b.isInTransaction()).toBe(false);
      await b.set(write(9));
      await a.set(write(1));

      expect(await read(backingB)).toMatchObject({ keyId: 9 });
      expect(await read(backingA)).toBeUndefined();
    }, 'key');

    expect(await read(backingA)).toMatchObject({ keyId: 1 });
    expect(await read(backingB)).toMatchObject({ keyId: 9 });
  });

  it('keeps a nested transaction on another store isolated', async () => {
    const backingA = makeInMemoryStore();
    const backingB = makeInMemoryStore();
    const a = addTransactionCapability(backingA, silentLogger(), opts);
    const b = addTransactionCapability(backingB, silentLogger(), opts);

    await a.transaction(async () => {
      await a.set(write(1));
      await b.transaction(async () => {
        expect(a.isInTransaction()).toBe(true);
        expect(b.isInTransaction()).toBe(true);
        await b.set(write(2));
      }, 'key');

      expect(b.isInTransaction()).toBe(false);
      expect(a.isInTransaction()).toBe(true);
      expect(await read(backingB)).toMatchObject({ keyId: 2 });
      expect(await read(backingA)).toBeUndefined();
    }, 'key');

    expect(await read(backingA)).toMatchObject({ keyId: 1 });
  });

  it('reuses the context for a nested transaction on the same store', async () => {
    const backing = makeInMemoryStore();
    const a = addTransactionCapability(backing, silentLogger(), opts);

    await a.transaction(async () => {
      await a.set(write(1));
      await a.transaction(async () => {
        await a.set(write(2, '2'));
        expect(await read(a)).toMatchObject({ keyId: 1 });
      }, 'other');

      expect(await read(backing, '2')).toBeUndefined();
      expect(await read(a, '2')).toMatchObject({ keyId: 2 });
    }, 'key');

    expect(await read(backing)).toMatchObject({ keyId: 1 });
    expect(await read(backing, '2')).toMatchObject({ keyId: 2 });
  });

  it('get inside a transaction sees pending writes of its own store only', async () => {
    const backingA = makeInMemoryStore();
    const backingB = makeInMemoryStore();
    const a = addTransactionCapability(backingA, silentLogger(), opts);
    const b = addTransactionCapability(backingB, silentLogger(), opts);

    await a.transaction(async () => {
      await a.set(write(1));
      expect(await read(a)).toMatchObject({ keyId: 1 });
      expect(await read(b)).toBeUndefined();
    }, 'key');
  });

  it('runs every transaction on one shared AsyncLocalStorage', async () => {
    const instances = new Set<AsyncLocalStorage<unknown>>();
    const originalRun = AsyncLocalStorage.prototype.run;
    vi.spyOn(AsyncLocalStorage.prototype, 'run').mockImplementation(function (
      this: AsyncLocalStorage<unknown>,
      ...args: Parameters<typeof originalRun>
    ) {
      instances.add(this);
      return originalRun.apply(this, args);
    });

    for (let i = 0; i < 20; i++) {
      const keys = addTransactionCapability(makeInMemoryStore(), silentLogger(), opts);
      await keys.transaction(async () => {}, `key-${i}`);
    }

    expect(instances.size).toBe(1);
  });
});
