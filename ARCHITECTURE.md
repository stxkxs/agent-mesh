# Architecture

## Bounded contexts

agent-mesh organizes around 12 DDD-style bounded contexts. Each gets one Terraform module + (optionally) one Helm chart + one TypeScript package. The Workspace context is the spine; every other context attaches to it via outputs.

| Context           | Terraform module     | Helm chart          | TS package               | What it owns                                                    |
| ----------------- | -------------------- | ------------------- | ------------------------ | --------------------------------------------------------------- |
| **Workspace**     | `workspace`          | —                   | —                        | RG, Key Vault, two CMKs, Storage, Log Analytics                 |
| **Credentials**   | `credentials`        | —                   | —                        | AAD app, Workload Identity FedCred, KV provider secrets         |
| **Network**       | `network` (M2)       | —                   | —                        | VNet, Private Endpoints, NSGs, optional Azure Firewall          |
| **Identity**      | `identity` (M2)      | —                   | —                        | AAD groups, custom roles, RBAC scoping (replaces SCPs)          |
| **Audit**         | `audit` (M2)         | —                   | —                        | Event Hubs → ADLS capture → Synapse Serverless                  |
| **Cost**          | `cost` (M3)          | —                   | —                        | Cost Mgmt exports → ADLS → Synapse views + DD monitors          |
| **Budgets**       | `budgets` (M3)       | —                   | —                        | Azure Budgets + kill-switch via AAD group toggle + PIM recovery |
| **MCP**           | `mcp` (M4)           | `mcp-server`        | —                        | AG2 + WAF ingress; AKS workload for MCP servers                 |
| **Agent runtime** | `agent-runtime` (M4) | `agent-runtime`     | `runtime-agent`          | KEDA-scaled AKS deployment + Service Bus + Cosmos idempotency   |
| **Skills**        | `skills` (M5)        | —                   | `runtime-skills-builder` | Blob versioned bundles + Cosmos manifest + lifecycle            |
| **Evals**         | `evals` (M5)         | `eval-runner`       | `runtime-evals`          | Argo Workflows install + DD eval-score monitor                  |
| **Batch**         | `batch` (M5)         | —                   | `runtime-batch`          | Service Bus + KEDA scaler for batch dispatch                    |
| **Guardrails**    | `guardrails` (M5)    | `guardrail-sidecar` | `runtime-guardrails`     | 5-layer injection defense + PII redaction (input + output)      |
| **Observability** | `observability` (M2) | `otel-collector`    | —                        | OTel Collector + Datadog wiring + dashboards + monitors         |

## Key architectural decisions

### Provider abstraction

```ts
interface ProviderAdapter {
  readonly providerId: 'azure-openai' | 'anthropic';
  messages(params: MessagesParams): Promise<MessagesResponse>;
  estimateCost(model: ModelId, tokens: TokenUsage): number;
  classifyError(e: unknown): ErrorClass;
}
```

`AzureOpenAIAdapter` and `AnthropicAdapter` are the production implementations. The unified `ErrorClass` taxonomy (`RateLimit | Overloaded | BadRequest | Server | Network | AuthFailure`) lets the runtime-agent loop reason about retry semantics independent of provider.

Fallback chains are configured at the agent level — when an idempotent op gets 529 from one provider, the loop retries against the next chain entry.

### Auth

The pod path:

1. Kubernetes ServiceAccount annotated with `azure.workload.identity/client-id`
2. AKS OIDC issuer trusted by the AAD app (federated identity credential)
3. Pod's projected token exchanged for an Azure AD token via Workload Identity webhook
4. `DefaultAzureCredential.WorkloadIdentityCredential` resolves transparently in the SDK
5. Key Vault Secrets Reader role lets the SP fetch the provider keys
6. `AnthropicAdapter.apiKey` resolver pulls on cold start, caches for the adapter lifetime
7. `AzureOpenAIAdapter` uses the credential directly (no API key)

No client secrets. No long-lived service principal credentials. No API keys in environment variables.

### Two CMKs per workspace

- **`cmk-data`** encrypts Storage, Service Bus, Cosmos. Auditor role has **no** decrypt permission.
- **`cmk-logs`** encrypts Log Analytics + the audit blob container. Auditor role has decrypt **only on this key**.

A breach of the auditor role surfaces audit history (an acceptable read-disclosure for an oversight body) but does not unlock data plane content.

### Kill-switch

Hard budget breach (≥120%) triggers an Azure Logic App that:

1. Removes the pod's ServiceAccount from the AAD app's federated-credential trust → Workload Identity tokens stop being issued
2. Disables every Service Bus subscription used by the workspace
3. Pauses KEDA `ScaledObject` to drop replicas to 0

**Recovery is human-only.** A PIM-elevated AAD admin (with MFA + approver) restores the trust. There is no API to do this without going through PIM. Dual-approval is enforced by the PIM activation flow.

### Observability

Every signal flows through the OTel Collector DaemonSet:

```
agent pod → OTLP (localhost:4317) → OTel Collector
   → memory_limiter
   → resource processor (adds workspace, project, cluster)
   → transform processor (PII redaction on log bodies)
   → batch
   → datadog exporter (traces / metrics / logs)
```

The DD API key is sourced from Key Vault via the CSI Secrets Store Provider (`azure.workload.identity` driver) — never embedded in a manifest.

## Compliance presets

| Preset             | Storage replication | Log retention | Blob versioning | KV purge protection |
| ------------------ | ------------------- | ------------- | --------------- | ------------------- |
| `standard`         | ZRS                 | 30 days       | off             | off                 |
| `iso27001-aligned` | ZRS                 | 90 days       | on              | on (irreversible)   |
| `hipaa-aware`      | GZRS                | 365 days      | on              | on (irreversible)   |

`hipaa-aware` emits a banner on every `terraform apply` noting that compliance requires a BAA with the provider (Microsoft / Anthropic) — agent-mesh does not, on its own, render any workload HIPAA-compliant.

## What's in M1

- ✅ Workspace + Credentials Terraform modules
- ✅ OTel Collector Helm chart wired to Datadog
- ✅ Provider-agnostic SDK with Azure OpenAI + Anthropic adapters
- ✅ Pricing tables for both providers
- ✅ Core schemas + branded IDs + error hierarchy
- ✅ Examples/minimal end-to-end
- ✅ CI: TS lint/typecheck/test + tf fmt/validate/tflint/tfsec + helm lint

## What's next (M2-M6)

- M2: audit + network + identity + observability dashboards
- M3: cost + budgets + kill-switch automation
- M4: agent-runtime (KEDA + Service Bus + Cosmos) + MCP gateway
- M5: skills + evals + batch + guardrails
- M6: reference-app composing every module + comparison matrix + DEMO.md
