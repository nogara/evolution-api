import { createJid } from '@utils/createJid';
import { describe, expect, it } from 'vitest';

describe('vitest setup', () => {
  it('resolves tsconfig path aliases', () => {
    expect(typeof createJid).toBe('function');
  });
});
