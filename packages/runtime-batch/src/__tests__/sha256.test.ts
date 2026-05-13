import { describe, expect, it } from 'vitest';

import { sha256Json } from '../index.js';

describe('sha256Json (stable JSON hash, imported from production code)', () => {
  it('produces the same hash regardless of key order', () => {
    const a = sha256Json({ priority: 'high', topic: 'outage' });
    const b = sha256Json({ topic: 'outage', priority: 'high' });
    expect(a).toBe(b);
  });

  it('different values produce different hashes', () => {
    const a = sha256Json({ priority: 'high' });
    const b = sha256Json({ priority: 'low' });
    expect(a).not.toBe(b);
  });

  it('handles nested objects + arrays', () => {
    const a = sha256Json({ tags: ['a', 'b'], meta: { z: 1, a: 2 } });
    const b = sha256Json({ meta: { a: 2, z: 1 }, tags: ['a', 'b'] });
    expect(a).toBe(b);
  });

  it('array order matters (intentionally)', () => {
    const a = sha256Json({ tags: ['a', 'b'] });
    const b = sha256Json({ tags: ['b', 'a'] });
    expect(a).not.toBe(b);
  });

  it('hash is hex 64 chars', () => {
    expect(sha256Json({ x: 1 })).toMatch(/^[0-9a-f]{64}$/);
  });
});
