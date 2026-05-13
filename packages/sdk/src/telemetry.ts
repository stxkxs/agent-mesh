import { CallEventSchema, type CallEvent } from '@agent-mesh/core/schemas';
import { trace, type Span, type Tracer } from '@opentelemetry/api';

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
