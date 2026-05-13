import { describe, expect, it } from 'vitest';

import { fingerprintSkill, parseSkillManifest } from '../index.js';

describe('SkillManifest', () => {
  const valid = {
    name: 'pdf-summarizer',
    version: '0.1.0',
    description: 'Summarize PDF documents.',
    entry: 'src/handler.ts',
    runtime: 'node24',
    capabilities: ['files:read'],
  };

  it('accepts a valid manifest', () => {
    const m = parseSkillManifest(valid);
    expect(m.name).toBe('pdf-summarizer');
    expect(m.runtime).toBe('node24');
  });

  it('rejects names with uppercase', () => {
    expect(() => parseSkillManifest({ ...valid, name: 'PDF-Summarizer' })).toThrow();
  });

  it('rejects non-semver versions', () => {
    expect(() => parseSkillManifest({ ...valid, version: 'v1' })).toThrow();
  });

  it('fingerprintSkill is deterministic for same inputs', () => {
    const m = parseSkillManifest(valid);
    const a = fingerprintSkill({ manifest: m, entryContent: 'export const x = 1;' });
    const b = fingerprintSkill({ manifest: m, entryContent: 'export const x = 1;' });
    expect(a).toBe(b);
    expect(a).toMatch(/^[0-9a-f]{64}$/);
  });

  it('fingerprintSkill changes when entry content changes', () => {
    const m = parseSkillManifest(valid);
    const a = fingerprintSkill({ manifest: m, entryContent: 'export const x = 1;' });
    const b = fingerprintSkill({ manifest: m, entryContent: 'export const x = 2;' });
    expect(a).not.toBe(b);
  });
});
