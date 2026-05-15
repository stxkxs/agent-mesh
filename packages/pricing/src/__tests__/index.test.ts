import { describe, expect, it } from 'vitest';

import { computeCostUsd } from '../index.js';

describe('computeCostUsd', () => {
  it('Azure OpenAI gpt-4o: pure input + output', () => {
    const cost = computeCostUsd('azure-openai', 'gpt-4o', {
      inputTokens: 1_000_000,
      outputTokens: 500_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    // 1M × $2.50 + 0.5M × $10.00 = $2.50 + $5.00 = $7.50
    expect(cost).toBeCloseTo(7.5, 4);
  });

  it('Anthropic sonnet-4-6: cache reads + writes', () => {
    const cost = computeCostUsd('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 100_000,
      outputTokens: 50_000,
      cacheCreationInputTokens: 200_000,
      cacheReadInputTokens: 800_000,
    });
    // 100k × $3 + 50k × $15 + 200k × $3.75 + 800k × $0.30  (per 1M tokens)
    // = 0.3 + 0.75 + 0.75 + 0.24 = 2.04
    expect(cost).toBeCloseTo(2.04, 4);
  });

  it('throws ConfigurationError on unknown model', () => {
    expect(() =>
      computeCostUsd('anthropic', 'claude-omega-99', {
        inputTokens: 1,
        outputTokens: 1,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      }),
    ).toThrow(/No pricing entry/);
  });

  it('cache hits are materially cheaper than fresh input on Anthropic', () => {
    const cached = computeCostUsd('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 0,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 1_000_000,
    });
    const fresh = computeCostUsd('anthropic', 'claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 0,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cached).toBeLessThan(fresh * 0.2); // cache reads ≥ 80% cheaper
  });
});
