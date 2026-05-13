import type { ModelId, ProviderId, TokenUsage } from '@agent-mesh/core/schemas';

/**
 * Stable error-class taxonomy across providers. Adapters MUST map their
 * native error shapes onto this enum in `classifyError`.
 *
 *  - `RateLimit`    — 429 / per-minute quota exhausted; retryable with backoff
 *  - `Overloaded`   — 529 / provider capacity exhausted; retryable, longer backoff
 *  - `BadRequest`   — 4xx (excluding 429); caller-side bug, NOT retryable
 *  - `Server`       — 5xx (excluding 529); retryable
 *  - `Network`      — connection / DNS / TLS failures; retryable
 *  - `AuthFailure`  — 401 / 403; NOT retryable, escalate to operator
 */
export type ErrorClass =
  | 'RateLimit'
  | 'Overloaded'
  | 'BadRequest'
  | 'Server'
  | 'Network'
  | 'AuthFailure';

/**
 * Unified `messages.create` parameter shape. Adapters translate this into
 * the provider's native call (Azure OpenAI chat completions, Anthropic
 * messages, etc.) and translate the response back into `MessagesResponse`.
 */
export interface MessagesParams {
  readonly model: ModelId;
  /**
   * System prompt as either a plain string or an array of text segments
   * with optional cache markers. Adapters that support prompt caching
   * (Anthropic via `cache_control`, Azure OpenAI via implicit caching)
   * honor the cache hints; others ignore them.
   */
  readonly system?:
    | string
    | readonly {
        readonly type: 'text';
        readonly text: string;
        readonly cache_control?: { readonly type: 'ephemeral' };
      }[];
  readonly messages: readonly {
    readonly role: 'user' | 'assistant';
    readonly content: string | readonly ContentBlock[];
  }[];
  readonly tools?: readonly ToolDefinition[];
  readonly tool_choice?: { readonly type: 'auto' | 'any' | 'tool'; readonly name?: string };
  readonly max_tokens: number;
  readonly temperature?: number;
  readonly stop_sequences?: readonly string[];
  /** Correlation id propagated into OpenTelemetry spans + CallEvent. */
  readonly correlationId: string;
  /** Optional agent id for telemetry attribution. */
  readonly agent?: string;
  /** Whether this call is interactive or part of a batch / file pipeline. */
  readonly operation?: 'messages' | 'batch' | 'files' | 'skills' | 'mcp';
}

/** Loose content-block shape — providers attach their own discriminators. */
export type ContentBlock = Readonly<Record<string, unknown>>;

export interface ToolDefinition {
  readonly name: string;
  readonly description?: string;
  /** JSON-schema (typically derived from a Zod schema via `z.toJSONSchema`). */
  readonly input_schema: Readonly<Record<string, unknown>>;
}

/** Unified response shape — what every adapter returns. */
export interface MessagesResponse {
  readonly id: string;
  readonly provider: ProviderId;
  readonly model: ModelId;
  readonly content: readonly ContentBlock[];
  readonly stopReason: StopReason;
  readonly usage: TokenUsage;
  readonly costUsd: number;
  readonly durationMs: number;
  readonly cacheHit: boolean;
}

export type StopReason =
  | 'end_turn'
  | 'max_tokens'
  | 'tool_use'
  | 'stop_sequence'
  | 'pause_turn'
  | 'refusal'
  | 'content_filter'
  | 'function_call'
  | null;

/**
 * The Strategy pattern's seam in agent-mesh: every provider implements
 * this interface, and downstream callers (the runtime-agent loop, the
 * eval runner, the batch dispatcher) only know about `ProviderAdapter`.
 *
 * Implementations must be stateless beyond a configured client + identity
 * — adapters are reused across many calls and across many tenants, so do
 * not bake per-call state into the adapter instance.
 */
export interface ProviderAdapter {
  /** Stable provider identifier; matches the `ProviderIdSchema` enum. */
  readonly providerId: ProviderId;

  /**
   * Issue a chat-style call against the underlying provider and return a
   * normalized response. Adapters MUST translate provider-native errors
   * via `classifyError` and re-throw a `ProviderError` / `RateLimitedError`
   * with the classified error class in `details.errorClass`.
   */
  messages(params: MessagesParams): Promise<MessagesResponse>;

  /**
   * Compute a USD cost for a given model + usage. Delegates to
   * `@agent-mesh/pricing`; exposed on the adapter so callers can compute
   * cost without re-importing pricing tables.
   */
  estimateCost(model: ModelId, tokens: TokenUsage): number;

  /**
   * Normalize a provider-native error into the unified `ErrorClass` taxonomy.
   * Called by the `messages` flow before re-throwing, and exposed publicly
   * so test fakes can stub specific error classes.
   */
  classifyError(e: unknown): ErrorClass;
}
