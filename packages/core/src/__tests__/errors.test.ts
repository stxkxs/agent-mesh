import { describe, expect, it } from 'vitest';

import {
  AgentMeshError,
  BudgetBreachError,
  PromptInjectionError,
  isAgentMeshError,
} from '../errors.js';

describe('AgentMeshError', () => {
  it('carries code + details + message', () => {
    const e = new AgentMeshError({ code: 'TEST', message: 'boom', details: { foo: 1 } });
    expect(e.code).toBe('TEST');
    expect(e.message).toBe('boom');
    expect(e.details).toEqual({ foo: 1 });
    expect(e.name).toBe('AgentMeshError');
  });

  it('preserves cause when provided', () => {
    const root = new Error('root');
    const e = new AgentMeshError({ code: 'WRAP', message: 'wrapper', cause: root });
    expect(e.cause).toBe(root);
  });

  it('isAgentMeshError type guard narrows subclasses', () => {
    const e: unknown = new PromptInjectionError('classifier flagged');
    expect(isAgentMeshError(e)).toBe(true);
    expect(isAgentMeshError(new Error('plain'))).toBe(false);
    expect(isAgentMeshError(null)).toBe(false);
    expect(isAgentMeshError('string')).toBe(false);
  });

  it('subclasses set their own name and stable code', () => {
    const b = new BudgetBreachError('over $5000', { utilization: 1.21 });
    expect(b.name).toBe('BudgetBreachError');
    expect(b.code).toBe('budget_breach');
    expect(b.details).toEqual({ utilization: 1.21 });
  });
});
