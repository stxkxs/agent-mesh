# agent-mesh

> **Production-grade scaffolding for LLM agent platforms on AKS** — Terraform modules + Helm charts + a provider-agnostic TypeScript SDK + the governance / audit / evals / guardrails / observability layer you'd otherwise build yourself. OpenTelemetry → Datadog.

agent-mesh is to LLM workloads on Azure what a well-organized AKS landing zone is to general compute: opinionated defaults for identity, encryption, network policy, cost governance, and observability — composed so a new agent rollout is a Helm install + a Terraform `apply`, not a quarter-long platform-engineering project.

It is **provider-agnostic** at the SDK layer: every agent invocation goes through a `ProviderAdapter` that has two production implementations — Azure OpenAI (with `DefaultAzureCredential` → Workload Identity) and Anthropic (direct API, key sourced from Key Vault). Fallback chains across providers are first-class.

## What you get

| Layer                           | What's in it                                                                                                                                           |
| ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `terraform/modules/workspace`   | Resource group + Key Vault (RBAC, purge protection, two CMKs) + ADLS Gen2 (CMK, OAuth-only) + Log Analytics. The spine every other module attaches to. |
| `terraform/modules/credentials` | AAD application + Workload Identity federated credential + Key Vault secrets for both providers. No client secrets, ever.                              |
| `charts/otel-collector`         | OTel Collector DaemonSet → Datadog OTLP. PII redaction processor over log bodies. DD API key sourced from Key Vault via CSI Secrets Store.             |
| `packages/core`                 | Branded IDs, error hierarchy, Zod schemas for `CallEvent` + `TokenUsage`, content-addressed hashing.                                                   |
| `packages/sdk`                  | `ProviderAdapter` interface + `AzureOpenAIAdapter` + `AnthropicAdapter`. Cost telemetry emitted as both OTel span attributes and structured logs.      |
| `packages/pricing`              | Per-model per-million-token price tables for both providers; weekly Renovate update.                                                                   |
| `examples/minimal`              | Smallest viable deployment — workspace + credentials + OTel chart wired to Datadog.                                                                    |

## Quick start

```bash
git clone https://github.com/stxkxs/agent-mesh.git
cd agent-mesh
pnpm install

# Build + test the TypeScript layer
pnpm turbo run build test

# Plan the minimal example against your Azure sub
cd terraform/examples/minimal
terraform init
terraform plan -out tfplan
terraform apply tfplan
```

## The SDK in one minute

```ts
import { AzureOpenAIAdapter, AnthropicAdapter, type ProviderAdapter } from '@agent-mesh/sdk';
import { DefaultAzureCredential } from '@azure/identity';

// Azure OpenAI through Workload Identity — no API key in the pod
const azure: ProviderAdapter = new AzureOpenAIAdapter({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  credential: new DefaultAzureCredential(),
  workspace: 'platform-prod',
  project: 'alpha',
  tenant: 'platform',
});

const response = await azure.messages({
  model: 'gpt-4o',
  messages: [{ role: 'user', content: 'Hello' }],
  max_tokens: 256,
  correlationId: crypto.randomUUID(),
});

// Switch providers — same call shape, same error taxonomy, same telemetry
const anthropic: ProviderAdapter = new AnthropicAdapter({
  apiKey: async () => fetchFromKeyVault('anthropic-key-alpha'),
  workspace: 'platform-prod',
  project: 'alpha',
  tenant: 'platform',
});
```

Every call emits:

- An OTel span with `agent_mesh.*` attributes (workspace, project, provider, model, tokens, cost, cache_hit, status)
- A structured log line that Datadog Logs auto-extracts into searchable fields

## What agent-mesh does NOT do

- It is **not a model host**. Both providers run their inference outside the AKS cluster. agent-mesh does not change that.
- It is **not HIPAA-compliant on its own**. The `hipaa-aware` preset enables Azure-side controls; you still need a BAA with Anthropic / Microsoft separately. The README banner output by every `terraform apply` reminds you of this.
- It is **not multi-IaC**. Terraform only. Bicep users can port the modules; we don't ship them.
- It is **not multi-language at the runtime layer**. TypeScript + Node only. Polyglot would be a separate project.

## Showcase

[`examples/reference-app`](./examples/reference-app) is the portfolio capstone: a single Terraform root composing every module, a real triage agent handler exercising the SDK + runtime-agent + runtime-guardrails, a sample skill + MCP server, and an 8-case eval suite (4 happy-path + 2 edge + 2 adversarial including injection + PII). Walk through it in [docs/DEMO.md](./docs/DEMO.md).

For "should I use agent-mesh or build it myself?", read [docs/comparison.md](./docs/comparison.md).

## License

[Apache 2.0](./LICENSE).
