import { vi } from 'vitest';

export const files = new Map<string, string>();

const enoent = () => Object.assign(new Error('ENOENT'), { code: 'ENOENT' });

const fs = {
  mkdir: vi.fn(async () => undefined),
  stat: vi.fn(async (file: string) => {
    if (!files.has(file)) throw enoent();
    return { isFile: () => true };
  }),
  readFile: vi.fn(async (file: string) => {
    if (!files.has(file)) throw enoent();
    return files.get(file);
  }),
  writeFile: vi.fn(async (file: string, data: string) => {
    files.set(file, data);
  }),
  unlink: vi.fn(async (file: string) => {
    if (!files.delete(file)) throw enoent();
  }),
};

export const fsPromisesModule = { default: fs, ...fs };
