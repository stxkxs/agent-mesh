import { createHash } from 'node:crypto';

import { describe, expect, it } from 'vitest';

// Re-implementation of dispatchBatch's stable stringify, exposed for testing.
const sha256Json = (value: unknown): string => {
  const stringify = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map((x) => stringify(x)).join(',')}]`;
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stringify(val)}`).join(',')}}`;
  };
  return createHash('sha256').update(stringify(value)).digest('hex');
};

describe('stable JSON sha256 (dispatchBatch idempotency hash)', () => {
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
