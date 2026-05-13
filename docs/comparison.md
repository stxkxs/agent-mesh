# agent-mesh vs. raw Azure OpenAI vs. DIY platform

The honest comparison. Three columns: what you get out of the box from Azure OpenAI alone, what you'd typically build yourself to make it production-grade, and where agent-mesh lands.

| Capability                   | Raw Azure OpenAI                                      | DIY platform (~6 months of platform work)     | **agent-mesh**                                                                                                                   |
| ---------------------------- | ----------------------------------------------------- | --------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------- |
| Latest model availability    | Day-of (model-by-model)                               | Day-of                                        | Day-of (you bring the deployment)                                                                                                |
| **Provider abstraction**     | Azure OpenAI only                                     | Custom router, hand-written per provider      | `ProviderAdapter` + 2 production adapters (Azure OpenAI + Anthropic), unified `ErrorClass` taxonomy, declarative fallback chains |
| **Workload Identity**        | Manual app registration + cert rotation               | Custom Helm + Terraform per environment       | `terraform/modules/credentials` ships AAD app + federated credential per workspace+project                                       |
| **Audit trail**              | Diagnostic Settings → Log Analytics (no per-call EMF) | Custom Firehose-equivalent pipeline           | Event Hubs → ADLS capture → Synapse Serverless with `cost_reconciliation_emf_vs_cur` view ready                                  |
| **Cost telemetry**           | Cost Management daily                                 | Custom EMF emission + reconciliation pipeline | Per-call `agent_mesh.cost_usd` via OTel + daily CM export + reconciliation Synapse view                                          |
| **Budgets + kill-switch**    | Azure Budgets notify-only                             | Action Group + custom Automation runbook      | `terraform/modules/budgets` with 5-step ladder + Logic App that nukes federated creds on hard breach + PIM-gated recovery        |
| **Prompt versioning**        | Hand-managed config                                   | Custom S3-equivalent + pointer-swap promotion | Content-addressed Blob assets + App Configuration pointer-swap + `PromptResolver` with per-process cache                         |
| **Eval gating in CI**        | None                                                  | Custom pytest / vitest runner                 | `@agent-mesh/runtime-evals` with 4 scorers + worst-case OTel emission + Datadog regression monitor                               |
| **Prompt injection defense** | None                                                  | Custom filter                                 | 5-layer stack: input Zod + tool egress Zod + classifier hook + structured-output enforcement + PII redaction                     |
| **PII redaction**            | None                                                  | Custom regex / Cognitive Services             | Bidirectional, `replace` / `hash` (HMAC pepper, fail-closed) / `block` modes, default rule set                                   |
| **MCP ingress**              | None                                                  | Custom AKS Ingress + WAF + cert-manager       | Application Gateway v2 + WAF v2 (OWASP CRS 3.2 + Bot Manager) + KV cert auto-rotation                                            |
| **Agent runtime**            | Bring your own                                        | Custom AKS workload                           | `charts/agent-runtime` + KEDA Service Bus depth scaler + DLQ handler + PDB                                                       |
| **Idempotency**              | None                                                  | Custom DDB-equivalent                         | Cosmos NoSQL Serverless with `/agent_id` partition, 7d TTL, RBAC-only auth                                                       |
| **Observability stack**      | Azure Monitor                                         | Hand-stitched                                 | OTel SDK → OTel Collector → Datadog OTLP, Datadog dashboard + 9 monitors as Terraform                                            |
| **Multi-tenant RBAC**        | Manual IAM                                            | Custom group structure                        | 6 AAD groups per workspace, scoped role assignments. Auditor decrypts logs CMK only.                                             |
| **Compliance presets**       | None                                                  | Custom per-policy                             | `standard` / `iso27001-aligned` / `hipaa-aware` gate Storage replication, retention, blob versioning, KV purge protection        |
| **5-min demo**               | "Run a curl"                                          | None (it's all hand-wired)                    | `examples/reference-app` + `docs/DEMO.md`                                                                                        |
| **License**                  | Microsoft EA                                          | Whatever your team wrote                      | Apache 2.0                                                                                                                       |

## When agent-mesh is the right call

You want the platform's surface to be **honest about its limits**:

- agent-mesh's `data_residency` is required on every workspace and surfaced on every `terraform apply` — no quiet defaults
- The `hipaa-aware` preset emits a banner reminding operators that the preset is **aware**, not compliant — Azure OpenAI's BAA + Anthropic's BAA are operator-side procurement, not infrastructure
- The kill-switch's manual Graph permission grant is documented as a post-apply step — we don't pretend it's hands-off
- ADRs record the trade-offs taken (Terraform-over-Bicep, Synapse-today-Fabric-later, Cosmos-over-PostgreSQL, AG2-over-APIM, federated-credential-removal-over-Resource-Group-locks)

## When raw Azure OpenAI is enough

You're prototyping. You have one workload, one model, no compliance requirements, no SRE on-call rotation. Stand up an Azure OpenAI resource, write a Python script, ship it. agent-mesh adds value when you have:

- More than one workload sharing infrastructure (workspace + project isolation matters)
- A non-trivial budget that needs governance
- A compliance posture that an auditor will read someday
- Multiple environments (workspace as a unit of promotion)
- Cost questions you can't answer from a quarterly invoice

## When DIY is the right call

You have unusual constraints agent-mesh doesn't fit:

- Multi-cloud platform spanning Azure + GCP + AWS — agent-mesh is Azure-shaped
- A custom IaC tool (Pulumi-only shop, Crossplane shop)
- Strict vendor avoidance (Datadog ruled out, Workload Identity ruled out)
- Workload-specific primitives we don't model (real-time streaming, voice, custom multi-modal pipelines)

In those cases, the agent-mesh ADRs are useful as a reference for the trade-offs your DIY platform will hit.
