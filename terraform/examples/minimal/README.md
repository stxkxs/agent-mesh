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

## Opt-in M2 modules

| Flag                          | What it adds                                                                                                                                                                                                                        |
| ----------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `deploy_audit = true`         | Event Hubs namespace + audit hub + Capture to ADLS partitioned by `yyyy/mm/dd/hh` + Synapse Serverless workspace + Auditor-readable SQL endpoint                                                                                    |
| `deploy_network = true`       | VNet 10.40.0.0/16 + 5 subnets (aks_system, aks_user, mcp, endpoints, appgateway) + NSG baseline + Private Endpoints for KV/Storage/EventHubs + Azure Firewall (only for iso27001-aligned / hipaa-aware)                             |
| `deploy_identity = true`      | Six AAD groups (PlatformAdmin / WorkspaceAdmin / Developer / Auditor / FinOps / ReadOnly) + scoped RBAC role assignments. Auditor decrypts logs CMK only.                                                                           |
| `deploy_observability = true` | 1 Datadog dashboard (5 rows: Volume/Performance/Errors/Cost/Compliance) + 9 monitors (p99 latency per model, error rate, cache-hit drop, eval regression, audit lag, spend anomaly). Requires `DD_API_KEY` + `DD_APP_KEY` env vars. |

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

| Profile              | Flags                                                 |
| -------------------- | ----------------------------------------------------- |
| **Smoke test**       | (none — M1 only)                                      |
| **Audit + RBAC**     | `deploy_audit=true deploy_identity=true`              |
| **Full M2**          | All four flags                                        |
| **Production-equiv** | All four flags + `compliance_preset=iso27001-aligned` |

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
