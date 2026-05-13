import { ProviderError, RateLimitedError } from '@agent-mesh/core/errors';
import { computeCostUsd } from '@agent-mesh/pricing';
import Anthropic from '@anthropic-ai/sdk';

import { emitCallEvent } from '../telemetry.js';

import type {
  ContentBlock,
  ErrorClass,
  MessagesParams,
  MessagesResponse,
  ProviderAdapter,
  StopReason,
} from '../types.js';
import type { ModelId, TokenUsage } from '@agent-mesh/core/schemas';

export interface AnthropicAdapterOptions {
  /**
   * Anthropic API key. May be a string or an async resolver that fetches
   * from a secret store (Azure Key Vault via Workload Identity). Resolvers
   * run on first call and are cached for the adapter lifetime.
   */
  readonly apiKey: string | (() => Promise<string>);
  /** Optional `anthropic-version` header override. */
  readonly anthropicVersion?: string;
  /** Identity context propagated into every emitted CallEvent. */
  readonly workspace: string;
  readonly project: string;
  readonly tenant: string;
  /** Override the underlying client (test-only). */
  readonly anthropicClient?: Anthropic;
  /** Max retries delegated to the SDK. Defaults to 2. */
  readonly maxRetries?: number;
  /** Per-request timeout ms. Default 600_000. */
  readonly timeoutMs?: number;
}

export class AnthropicAdapter implements ProviderAdapter {
  public readonly providerId = 'anthropic' as const;

  private readonly clientPromise: Promise<Anthropic>;
  private readonly workspace: string;
  private readonly project: string;
  private readonly tenant: string;

  public constructor(opts: AnthropicAdapterOptions) {
    this.workspace = opts.workspace;
    this.project = opts.project;
    this.tenant = opts.tenant;
    this.clientPromise = (async (): Promise<Anthropic> => {
      if (opts.anthropicClient !== undefined) return opts.anthropicClient;
      const key = typeof opts.apiKey === 'function' ? await opts.apiKey() : opts.apiKey;
      return new Anthropic({
        apiKey: key,
        maxRetries: opts.maxRetries ?? 2,
        timeout: opts.timeoutMs ?? 600_000,
        ...(opts.anthropicVersion === undefined
          ? {}
          : { defaultHeaders: { 'anthropic-version': opts.anthropicVersion } }),
      });
    })();
  }

  public estimateCost(model: ModelId, tokens: TokenUsage): number {
    return computeCostUsd('anthropic', model, tokens);
  }

  public classifyError(e: unknown): ErrorClass {
    if (e instanceof Anthropic.APIError) {
      if (e.status === 401 || e.status === 403) return 'AuthFailure';
      if (e.status === 429) return 'RateLimit';
      if (e.status === 529) return 'Overloaded';
      if (e.status !== undefined && e.status >= 400 && e.status < 500) return 'BadRequest';
      if (e.status !== undefined && e.status >= 500) return 'Server';
    }
    return 'Network';
  }

  public async messages(params: MessagesParams): Promise<MessagesResponse> {
    const anthropic = await this.clientPromise;
    const requestId = `req-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    const startedAt = new Date();
    const startNs = process.hrtime.bigint();

    try {
      const raw = await anthropic.messages.create({
        model: params.model,
        max_tokens: params.max_tokens,
        ...(params.system === undefined ? {} : { system: params.system }),
        messages: params.messages.map((m) => ({
          role: m.role,
          content: m.content,
        })),
        ...(params.tools === undefined || params.tools.length === 0 ? {} : { tools: params.tools }),
        ...(params.tool_choice === undefined ? {} : { tool_choice: params.tool_choice }),
        ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
        ...(params.stop_sequences === undefined
          ? {}
          : { stop_sequences: [...params.stop_sequences] }),
        // eslint-disable-next-line @typescript-eslint/no-explicit-any
      } as any);
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const usage = raw.usage as {
        input_tokens: number;
        output_tokens: number;
        cache_creation_input_tokens?: number;
        cache_read_input_tokens?: number;
      };
      const tokens: TokenUsage = {
        inputTokens: usage.input_tokens,
        outputTokens: usage.output_tokens,
        cacheCreationInputTokens: usage.cache_creation_input_tokens ?? 0,
        cacheReadInputTokens: usage.cache_read_input_tokens ?? 0,
      };
      const costUsd = this.estimateCost(params.model, tokens);

      emitCallEvent({
        workspace: this.workspace,
        project: this.project,
        tenant: this.tenant,
        ...(params.agent === undefined ? {} : { agent: params.agent }),
        provider: 'anthropic',
        model: params.model,
        operation: params.operation ?? 'messages',
        startedAt: startedAt.toISOString(),
        durationMs: Math.round(durationMs),
        tokens,
        costUsd,
        status: 'ok',
        correlationId: params.correlationId,
        requestId,
        cacheHit: tokens.cacheReadInputTokens > 0,
        extensions: {},
      });

      return {
        id: raw.id,
        provider: 'anthropic',
        model: params.model,
        content: raw.content as unknown as readonly ContentBlock[],
        stopReason: this.mapStopReason(raw.stop_reason),
        usage: tokens,
        costUsd,
        durationMs: Math.round(durationMs),
        cacheHit: tokens.cacheReadInputTokens > 0,
      };
    } catch (e: unknown) {
      const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
      const errorClass = this.classifyError(e);
      emitCallEvent({
        workspace: this.workspace,
        project: this.project,
        tenant: this.tenant,
        ...(params.agent === undefined ? {} : { agent: params.agent }),
        provider: 'anthropic',
        model: params.model,
        operation: params.operation ?? 'messages',
        startedAt: startedAt.toISOString(),
        durationMs: Math.round(durationMs),
        tokens: {
          inputTokens: 0,
          outputTokens: 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: 0,
        },
        costUsd: 0,
        status: errorClass === 'RateLimit' || errorClass === 'Overloaded' ? 'throttled' : 'error',
        errorClass,
        correlationId: params.correlationId,
        requestId,
        cacheHit: false,
        extensions: { errorMessage: e instanceof Error ? e.message : String(e) },
      });
      if (errorClass === 'RateLimit' || errorClass === 'Overloaded') {
        throw new RateLimitedError(
          `Anthropic ${errorClass}: ${e instanceof Error ? e.message : String(e)}`,
          { provider: 'anthropic', model: params.model, errorClass },
        );
      }
      throw new ProviderError(
        `Anthropic ${errorClass}: ${e instanceof Error ? e.message : String(e)}`,
        { provider: 'anthropic', model: params.model, errorClass },
      );
    }
  }

  private mapStopReason(reason: string | null | undefined): StopReason {
    switch (reason) {
      case 'end_turn':
      case 'max_tokens':
      case 'tool_use':
      case 'stop_sequence':
      case 'pause_turn':
      case 'refusal':
        return reason;
      case null:
      case undefined:
        return null;
      default:
        return null;
    }
  }
}
