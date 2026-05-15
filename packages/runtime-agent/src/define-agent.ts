import type { ToolBinding } from './tools.js';
import type { AgentId, ProjectId, PromptId, TenantId, WorkspaceId } from '@agent-mesh/core/ids';
import type { ModelId, ProviderId } from '@agent-mesh/core/schemas';
import type { ZodType } from 'zod';

/**
 * Agent definition. Static config that flows into `runAgent` — does not
 * carry per-invocation state. One `defineAgent({...})` call per logical
 * agent (e.g. one for triage, one for summarizer, etc.).
 */
export interface AgentDefinition<O> {
  readonly id: AgentId;
  readonly workspace: WorkspaceId;
  readonly project: ProjectId;
  readonly tenant?: TenantId;

  /** Primary provider + model. */
  readonly provider: ProviderId;
  readonly model: ModelId;

  /**
   * Fallback chain. Used on retryable errors (RateLimit, Overloaded,
   * Server, Network) for idempotent operations only — callers indicate
   * idempotency via the `idempotencyKey` field in `runAgent`'s input.
   */
  readonly fallbacks?: readonly { provider: ProviderId; model: ModelId }[];

  /** Tool catalog. The model sees these via the tools.create surface. */
  readonly tools: readonly ToolBinding<unknown, unknown>[];

  /**
   * Structured-output Zod schema. The runtime forces the model to emit
   * this shape via a `submit_final_output` tool — equivalent to layer 4
   * of the guardrail stack (structured-output enforcement).
   */
  readonly output: ZodType<O>;

  /**
   * Versioned prompt IDs. First is the system prompt; subsequent entries
   * are loaded but not auto-prepended (the agent code decides where they go).
   */
  readonly prompts?: readonly PromptId[];

  /** Max loop iterations before the runtime gives up. Default 6. */
  readonly maxIterations?: number;
}

/** Identity helper that re-exports the agent definition as-is. */
export const defineAgent = <O>(def: AgentDefinition<O>): AgentDefinition<O> => def;
