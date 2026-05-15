import { randomUUID } from 'node:crypto';

import { GuardrailViolationError, SchemaValidationError } from '@agent-mesh/core/errors';
import { toJSONSchema } from 'zod';

import { createMcpBreaker } from './circuit-breaker.js';

import type { AgentDefinition } from './define-agent.js';
import type { ToolBinding } from './tools.js';
import type { ProviderAdapter } from '@agent-mesh/sdk';
import type { ZodType } from 'zod';

export interface RunAgentOptions {
  /** Provider adapter the loop drives. Pass the one matching agent.provider; the runtime does not auto-pick from the agent definition. */
  readonly adapter: ProviderAdapter;
  /** Correlation id propagated into OTel spans + CallEvents. Auto-minted if absent. */
  readonly correlationId?: string;
  /** Override the system prompt content. If omitted, callers must resolve via PromptResolver and pass here. */
  readonly systemPrompt: string;
  /** Max output tokens per model turn. Default 4096. */
  readonly maxTokens?: number;
}

export interface RunAgentResult<O> {
  readonly output: O;
  readonly iterations: number;
  readonly totalCostUsd: number;
  readonly totalDurationMs: number;
  readonly correlationId: string;
  readonly stopReason: 'end_turn' | 'final_output' | 'max_iterations';
}

const FINAL_OUTPUT_TOOL = 'submit_final_output';

const toolsByName = (
  tools: readonly ToolBinding<unknown, unknown>[],
): Map<string, ToolBinding<unknown, unknown>> => {
  const map = new Map<string, ToolBinding<unknown, unknown>>();
  for (const tool of tools) {
    map.set(tool.name, tool);
  }
  return map;
};

/**
 * Run an agent end-to-end.
 *
 *  1. Build the tool catalog: agent.tools + a synthetic structured-output
 *     tool whose `input_schema` is the JSON-schema projection of
 *     `agent.output`. The model emits its final answer via this tool —
 *     not as free-text.
 *  2. Loop, calling `adapter.messages()`:
 *       - tool_use of `submit_final_output` → validate via the agent's
 *         output schema, return.
 *       - tool_use of a regular tool → invoke, apply the binding's egress
 *         schema (layer 2 of the guardrail stack), feed the tool_result
 *         back to the model.
 *       - no tool_use at all → guardrail violation. Models must respond
 *         via the structured-output tool. Throw.
 *  3. Bail after `agent.maxIterations` (default 6) without a final answer.
 */
export const runAgent = async <O>(
  agent: AgentDefinition<O>,
  input: string,
  opts: RunAgentOptions,
): Promise<RunAgentResult<O>> => {
  const correlationId = opts.correlationId ?? randomUUID();
  const maxIterations = agent.maxIterations ?? 6;
  const maxTokens = opts.maxTokens ?? 4096;

  const structuredTool = {
    name: FINAL_OUTPUT_TOOL,
    description:
      'Submit the final structured output. Call this exactly once when you have completed the task. Do not produce free-text answers.',
    input_schema: toJSONSchema(agent.output as ZodType<unknown>) as Record<string, unknown>,
  };

  const tools = [
    ...agent.tools.map((t) => ({
      name: t.name,
      description: t.description,
      input_schema: toJSONSchema(t.input) as Record<string, unknown>,
    })),
    structuredTool,
  ];
  const lookup = toolsByName(agent.tools);

  // One opossum circuit breaker per tool. Wraps `execute` so a flapping
  // MCP backend short-circuits rather than blocking the loop on repeated
  // timeouts. Lifetime: per `runAgent` invocation; state isn't shared
  // across calls (a long-lived process would lift these up to module
  // scope keyed by agent.id + tool.name).
  const breakers = new Map<string, ReturnType<typeof createMcpBreaker<unknown, [unknown]>>>();
  for (const t of agent.tools) {
    breakers.set(
      t.name,
      createMcpBreaker<unknown, [unknown]>(async (i) => t.execute(i), {
        name: `${agent.id}.${t.name}`,
      }),
    );
  }

  const messages: {
    role: 'user' | 'assistant';
    content: string | Record<string, unknown>[];
  }[] = [{ role: 'user', content: input }];
  let totalCostUsd = 0;
  let totalDurationMs = 0;

  for (let iter = 1; iter <= maxIterations; iter += 1) {
    const response = await opts.adapter.messages({
      model: agent.model,
      system: [{ type: 'text', text: opts.systemPrompt, cache_control: { type: 'ephemeral' } }],
      messages,
      tools,
      tool_choice: { type: 'any' },
      max_tokens: maxTokens,
      correlationId,
      agent: agent.id,
      operation: 'messages',
    });
    totalCostUsd += response.costUsd;
    totalDurationMs += response.durationMs;

    messages.push({
      role: 'assistant',
      content: response.content as Record<string, unknown>[],
    });

    const finalCall = response.content.find(
      (b) => b['type'] === 'tool_use' && b['name'] === FINAL_OUTPUT_TOOL,
    );
    if (finalCall !== undefined) {
      const finalInput = (finalCall as { input: unknown }).input;
      const parsed = agent.output.safeParse(finalInput);
      if (!parsed.success) {
        throw new SchemaValidationError('Final output failed agent.output schema validation', {
          issues: parsed.error.issues,
          agentId: agent.id,
          correlationId,
        });
      }
      return {
        output: parsed.data,
        iterations: iter,
        totalCostUsd,
        totalDurationMs,
        correlationId,
        stopReason: 'final_output',
      };
    }

    const toolUses = response.content.filter((b) => b['type'] === 'tool_use');
    if (toolUses.length === 0) {
      throw new GuardrailViolationError(
        'Agent produced no tool calls and no final output. Model must respond via the structured-output tool.',
        { iter, agentId: agent.id, correlationId },
      );
    }

    const toolResults: Record<string, unknown>[] = [];
    for (const use of toolUses) {
      const useTyped = use as { id: string; name: string; input: unknown };
      const binding = lookup.get(useTyped.name);
      if (binding === undefined) {
        toolResults.push({
          type: 'tool_result',
          tool_use_id: useTyped.id,
          content: `Unknown tool: ${useTyped.name}`,
          is_error: true,
        });
        continue;
      }
      try {
        const inputParsed = binding.input.parse(useTyped.input);
        // Route through the circuit breaker so a flapping tool short-
        // circuits instead of timing out repeatedly.
        const breaker = breakers.get(useTyped.name);
        const result =
          breaker === undefined
            ? await binding.execute(inputParsed)
            : await breaker.fire(inputParsed);
        // Layer 2 — egress schema applied to tool output before re-feeding
        const egressed = binding.egress.parse(result);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: useTyped.id,
          content: JSON.stringify(egressed),
        });
      } catch (e: unknown) {
        const msg =
          e instanceof SchemaValidationError
            ? `schema: ${e.message}`
            : e instanceof Error
              ? e.message
              : String(e);
        toolResults.push({
          type: 'tool_result',
          tool_use_id: useTyped.id,
          content: `Tool error: ${msg}`,
          is_error: true,
        });
      }
    }
    messages.push({ role: 'user', content: toolResults });
  }

  throw new GuardrailViolationError(
    `Agent exceeded maxIterations (${maxIterations}) without producing final output.`,
    { agentId: agent.id, correlationId, maxIterations },
  );
};
