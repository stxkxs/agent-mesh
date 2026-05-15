# @agent-mesh/sdk

Provider-agnostic LLM client. Two adapters share one `ProviderAdapter` interface so the rest of agent-mesh (`runtime-agent`, `runtime-guardrails`, `runtime-evals`, `runtime-batch`) only ever talks to one shape.

```ts
import { AzureOpenAIAdapter, AnthropicAdapter, type ProviderAdapter } from '@agent-mesh/sdk';
import { DefaultAzureCredential } from '@azure/identity';

const azure: ProviderAdapter = new AzureOpenAIAdapter({
  endpoint: 'https://my-aoai.openai.azure.com/',
  credential: new DefaultAzureCredential(), // Workload Identity in AKS
  workspace: 'platform-prod',
  project: 'alpha',
  tenant: 'platform',
});

const anthropic: ProviderAdapter = new AnthropicAdapter({
  apiKey: async () => fetchFromKeyVault('anthropic-key'),
  workspace: 'platform-prod',
  project: 'alpha',
  tenant: 'platform',
});
```

Every call emits a structured `CallEvent` to:

- the active OpenTelemetry span (`agent_mesh.*` attributes — Datadog APM picks these up)
- stdout as a JSON log line (`agent_mesh.call_event` — Datadog Logs pipeline promotes the fields)

Errors are normalized into the `ErrorClass` taxonomy (`RateLimit | Overloaded | BadRequest | Server | Network | AuthFailure`) and re-thrown as `RateLimitedError` or `ProviderError` so callers can branch on a single shape regardless of provider.

## Auth

- Azure OpenAI: prefer `TokenCredential` from `@azure/identity` (`DefaultAzureCredential` resolves to Workload Identity in AKS). Static `apiKey` supported for local dev only.
- Anthropic: pass `apiKey` as a string for local dev or as an async resolver that pulls from Key Vault on first call.
