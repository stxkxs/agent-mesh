# reference-app

The agent-mesh portfolio showcase. Composes every module + chart + runtime package into a single deployable that exercises the platform end-to-end.

## What it is

A single Terraform root (`terraform/`) + a TypeScript agent (`agents/triage/`) + a sample skill (`skills/pdf-summarizer/`) + a sample MCP server (`mcp-servers/filesystem-readonly/`) + a versioned prompt (`prompts/triage-system.v1.mdx`) + an 8-case eval suite (`evals/triage-quality/`).

```
examples/reference-app/
├── terraform/                          → composes M1-M4 modules
├── agents/triage/                      → real triage handler (sdk + runtime-agent + runtime-guardrails)
├── prompts/triage-system.v1.mdx        → versioned system prompt
├── skills/pdf-summarizer/               → skill.yaml + handler + README
├── mcp-servers/filesystem-readonly/     → distroless Node 24 + Dockerfile + path-sandbox
├── evals/triage-quality/                → 8 cases (4 happy-path + 2 edge + 2 adversarial)
└── docs/                                → DEMO walkthrough + per-deploy notes
```

## What it provisions

Running `terraform apply` in `terraform/` stands up:

- 1 resource group + Key Vault (2 CMKs) + ADLS Gen2 + Log Analytics
- 1 AAD application + federated identity credential for the triage agent
- VNet 10.40.0.0/16 + 5 subnets + Private Endpoints for KV/Storage/Event Hubs
- 6 AAD groups with scoped RBAC (Auditor decrypts logs CMK only)
- Event Hubs + Capture to ADLS + Synapse Serverless SQL endpoint
- Datadog dashboard (5 rows) + 9 monitors
- $500/mo Consumption Budget with 5-step ladder + Logic App kill-switch
- Cost Management Export + reconciliation Synapse views
- Service Bus namespace + Cosmos DB Serverless + workload RBAC
- Application Gateway v2 + WAF v2 for the MCP server

## Quick start

```bash
# 1. Authenticate as Contributor + User Access Administrator on a sandbox sub
az login

# 2. Plan + apply
cd examples/reference-app/terraform
terraform init
terraform plan -out tfplan
terraform apply tfplan

# 3. Grant the Logic App Graph permission (one-time)
terraform output -raw kill_switch_post_apply_steps | bash

# 4. Set the Anthropic API key (Azure OpenAI uses Workload Identity, no key needed)
VAULT=$(terraform output -raw key_vault_uri | sed -E 's|https://([^.]+).*|\1|')
az keyvault secret set --vault-name "$VAULT" --name anthropic-key-alpha \
  --value '{"apiKey":"sk-ant-...","issuedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","rotationGeneration":1}'

# 5. Build + push the MCP server image
cd ../mcp-servers/filesystem-readonly
docker build -t myacr.azurecr.io/mcp-filesystem-readonly:v0.1.0 .
docker push myacr.azurecr.io/mcp-filesystem-readonly:v0.1.0

# 6. Build + push the triage agent image (Dockerfile is operator-supplied;
#    bundle agents/triage/src/handler.ts in your CI pipeline)

# 7. Helm install both
helm install filesystem charts/mcp-server --namespace mcp ...
helm install triage    charts/agent-runtime --namespace agent-mesh ...

# 8. Send a test message + watch the dashboard
```

Full walkthrough in [docs/DEMO.md](../../docs/DEMO.md).

## Compliance presets

| Preset               | What changes                                                                   |
| -------------------- | ------------------------------------------------------------------------------ |
| `standard` (default) | ZRS Storage, 30d log retention, no purge protection, HTTP-only MCP             |
| `iso27001-aligned`   | ZRS Storage, 90d retention, KV purge protection (irreversible), Azure Firewall |
| `hipaa-aware`        | GZRS Storage, 365d retention, Premium Event Hubs, Cosmos paired-region         |

Set via `terraform plan -var compliance_preset=iso27001-aligned`.

## Tearing down

```bash
cd examples/reference-app/terraform
terraform destroy
```

If `compliance_preset != standard`, Key Vault purge protection means the vault sticks around for 90 days post-destroy. Use the AzureRM provider's `recover_soft_deleted_key_vaults = true` (already set) or wait out the retention before re-creating the same workspace name.
