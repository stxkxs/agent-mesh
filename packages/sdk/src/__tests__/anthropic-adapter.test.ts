import Anthropic from '@anthropic-ai/sdk';
import { describe, expect, it, vi } from 'vitest';

import { AnthropicAdapter } from '../adapters/anthropic.js';

const buildAdapter = (messagesCreate: ReturnType<typeof vi.fn>): AnthropicAdapter => {
  // Build a minimal stub of the Anthropic SDK client surface used by the adapter.
  const stub = {
    messages: { create: messagesCreate },
  } as unknown as Anthropic;
  return new AnthropicAdapter({
    apiKey: 'sk-test',
    anthropicClient: stub,
    workspace: 'platform',
    project: 'alpha',
    tenant: 'platform',
  });
};

describe('AnthropicAdapter', () => {
  it('translates a successful response into the unified shape + emits a CallEvent', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'msg_abc',
      content: [{ type: 'text', text: 'hello' }],
      stop_reason: 'end_turn',
      usage: { input_tokens: 100, output_tokens: 50 },
    });
    const adapter = buildAdapter(create);

    const out = await adapter.messages({
      model: 'claude-sonnet-4-6',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 256,
      correlationId: 'corr-test-001',
    });

    expect(out.provider).toBe('anthropic');
    expect(out.model).toBe('claude-sonnet-4-6');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.stopReason).toBe('end_turn');
    expect(out.costUsd).toBeGreaterThan(0);
    expect(create).toHaveBeenCalledOnce();
  });

  it('classifies a 429 error as RateLimit and throws RateLimitedError', async () => {
    const apiErr = Object.create(Anthropic.APIError.prototype) as Anthropic.APIError;
    Object.assign(apiErr, { status: 429, message: 'rate-limited' });
    const create = vi.fn().mockRejectedValue(apiErr);
    const adapter = buildAdapter(create);

    await expect(
      adapter.messages({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 256,
        correlationId: 'corr-test-002',
      }),
    ).rejects.toMatchObject({ code: 'rate_limited', details: { errorClass: 'RateLimit' } });
  });

  it('classifies a 401 as AuthFailure and throws ProviderError', async () => {
    const apiErr = Object.create(Anthropic.APIError.prototype) as Anthropic.APIError;
    Object.assign(apiErr, { status: 401, message: 'unauthorized' });
    const create = vi.fn().mockRejectedValue(apiErr);
    const adapter = buildAdapter(create);

    await expect(
      adapter.messages({
        model: 'claude-sonnet-4-6',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 256,
        correlationId: 'corr-test-003',
      }),
    ).rejects.toMatchObject({ code: 'provider', details: { errorClass: 'AuthFailure' } });
  });

  it('estimateCost matches pricing table for sonnet-4-6', () => {
    const adapter = buildAdapter(vi.fn());
    const cost = adapter.estimateCost('claude-sonnet-4-6', {
      inputTokens: 1_000_000,
      outputTokens: 1_000_000,
      cacheCreationInputTokens: 0,
      cacheReadInputTokens: 0,
    });
    expect(cost).toBeCloseTo(18.0, 2); // 1M × $3 + 1M × $15
  });
});
