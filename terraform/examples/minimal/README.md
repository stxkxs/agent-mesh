# agent-mesh — minimal example

Composes every agent-mesh module via opt-in flags. The smallest deployment is workspace + credentials only (M1); the full M2 deployment adds audit, network, identity, and observability.

## Always provisioned (M1)

- Resource group `rg-agent-mesh-<workspace>`
- Key Vault with two customer-managed keys (data CMK, logs CMK) and purge protection
- ADLS Gen2 Storage Account, CMK-encrypted, public network = denied
- Log Analytics workspace
- AAD application + service principal for the workload
- (optional) Workload Identity federated credential wiring AKS OIDC → AAD app
- Placeholder Key Vault secrets for both provider API keys (real values set out-of-band)

## Opt-in modules

| Flag                               | What it adds                                                                                                                                                                                                                      |
| ---------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy_audit = true` (M2)         | Event Hubs + audit hub + Capture to ADLS partitioned by `yyyy/mm/dd/hh` + Synapse Serverless + Auditor-readable SQL endpoint                                                                                                      |
| `deploy_network = true` (M2)       | VNet 10.40.0.0/16 + 5 subnets + NSG baseline + Private Endpoints for KV/Storage/EventHubs + optional Azure Firewall                                                                                                               |
| `deploy_identity = true` (M2)      | Six AAD groups (PlatformAdmin/WorkspaceAdmin/Developer/Auditor/FinOps/ReadOnly) + scoped RBAC. Auditor decrypts logs CMK only.                                                                                                    |
| `deploy_observability = true` (M2) | Datadog dashboard (5 rows) + 9 monitors (p99 per model, error rate, cache-hit drop, eval regression, audit lag, spend anomaly). Requires `DD_API_KEY` + `DD_APP_KEY`.                                                             |
| `deploy_budgets = true` (M3)       | Azure Consumption Budget scoped to the workspace RG with 50/80/100% actual + 80% forecast notifications + Logic App kill-switch on hard breach. Set `monthly_budget_usd`, `budget_email_subscribers`, `budget_webhook_endpoints`. |
| `deploy_cost = true` (M3)          | Cost Management Export to ADLS daily + cost reconciliation Synapse views (EMF-vs-CUR) + Cost Anomaly Detection routed through the budgets action group.                                                                           |
| `deploy_agent_runtime = true` (M4) | Service Bus namespace + queues with DLQ + Cosmos DB (Serverless, AAD-only, partitioned `/agent_id`, 7d TTL) + RBAC for the workload identity. Data plane the `charts/agent-runtime` Helm release expects.                         |
| `deploy_mcp_gateway = true` (M4)   | Application Gateway v2 + WAF v2 + Public IP + listener for MCP ingress. Requires `deploy_network=true`. Set `mcp_tls_certificate_secret_id` + `mcp_frontend_dns_name` + `mcp_backend_fqdns` for production.                       |

## Quick start

```bash
# Authenticate as a principal with Contributor + User Access Administrator on the target sub
az login

cd terraform/examples/minimal
terraform init
terraform plan -out tfplan -var deploy_audit=true -var deploy_identity=true
terraform apply tfplan
```

After apply, set the provider API key secrets:

```bash
VAULT_NAME=$(terraform output -raw key_vault_uri | sed -E 's|https://([^.]+).*|\1|')

az keyvault secret set --vault-name "$VAULT_NAME" --name anthropic-key-alpha \
  --value '{"apiKey":"sk-ant-…","issuedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","rotationGeneration":1}'

az keyvault secret set --vault-name "$VAULT_NAME" --name azure-openai-key-alpha \
  --value '{"apiKey":"…","endpoint":"https://my-aoai.openai.azure.com/","issuedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","rotationGeneration":1}'
```

## Recommended combinations

| Profile                       | Flags                                                                                  |
| ----------------------------- | -------------------------------------------------------------------------------------- |
| **Smoke test**                | (none — M1 only)                                                                       |
| **Audit + RBAC**              | `deploy_audit=true deploy_identity=true`                                               |
| **Full M2**                   | `deploy_audit=true deploy_network=true deploy_identity=true deploy_observability=true` |
| **Full M2 + cost governance** | All M2 + `deploy_budgets=true monthly_budget_usd=5000 deploy_cost=true`                |
| **Production-equiv**          | All flags + `compliance_preset=iso27001-aligned`                                       |

## Datadog observability

When `deploy_observability = true`, the `datadog` provider needs `DD_API_KEY` and `DD_APP_KEY` available in the environment. For CI runners, pull them from Key Vault via Workload Identity:

```bash
export DD_API_KEY=$(az keyvault secret show --vault-name "$VAULT_NAME" --name datadog-api-key --query value -o tsv)
export DD_APP_KEY=$(az keyvault secret show --vault-name "$VAULT_NAME" --name datadog-app-key --query value -o tsv)
terraform apply tfplan
```

## Wiring Workload Identity on an existing AKS cluster

```hcl
# In your AKS cluster module:
oidc_issuer_enabled = true
workload_identity_enabled = true

# Then pass to this example:
module "minimal" {
  source = "./examples/minimal"
  aks_oidc_issuer_url = azurerm_kubernetes_cluster.aks.oidc_issuer_url
}
```

After apply, annotate your ServiceAccount with the values from `terraform output service_account_annotations`.

## Cleanup

```bash
terraform destroy
```

Note: if `compliance_preset != "standard"`, Key Vault purge protection is enabled — soft-deleted vaults stick around for 90 days and the same workspace name will collide on re-create. Use the AzureRM provider's `recover_soft_deleted_key_vaults = true` (already set in `versions.tf`) or wait out the retention.
