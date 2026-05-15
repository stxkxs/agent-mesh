import { agentId, projectId, workspaceId } from '@agent-mesh/core/ids';
import { describe, expect, it, vi } from 'vitest';
import { z } from 'zod';

import { defineAgent } from '../define-agent.js';
import { runAgent } from '../run-agent.js';
import { defineTool } from '../tools.js';

import type { ProviderAdapter } from '@agent-mesh/sdk';

const TriageOutput = z.object({
  priority: z.union([z.literal('low'), z.literal('high')]),
  reason: z.string(),
});
type TriageOutput = z.infer<typeof TriageOutput>;

const buildAdapter = (responses: ReturnType<typeof vi.fn>): ProviderAdapter =>
  ({
    providerId: 'azure-openai',
    messages: responses,
    estimateCost: () => 0.01,
    classifyError: () => 'Network',
  }) as unknown as ProviderAdapter;

describe('runAgent', () => {
  const baseAgent = defineAgent<TriageOutput>({
    id: agentId('triage'),
    workspace: workspaceId('platform-test'),
    project: projectId('alpha'),
    provider: 'azure-openai',
    model: 'gpt-4o',
    tools: [],
    output: TriageOutput,
    maxIterations: 3,
  });

  it('returns final output when the model calls submit_final_output', async () => {
    const messages = vi.fn().mockResolvedValueOnce({
      id: 'm1',
      provider: 'azure-openai',
      model: 'gpt-4o',
      content: [
        {
          type: 'tool_use',
          id: 'tc1',
          name: 'submit_final_output',
          input: { priority: 'high', reason: 'outage' },
        },
      ],
      stopReason: 'tool_use',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      costUsd: 0.001,
      durationMs: 100,
      cacheHit: false,
    });

    const result = await runAgent(baseAgent, 'production down', {
      adapter: buildAdapter(messages),
      systemPrompt: 'You triage.',
      correlationId: 'corr-1',
    });

    expect(result.stopReason).toBe('final_output');
    expect(result.output.priority).toBe('high');
    expect(result.iterations).toBe(1);
  });

  it('throws SchemaValidationError when the final tool call has wrong shape', async () => {
    const messages = vi.fn().mockResolvedValueOnce({
      id: 'm1',
      provider: 'azure-openai',
      model: 'gpt-4o',
      content: [
        {
          type: 'tool_use',
          id: 'tc1',
          name: 'submit_final_output',
          // priority value not in the literal union
          input: { priority: 'medium', reason: 'unclear' },
        },
      ],
      stopReason: 'tool_use',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      costUsd: 0.001,
      durationMs: 100,
      cacheHit: false,
    });

    await expect(
      runAgent(baseAgent, 'ambiguous', {
        adapter: buildAdapter(messages),
        systemPrompt: 'You triage.',
      }),
    ).rejects.toMatchObject({ code: 'schema_validation' });
  });

  it('dispatches a tool call and feeds tool_result back to the model', async () => {
    const fetchEnrich = defineTool({
      name: 'fetchEnrich',
      description: 'Lookup',
      input: z.object({ key: z.string() }),
      egress: z.object({ value: z.string() }),
      execute: async ({ key }) => ({ value: `enriched-${key}` }),
    });
    const agent = defineAgent<TriageOutput>({
      ...baseAgent,
      tools: [fetchEnrich],
    });

    const messages = vi
      .fn()
      .mockResolvedValueOnce({
        id: 'm1',
        provider: 'azure-openai',
        model: 'gpt-4o',
        content: [{ type: 'tool_use', id: 'tc1', name: 'fetchEnrich', input: { key: 'k1' } }],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        costUsd: 0.001,
        durationMs: 100,
        cacheHit: false,
      })
      .mockResolvedValueOnce({
        id: 'm2',
        provider: 'azure-openai',
        model: 'gpt-4o',
        content: [
          {
            type: 'tool_use',
            id: 'tc2',
            name: 'submit_final_output',
            input: { priority: 'low', reason: 'enriched value seen' },
          },
        ],
        stopReason: 'tool_use',
        usage: {
          inputTokens: 10,
          outputTokens: 5,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        costUsd: 0.001,
        durationMs: 100,
        cacheHit: false,
      });

    const result = await runAgent(agent, 'check', {
      adapter: buildAdapter(messages),
      systemPrompt: 'sys',
    });

    expect(result.iterations).toBe(2);
    expect(result.output.priority).toBe('low');
    expect(messages).toHaveBeenCalledTimes(2);
  });

  it('throws GuardrailViolationError when model produces no tool calls', async () => {
    const messages = vi.fn().mockResolvedValueOnce({
      id: 'm1',
      provider: 'azure-openai',
      model: 'gpt-4o',
      content: [{ type: 'text', text: 'I think this is high priority.' }],
      stopReason: 'end_turn',
      usage: {
        inputTokens: 10,
        outputTokens: 5,
        cacheCreationInputTokens: 0,
        cacheReadInputTokens: 0,
      },
      costUsd: 0.001,
      durationMs: 100,
      cacheHit: false,
    });

    await expect(
      runAgent(baseAgent, 'test', {
        adapter: buildAdapter(messages),
        systemPrompt: 'sys',
      }),
    ).rejects.toMatchObject({ code: 'guardrail_violation' });
  });
});
