import { ConfigurationError, ProviderError } from '@agent-mesh/core/errors';
import { computeCostUsd } from '@agent-mesh/pricing';
import { AzureOpenAI } from 'openai';

import { withTelemetry } from '../telemetry.js';

import type {
  ErrorClass,
  MessagesParams,
  MessagesResponse,
  ProviderAdapter,
  StopReason,
} from '../types.js';
import type { ModelId, TokenUsage } from '@agent-mesh/core/schemas';
import type { TokenCredential } from '@azure/identity';

/**
 * Options for constructing an `AzureOpenAIAdapter`.
 *
 * Auth: prefer a `TokenCredential` from `@azure/identity` (e.g.
 * `DefaultAzureCredential` resolving to Workload Identity in AKS). The
 * static-`apiKey` path is supported for local dev only — production
 * deployments MUST use a TokenCredential.
 */
export interface AzureOpenAIAdapterOptions {
  /** Azure OpenAI resource endpoint, e.g. `https://my-aoai.openai.azure.com/`. */
  readonly endpoint: string;
  /** REST API version to pin against. */
  readonly apiVersion?: string;
  /** Auth: prefer `TokenCredential`. Use `apiKey` only for local dev. */
  readonly credential?: TokenCredential;
  /** API key alternative — DISCOURAGED for production. */
  readonly apiKey?: string;
  /**
   * Optional mapping from logical model id (used in `MessagesParams.model`)
   * to deployment name in your Azure OpenAI resource. Deployment names are
   * per-resource customer-chosen — they may not match the underlying model.
   */
  readonly modelAliases?: Readonly<Record<string, string>>;
  /** Identity context propagated into every emitted CallEvent. */
  readonly workspace: string;
  readonly project: string;
  readonly tenant: string;
  /** Max retries delegated to the SDK. Defaults to 2 (SDK default). */
  readonly maxRetries?: number;
  /** Per-request timeout in ms. Default 600_000 (10 min). */
  readonly timeoutMs?: number;
}

const DEFAULT_API_VERSION = '2024-12-01-preview';

export class AzureOpenAIAdapter implements ProviderAdapter {
  public readonly providerId = 'azure-openai' as const;

  private readonly client: AzureOpenAI;
  private readonly modelAliases: Readonly<Record<string, string>>;
  private readonly workspace: string;
  private readonly project: string;
  private readonly tenant: string;

  public constructor(opts: AzureOpenAIAdapterOptions) {
    if (opts.credential === undefined && opts.apiKey === undefined) {
      throw new ConfigurationError(
        'AzureOpenAIAdapter requires either `credential` (preferred) or `apiKey`',
      );
    }
    this.workspace = opts.workspace;
    this.project = opts.project;
    this.tenant = opts.tenant;
    this.modelAliases = opts.modelAliases ?? {};

    this.client = new AzureOpenAI({
      endpoint: opts.endpoint,
      apiVersion: opts.apiVersion ?? DEFAULT_API_VERSION,
      ...(opts.credential === undefined
        ? { apiKey: opts.apiKey }
        : {
            azureADTokenProvider: async () => {
              const t = await opts.credential!.getToken(
                'https://cognitiveservices.azure.com/.default',
              );
              if (t === null) {
                throw new ConfigurationError('Azure AD token acquisition returned null');
              }
              return t.token;
            },
          }),
      maxRetries: opts.maxRetries ?? 2,
      timeout: opts.timeoutMs ?? 600_000,
    });
  }

  public estimateCost(model: ModelId, tokens: TokenUsage): number {
    // Cost is keyed by the *logical* model id (e.g. `gpt-4o`), not the
    // deployment name. Customer deployment names are arbitrary.
    return computeCostUsd('azure-openai', model, tokens);
  }

  public classifyError(e: unknown): ErrorClass {
    if (typeof e !== 'object' || e === null) {
      return 'Network';
    }
    const status = (e as { status?: number }).status;
    if (typeof status === 'number') {
      if (status === 401 || status === 403) return 'AuthFailure';
      if (status === 429) return 'RateLimit';
      if (status === 529) return 'Overloaded';
      if (status >= 400 && status < 500) return 'BadRequest';
      if (status >= 500) return 'Server';
    }
    return 'Network';
  }

  public async messages(params: MessagesParams): Promise<MessagesResponse> {
    const deployment = this.resolveModel(params.model);

    // Translate the unified messages shape into Azure OpenAI chat-completion
    // params. Azure OpenAI conforms to the OpenAI chat-completions schema,
    // so the system prompt becomes a `system`-role message and tool defs
    // become `tools` entries.
    const systemMessages = (() => {
      if (params.system === undefined) return [];
      if (typeof params.system === 'string') {
        return [{ role: 'system' as const, content: params.system }];
      }
      // Array form: flatten to a single system content with newlines.
      return [
        {
          role: 'system' as const,
          content: params.system.map((s) => s.text).join('\n\n'),
        },
      ];
    })();
    const messages = [
      ...systemMessages,
      ...params.messages.map((m) => ({
        role: m.role,
        content: typeof m.content === 'string' ? m.content : JSON.stringify(m.content),
      })),
    ];
    const tools = params.tools?.map((t) => ({
      type: 'function' as const,
      function: {
        name: t.name,
        ...(t.description === undefined ? {} : { description: t.description }),
        parameters: t.input_schema,
      },
    }));

    return withTelemetry(
      {
        provider: 'azure-openai',
        workspace: this.workspace,
        project: this.project,
        tenant: this.tenant,
        classifyError: (e) => this.classifyError(e),
        model: params.model,
        ...(deployment === params.model ? {} : { deployment }),
      },
      params,
      async () => {
        const raw = await this.client.chat.completions.create({
          model: deployment,
          messages,
          max_completion_tokens: params.max_tokens,
          ...(params.temperature === undefined ? {} : { temperature: params.temperature }),
          ...(params.stop_sequences === undefined ? {} : { stop: [...params.stop_sequences] }),
          ...(tools === undefined || tools.length === 0 ? {} : { tools }),
          ...(params.tool_choice === undefined
            ? {}
            : { tool_choice: translateToolChoice(params.tool_choice) }),
        });
        const choice = raw.choices[0];
        if (choice === undefined) {
          throw new ProviderError('Azure OpenAI returned no choices');
        }
        const tokens = {
          inputTokens: raw.usage?.prompt_tokens ?? 0,
          outputTokens: raw.usage?.completion_tokens ?? 0,
          cacheCreationInputTokens: 0,
          cacheReadInputTokens: raw.usage?.prompt_tokens_details?.cached_tokens ?? 0,
        };
        const costUsd = this.estimateCost(params.model, tokens);
        const content = [
          ...(choice.message.content === null
            ? []
            : [{ type: 'text', text: choice.message.content } as Record<string, unknown>]),
          ...(choice.message.tool_calls ?? [])
            .filter(
              (
                tc,
              ): tc is typeof tc & {
                type: 'function';
                function: { name: string; arguments: string };
              } => tc.type === 'function',
            )
            .map((tc) => ({
              type: 'tool_use',
              id: tc.id,
              name: tc.function.name,
              input: JSON.parse(tc.function.arguments) as unknown,
            })),
        ];

        return {
          id: raw.id,
          provider: 'azure-openai',
          model: params.model,
          content,
          stopReason: this.mapStopReason(choice.finish_reason),
          usage: tokens,
          costUsd,
          durationMs: 0, // overwritten by withTelemetry
          cacheHit: tokens.cacheReadInputTokens > 0,
          rawTokens: tokens,
        };
      },
    );
  }

  private resolveModel(model: ModelId): string {
    return this.modelAliases[model] ?? model;
  }

  private mapStopReason(reason: string | null | undefined): StopReason {
    switch (reason) {
      case 'stop':
        return 'end_turn';
      case 'length':
        return 'max_tokens';
      case 'tool_calls':
        return 'tool_use';
      case 'function_call':
        return 'function_call';
      case 'content_filter':
        return 'content_filter';
      case null:
      case undefined:
        return null;
      default:
        return null;
    }
  }
}

/**
 * Translate the unified `tool_choice` shape onto OpenAI's `tool_choice` enum.
 *
 *   { type: 'auto' }              → 'auto'        — let the model decide
 *   { type: 'any' }               → 'required'    — must call at least one tool
 *   { type: 'tool', name: 'foo' } → { type: 'function', function: { name: 'foo' } }
 *
 * Without this, the agent loop's `tool_choice: { type: 'any' }` (which
 * forces the model to emit via `submit_final_output`) silently degraded
 * to OpenAI's default 'auto', weakening structured-output enforcement.
 */
const translateToolChoice = (tc: {
  type: 'auto' | 'any' | 'tool';
  name?: string;
}): 'auto' | 'required' | { type: 'function'; function: { name: string } } => {
  switch (tc.type) {
    case 'auto':
      return 'auto';
    case 'any':
      return 'required';
    case 'tool':
      if (tc.name === undefined) {
        throw new ProviderError(`tool_choice type='tool' requires a name; got undefined`);
      }
      return { type: 'function', function: { name: tc.name } };
  }
};
