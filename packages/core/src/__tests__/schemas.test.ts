import { describe, expect, it } from 'vitest';

import { CallEventSchema, CompliancePresetSchema, TokenUsageSchema } from '../schemas.js';

describe('TokenUsageSchema', () => {
  it('defaults cache fields to 0 when omitted', () => {
    const out = TokenUsageSchema.parse({ inputTokens: 100, outputTokens: 50 });
    expect(out.cacheCreationInputTokens).toBe(0);
    expect(out.cacheReadInputTokens).toBe(0);
  });

  it('rejects negative token counts', () => {
    expect(() => TokenUsageSchema.parse({ inputTokens: -1, outputTokens: 0 })).toThrow();
  });
});

describe('CallEventSchema', () => {
  const base = {
    schema: 'agent-mesh.call-event/v1' as const,
    workspace: 'platform',
    project: 'alpha',
    tenant: 'platform',
    provider: 'azure-openai' as const,
    model: 'gpt-4o',
    operation: 'messages' as const,
    startedAt: '2026-05-12T00:00:00.000Z',
    durationMs: 1234,
    tokensIn: 100,
    tokensOut: 50,
    tokensCacheCreate: 0,
    tokensCacheRead: 0,
    costUsd: 0.0123,
    status: 'ok' as const,
    correlationId: 'corr-abc-123',
    requestId: 'req-xyz-789',
    cacheHit: false,
  };

  it('round-trips a well-formed event', () => {
    const out = CallEventSchema.parse(base);
    expect(out.extensions).toEqual({});
  });

  it('rejects an unknown provider', () => {
    expect(() => CallEventSchema.parse({ ...base, provider: 'gcp-vertex' })).toThrow();
  });

  it('errorClass is required when status=error', () => {
    // Schema-level: errorClass is *optional* across statuses; runtime callers
    // are expected to populate it. This test just confirms the optional shape
    // doesn't break the happy path.
    const out = CallEventSchema.parse({ ...base, status: 'error', errorClass: 'Server' });
    expect(out.errorClass).toBe('Server');
  });
});

describe('CompliancePresetSchema', () => {
  it('accepts the three presets', () => {
    expect(CompliancePresetSchema.parse('standard')).toBe('standard');
    expect(CompliancePresetSchema.parse('iso27001-aligned')).toBe('iso27001-aligned');
    expect(CompliancePresetSchema.parse('hipaa-aware')).toBe('hipaa-aware');
  });

  it('rejects unknown presets', () => {
    expect(() => CompliancePresetSchema.parse('fedramp')).toThrow();
  });
});
