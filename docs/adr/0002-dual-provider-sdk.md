# ADR-0002 — Dual provider SDK abstraction

**Status:** accepted · 2026-05-12

## Context

Azure-shop platform teams adopting LLM workloads typically start with Azure OpenAI (AAD-integrated, Private Endpoint-friendly, in-budget under Microsoft EA) and add Anthropic later for capability reasons (longer context, prompt caching economics, Claude-specific evals). Some teams run both indefinitely; some plan a one-way migration.

If we hard-code one provider into the agent-runtime, every workload that spans both has to maintain its own router. We end up reinventing the same abstraction at every adopter.

## Decision

**`@agent-mesh/sdk` ships a `ProviderAdapter` interface as the seam.** Two implementations are first-class — `AzureOpenAIAdapter` and `AnthropicAdapter`. Downstream packages (`runtime-agent`, `runtime-guardrails`, `runtime-evals`, `runtime-batch`) only know about `ProviderAdapter`.

```ts
interface ProviderAdapter {
  readonly providerId: 'azure-openai' | 'anthropic';
  messages(params: MessagesParams): Promise<MessagesResponse>;
  estimateCost(model: ModelId, tokens: TokenUsage): number;
  classifyError(e: unknown): ErrorClass;
}
```

The unified `ErrorClass` taxonomy (`RateLimit | Overloaded | BadRequest | Server | Network | AuthFailure`) lets retry/circuit-breaker logic be provider-agnostic. Pricing tables are keyed by (provider, model) in `@agent-mesh/pricing`.

Fallback chains are declarative at the agent level:

```ts
defineAgent({
  primary: { provider: 'azure-openai', model: 'gpt-4o' },
  fallbacks: [{ provider: 'anthropic', model: 'claude-sonnet-4-6' }],
  // ...
});
```

## Consequences

**Positive**

- Workloads can swap providers via config, not code.
- Eval suites can target the same agent definition under both providers — apples-to-apples comparison.
- Cost telemetry is uniform: `agent_mesh.provider` is a Datadog tag, every dashboard can split by provider.

**Negative**

- The lowest-common-denominator API drops a few provider-specific knobs (Anthropic's `extended_thinking`, OpenAI's `seed`, etc.). Adapters expose escape-hatch `extensions` on input + output for these.
- Some features are not symmetric (Anthropic prompt caching uses `cache_control`; Azure OpenAI uses implicit prefix caching). The unified `MessagesParams.system` array shape with `cache_control` hints lets us paper over it — adapters ignore hints they don't support.

**Neutral**

- We carry pricing tables for both providers. Renovate handles the upstream-change PR cadence.
