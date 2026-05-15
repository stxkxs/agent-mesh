import { describe, expect, it } from 'vitest';

import { redact } from '../redactor.js';

// Build email strings programmatically — the linter/sanitizer in some
// authoring environments rewrites literal "<local>@<domain>" patterns to
// "[email protected]". Programmatic construction keeps the regex test honest.
const email = (local: string, domain: string) => `${local}@${domain}`;

describe('redact', () => {
  it('replaces SSN with [REDACTED:US_SSN]', () => {
    const r = redact('My SSN is 123-45-6789');
    expect(r.text).toBe('My SSN is [REDACTED:US_SSN]');
    expect(r.detections).toContainEqual({ entityType: 'US_SSN', count: 1 });
  });

  it('replaces email + AWS access key in one pass', () => {
    const e = email('foo', 'acme.com');
    const r = redact(`From ${e} with key AKIAIOSFODNN7EXAMPLE`);
    expect(r.text).not.toContain(e);
    expect(r.text).not.toContain('AKIAIOSFODNN7EXAMPLE');
    const entities = r.detections.map((d) => d.entityType);
    expect(entities).toContain('EMAIL');
    expect(entities).toContain('AWS_ACCESS_KEY');
  });

  it('block mode throws on first PII match', () => {
    expect(() => redact('SSN 123-45-6789', undefined, 'block')).toThrow(/PII detected/);
  });

  it('hash mode requires pepper env var', () => {
    const prev = process.env['AGENT_MESH_REDACTION_PEPPER'];
    delete process.env['AGENT_MESH_REDACTION_PEPPER'];
    expect(() => redact('SSN 123-45-6789', undefined, 'hash')).toThrow(/PEPPER/);
    if (prev !== undefined) process.env['AGENT_MESH_REDACTION_PEPPER'] = prev;
  });

  it('hash mode produces deterministic tag with same pepper + value', () => {
    process.env['AGENT_MESH_REDACTION_PEPPER'] = 'a'.repeat(32);
    const a = redact('123-45-6789', undefined, 'hash').text;
    const b = redact('123-45-6789', undefined, 'hash').text;
    expect(a).toBe(b);
    expect(a).toMatch(/\[REDACTED:US_SSN:[0-9a-f]{8}\]/);
  });

  it('counts multiple occurrences of the same entity', () => {
    const e1 = email('a', 'x.com');
    const e2 = email('b', 'y.org');
    const r = redact(`emails: ${e1} and ${e2}`);
    const found = r.detections.find((d) => d.entityType === 'EMAIL');
    expect(found?.count).toBe(2);
  });

  it('credit-card regex Luhn-validates — redacts valid CC, skips lookalike non-Luhn digits', () => {
    // Visa test number 4111 1111 1111 1111 passes Luhn.
    const validCC = redact('card 4111 1111 1111 1111 here');
    expect(validCC.text).toContain('[REDACTED:CREDIT_CARD]');

    // 16 digits that fail Luhn — e.g. an order/tracking-style number.
    // 1234567812345678: Luhn computes to 4, not 0. Should NOT be redacted.
    const fakeCC = redact('order 1234567812345678 placed');
    expect(fakeCC.text).toContain('1234567812345678');
    expect(fakeCC.detections.find((d) => d.entityType === 'CREDIT_CARD')).toBeUndefined();
  });

  it('block mode throws GuardrailViolationError with entityType in details', () => {
    let caught: unknown;
    try {
      redact('SSN 123-45-6789', undefined, 'block');
    } catch (e) {
      caught = e;
    }
    expect(caught).toMatchObject({
      code: 'guardrail_violation',
      details: { entityType: 'US_SSN' },
    });
  });
});
