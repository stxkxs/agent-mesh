import { describe, expect, it } from 'vitest';

import {
  agentId,
  correlationId,
  projectId,
  promptId,
  skillId,
  tenantId,
  workspaceId,
} from '../ids.js';

describe('branded id constructors', () => {
  it('accepts valid kebab-case names', () => {
    expect(workspaceId('platform-prod')).toBe('platform-prod');
    expect(projectId('alpha')).toBe('alpha');
    expect(tenantId('tenant-007')).toBe('tenant-007');
    expect(agentId('triage')).toBe('triage');
    expect(skillId('pdf-summarizer')).toBe('pdf-summarizer');
    expect(promptId('triage-system')).toBe('triage-system');
  });

  it('rejects names starting with a digit', () => {
    expect(() => workspaceId('1platform')).toThrow(/Invalid WorkspaceId/);
  });

  it('rejects names with uppercase', () => {
    expect(() => workspaceId('Platform')).toThrow(/Invalid WorkspaceId/);
  });

  it('rejects names with leading or trailing hyphens', () => {
    expect(() => projectId('-alpha')).toThrow(/Invalid ProjectId/);
    expect(() => projectId('alpha-')).toThrow(/Invalid ProjectId/);
  });

  it('rejects names that are too short (<3 chars)', () => {
    expect(() => agentId('ab')).toThrow(/Invalid AgentId/);
  });

  it('correlation/request IDs accept underscores and longer values', () => {
    expect(correlationId('req-abc_def-123')).toBe('req-abc_def-123');
  });

  it('correlation/request IDs reject special chars', () => {
    expect(() => correlationId('req/abc')).toThrow(/Invalid CorrelationId/);
  });
});
