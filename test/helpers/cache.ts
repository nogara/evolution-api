import { ICache } from '@api/abstract/abstract.cache';
import { CacheService } from '@api/services/cache.service';
import { BufferJSON } from 'baileys';
import { vi } from 'vitest';

export class InMemoryRedisCache implements ICache {
  readonly hashes = new Map<string, Map<string, string>>();
  readonly values = new Map<string, string>();
  down = false;
  readonly error = new Error('redis down');

  private hash(key: string) {
    if (!this.hashes.has(key)) this.hashes.set(key, new Map());
    return this.hashes.get(key);
  }

  private ensureUp() {
    if (this.down) throw this.error;
  }

  async get(key: string) {
    this.ensureUp();
    return JSON.parse(this.values.get(key) ?? 'null');
  }

  async hGet(key: string, field: string) {
    this.ensureUp();
    const data = this.hashes.get(key)?.get(field);
    if (data) {
      return JSON.parse(data, BufferJSON.reviver);
    }
    return null;
  }

  async set(key: string, value: any) {
    this.ensureUp();
    this.values.set(key, JSON.stringify(value));
  }

  async hSet(key: string, field: string, value: any) {
    this.ensureUp();
    this.hash(key).set(field, JSON.stringify(value, BufferJSON.replacer));
  }

  async has(key: string) {
    this.ensureUp();
    return this.values.has(key) || this.hashes.has(key);
  }

  async delete(key: string) {
    this.ensureUp();
    const existed = this.values.delete(key) || this.hashes.delete(key);
    return existed ? 1 : 0;
  }

  async hDelete(key: string, field: string) {
    this.ensureUp();
    return this.hashes.get(key)?.delete(field) ? 1 : 0;
  }

  async keys() {
    this.ensureUp();
    return [...new Set([...this.values.keys(), ...this.hashes.keys()])];
  }

  async deleteAll() {
    this.ensureUp();
    const count = this.values.size + this.hashes.size;
    this.values.clear();
    this.hashes.clear();
    return count;
  }

  readRaw(key: string, field: string) {
    const data = this.hashes.get(key)?.get(field);
    return data === undefined ? undefined : JSON.parse(data, BufferJSON.reviver);
  }

  writeRaw(key: string, field: string, raw: string) {
    this.hash(key).set(field, JSON.stringify(raw, BufferJSON.replacer));
  }
}

export const createCacheService = () => {
  const inner = new InMemoryRedisCache();
  const service = new CacheService(inner);
  vi.spyOn(service, 'hDelete');
  vi.spyOn(service, 'delete');
  return { inner, service };
};
