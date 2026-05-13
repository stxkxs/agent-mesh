import { describe, expect, it, vi } from 'vitest';

import { AzureOpenAIAdapter } from '../adapters/azure-openai.js';

const buildAdapter = (
  chatCreate: ReturnType<typeof vi.fn>,
  modelAliases?: Record<string, string>,
): AzureOpenAIAdapter => {
  const adapter = new AzureOpenAIAdapter({
    endpoint: 'https://stub.openai.azure.com/',
    apiKey: 'stub',
    workspace: 'platform',
    project: 'alpha',
    tenant: 'platform',
    ...(modelAliases === undefined ? {} : { modelAliases }),
  });
  // Replace the SDK client's chat.completions.create with our spy.
  // The adapter only touches `client.chat.completions.create`, so we
  // can mutate that property after construction.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (adapter as unknown as { client: any }).client = {
    chat: { completions: { create: chatCreate } },
  };
  return adapter;
};

describe('AzureOpenAIAdapter', () => {
  it('translates an OpenAI chat-completion response into the unified shape', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'chatcmpl-abc',
      choices: [
        {
          message: { content: 'hello', tool_calls: [] },
          finish_reason: 'stop',
        },
      ],
      usage: {
        prompt_tokens: 100,
        completion_tokens: 50,
        prompt_tokens_details: { cached_tokens: 0 },
      },
    });
    const adapter = buildAdapter(create);

    const out = await adapter.messages({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 256,
      correlationId: 'corr-test-001',
    });

    expect(out.provider).toBe('azure-openai');
    expect(out.model).toBe('gpt-4o');
    expect(out.stopReason).toBe('end_turn');
    expect(out.usage.inputTokens).toBe(100);
    expect(out.usage.outputTokens).toBe(50);
    expect(out.content[0]).toEqual({ type: 'text', text: 'hello' });
  });

  it('classifies a 429 as RateLimit via classifyError', () => {
    const adapter = buildAdapter(vi.fn());
    expect(adapter.classifyError({ status: 429 })).toBe('RateLimit');
    expect(adapter.classifyError({ status: 401 })).toBe('AuthFailure');
    expect(adapter.classifyError({ status: 503 })).toBe('Server');
    expect(adapter.classifyError({ status: 400 })).toBe('BadRequest');
    expect(adapter.classifyError(new Error('socket hang up'))).toBe('Network');
  });

  it('honors model aliases when the deployment name differs from the model id', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'chatcmpl-xyz',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const adapter = buildAdapter(create, { 'gpt-4o': 'production-gpt4o-eastus' });

    await adapter.messages({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      correlationId: 'corr-test-002',
    });

    expect(create).toHaveBeenCalledWith(
      expect.objectContaining({ model: 'production-gpt4o-eastus' }),
    );
  });

  it('propagates tool_calls as unified tool_use blocks', async () => {
    const create = vi.fn().mockResolvedValue({
      id: 'chatcmpl-tool',
      choices: [
        {
          message: {
            content: null,
            tool_calls: [
              {
                id: 'tc1',
                type: 'function',
                function: { name: 'fetchCrmContact', arguments: '{"email":"[email protected]"}' },
              },
            ],
          },
          finish_reason: 'tool_calls',
        },
      ],
      usage: { prompt_tokens: 50, completion_tokens: 10 },
    });
    const adapter = buildAdapter(create);

    const out = await adapter.messages({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'lookup' }],
      max_tokens: 256,
      correlationId: 'corr-test-tool',
    });

    expect(out.stopReason).toBe('tool_use');
    expect(out.content).toHaveLength(1);
    expect(out.content[0]).toMatchObject({
      type: 'tool_use',
      name: 'fetchCrmContact',
      input: { email: '[email protected]' },
    });
  });

  it.each([
    [{ type: 'auto' as const }, 'auto'],
    [{ type: 'any' as const }, 'required'],
    [
      { type: 'tool' as const, name: 'fetchCrmContact' },
      { type: 'function', function: { name: 'fetchCrmContact' } },
    ],
  ])('translates tool_choice %j into %j', async (input, expected) => {
    const create = vi.fn().mockResolvedValue({
      id: 'chatcmpl-tc',
      choices: [{ message: { content: 'ok' }, finish_reason: 'stop' }],
      usage: { prompt_tokens: 1, completion_tokens: 1 },
    });
    const adapter = buildAdapter(create);

    await adapter.messages({
      model: 'gpt-4o',
      messages: [{ role: 'user', content: 'hi' }],
      max_tokens: 64,
      correlationId: 'corr-tc',
      tool_choice: input,
    });

    expect(create).toHaveBeenCalledWith(expect.objectContaining({ tool_choice: expected }));
  });

  it('throws when tool_choice type=tool has no name', async () => {
    const create = vi.fn();
    const adapter = buildAdapter(create);

    await expect(
      adapter.messages({
        model: 'gpt-4o',
        messages: [{ role: 'user', content: 'hi' }],
        max_tokens: 64,
        correlationId: 'corr-tc-bad',
        tool_choice: { type: 'tool' },
      }),
    ).rejects.toMatchObject({ code: 'provider' });
  });
});
