import { ProviderError, RateLimitedError } from '@agent-mesh/core/errors';
import { CallEventSchema, type CallEvent } from '@agent-mesh/core/schemas';
import { trace, type Span, type Tracer } from '@opentelemetry/api';

import type { ErrorClass, MessagesParams, MessagesResponse, ProviderAdapter } from './types.js';
import type { ProviderId } from '@agent-mesh/core/schemas';

/**
 * OpenTelemetry-shaped emission for a single CallEvent. A structured
 * record that the OTel Collector forwards to Datadog Logs (parsed via a
 * log pipeline that promotes `agent_mesh.*` fields to attributes + metrics)
 * AND attached as span attributes on the active OTel span so Datadog APM
 * picks up token / cost / latency-per-model breakdowns automatically.
 *
 * We don't depend on the Datadog Node tracer here — only `@opentelemetry/api`.
 * The OTel SDK + DD OTLP exporter are wired by the runtime entrypoint.
 */

const tracer: Tracer = trace.getTracer('@agent-mesh/sdk', '0.0.0');

export interface EmitCallEventInput extends Omit<
  CallEvent,
  'schema' | 'tokensIn' | 'tokensOut' | 'tokensCacheCreate' | 'tokensCacheRead'
> {
  readonly tokens: {
    readonly inputTokens: number;
    readonly outputTokens: number;
    readonly cacheCreationInputTokens: number;
    readonly cacheReadInputTokens: number;
  };
}

/**
 * Build + validate a CallEvent and emit it as:
 *  1. Span attributes on the current active span (or a fresh one) — picked
 *     up by Datadog APM via the OTel exporter.
 *  2. A structured stdout line (`JSON.stringify(event)`) — picked up by
 *     Datadog Logs via the OTel logs pipeline / Datadog Agent autodiscovery.
 */
export const emitCallEvent = (input: EmitCallEventInput): CallEvent => {
  const event = CallEventSchema.parse({
    ...input,
    schema: 'agent-mesh.call-event/v1',
    tokensIn: input.tokens.inputTokens,
    tokensOut: input.tokens.outputTokens,
    tokensCacheCreate: input.tokens.cacheCreationInputTokens,
    tokensCacheRead: input.tokens.cacheReadInputTokens,
  });

  // Attach to the active span if there is one — otherwise span-less is fine.
  const active: Span | undefined = trace.getActiveSpan();
  if (active !== undefined) {
    active.setAttributes({
      'agent_mesh.workspace': event.workspace,
      'agent_mesh.project': event.project,
      'agent_mesh.tenant': event.tenant,
      ...(event.agent === undefined ? {} : { 'agent_mesh.agent': event.agent }),
      'agent_mesh.provider': event.provider,
      'agent_mesh.model': event.model,
      'agent_mesh.operation': event.operation,
      'agent_mesh.tokens_in': event.tokensIn,
      'agent_mesh.tokens_out': event.tokensOut,
      'agent_mesh.tokens_cache_read': event.tokensCacheRead,
      'agent_mesh.tokens_cache_create': event.tokensCacheCreate,
      'agent_mesh.cost_usd': event.costUsd,
      'agent_mesh.cache_hit': event.cacheHit,
      'agent_mesh.status': event.status,
      ...(event.errorClass === undefined ? {} : { 'agent_mesh.error_class': event.errorClass }),
    });
  }

  // Structured log line — Datadog Logs picks this up via the OTel logs
  // pipeline (or via the Datadog Agent's autodiscovery if OTel logs are
  // disabled). Datadog log processors promote `agent_mesh.*` to attributes.
  console.warn(
    JSON.stringify({
      level: 'info',
      service: 'agent-mesh',
      message: 'agent_mesh.call_event',
      ...event,
    }),
  );

  return event;
};

export { tracer };

/**
 * Context passed to `withTelemetry` so both success and failure paths can
 * emit a fully-attributed CallEvent without each adapter having to repeat
 * the boilerplate. Identity fields come from the adapter; model + operation
 * + correlation come from `MessagesParams`.
 */
export interface TelemetryContext {
  readonly provider: ProviderId;
  readonly workspace: string;
  readonly project: string;
  readonly tenant: string;
  readonly classifyError: (e: unknown) => ErrorClass;
  /** Logical model id (NOT the deployment alias). Cost is keyed by this. */
  readonly model: string;
  /** Optional deployment name when different from the logical model (Azure OpenAI only). */
  readonly deployment?: string;
}

/**
 * Run a provider-native API call inside the unified telemetry envelope.
 * Eliminates the ~60 LOC of boilerplate previously duplicated across both
 * adapters' `messages()` methods.
 *
 *  - Times the call (process.hrtime.bigint for nanosecond precision)
 *  - Emits a CallEvent on success (status=ok)
 *  - On error: classifies via the adapter, emits a CallEvent (status =
 *    throttled for RateLimit/Overloaded, else error), and rethrows as
 *    RateLimitedError or ProviderError depending on classification.
 *
 * The caller's `fn` receives the requestId so it can pass it through to
 * the provider SDK for retry-after / X-Request-ID correlation.
 */
export const withTelemetry = async (
  ctx: TelemetryContext,
  params: MessagesParams,
  fn: (
    requestId: string,
  ) => Promise<MessagesResponse & { rawTokens: EmitCallEventInput['tokens'] }>,
): Promise<MessagesResponse> => {
  const requestId = `req-${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
  const startedAt = new Date();
  const startNs = process.hrtime.bigint();
  const extensionsBase: Record<string, unknown> =
    ctx.deployment !== undefined && ctx.deployment !== ctx.model
      ? { deployment: ctx.deployment }
      : {};

  try {
    const result = await fn(requestId);
    const durationMs = Math.round(Number(process.hrtime.bigint() - startNs) / 1_000_000);
    emitCallEvent({
      workspace: ctx.workspace,
      project: ctx.project,
      tenant: ctx.tenant,
      ...(params.agent === undefined ? {} : { agent: params.agent }),
      provider: ctx.provider,
      model: ctx.model,
      operation: params.operation ?? 'messages',
      startedAt: startedAt.toISOString(),
      durationMs,
      tokens: result.rawTokens,
      costUsd: result.costUsd,
      status: 'ok',
      correlationId: params.correlationId,
      requestId,
      cacheHit: result.cacheHit,
      extensions: extensionsBase,
    });
    // Strip rawTokens from the returned MessagesResponse + overwrite durationMs.
    const { rawTokens: _strip, ...response } = result;
    void _strip;
    return { ...response, durationMs };
  } catch (e: unknown) {
    const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;
    const errorClass = ctx.classifyError(e);
    emitCallEvent({
      workspace: ctx.workspace,
      project: ctx.project,
      tenant: ctx.tenant,
      ...(params.agent === undefined ? {} : { agent: params.agent }),
      provider: ctx.provider,
      model: ctx.model,
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
      extensions: {
        ...extensionsBase,
        errorMessage: e instanceof Error ? e.message : String(e),
      },
    });
    const details = {
      provider: ctx.provider,
      model: ctx.model,
      ...(ctx.deployment === undefined ? {} : { deployment: ctx.deployment }),
      errorClass,
    };
    const niceMessage = `${ctx.provider} ${errorClass}: ${e instanceof Error ? e.message : String(e)}`;
    if (errorClass === 'RateLimit' || errorClass === 'Overloaded') {
      throw new RateLimitedError(niceMessage, details);
    }
    throw new ProviderError(niceMessage, details);
  }
};

// Used only for adapter type inference.
export type AdapterMessages = ProviderAdapter['messages'];
