import { describe, expect, it } from 'vitest';

import { sha256, sha256Bytes, shortHash } from '../hash.js';

describe('sha256 helpers', () => {
  it('SHA-256 of empty string is the known constant', () => {
    expect(sha256('')).toBe('e3b0c44298fc1c149afbf4c8996fb92427ae41e4649b934ca495991b7852b855');
  });

  it('shortHash returns 12 hex chars', () => {
    const out = shortHash('hello');
    expect(out).toMatch(/^[0-9a-f]{12}$/);
    expect(out.length).toBe(12);
  });

  it('sha256Bytes matches sha256 of equivalent string', () => {
    const s = 'hello world';
    expect(sha256Bytes(new TextEncoder().encode(s))).toBe(sha256(s));
  });
});
