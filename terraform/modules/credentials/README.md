# credentials

Federates the AKS OIDC issuer with an AAD application — so pods running with a specific Kubernetes ServiceAccount can exchange their projected SA token for an Azure AD access token. **No client secrets, no API keys, no kubelet credential plumbing.**

```hcl
module "credentials" {
  source = "../../modules/credentials"

  workspace_name       = module.workspace.workspace_name
  project              = "alpha"
  key_vault_id         = module.workspace.key_vault_id
  aks_oidc_issuer_url  = azurerm_kubernetes_cluster.aks.oidc_issuer_url
  namespace            = "agent-mesh"
  service_account      = "triage-agent"
  rotation_period_days = 90
  tags                 = module.workspace.tags
}
```

## What it makes

| Resource                                                    | Why                                                                                                                                          |
| ----------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| AAD Application `agent-mesh-<workspace>-<project>`          | The "identity" the workload assumes via Workload Identity.                                                                                   |
| AAD Service Principal                                       | Backing SP for the application; receives the Key Vault Secrets User role assignment.                                                         |
| Federated Identity Credential                               | Trusts the AKS OIDC issuer for the specific `system:serviceaccount:<ns>:<sa>` subject.                                                       |
| Key Vault Secret `anthropic-key-<project>` (placeholder)    | Stores the Anthropic API key. **Terraform ignores `value` after first apply** — set the real value out-of-band via `az keyvault secret set`. |
| Key Vault Secret `azure-openai-key-<project>` (placeholder) | Same pattern for Azure OpenAI key in non-AAD setups. Skip if all your Azure OpenAI access is AAD-only.                                       |

## Post-apply: set the secret values

```bash
az keyvault secret set \
  --vault-name "$VAULT_NAME" \
  --name "anthropic-key-alpha" \
  --value '{"apiKey":"sk-ant-…","issuedAt":"2026-05-12T00:00:00Z","rotationGeneration":1}'
```

The secret is tagged with `rotation_period_days` so the rotation runbook (`docs/runbooks/key-rotation-failure.md`) can pick up which secrets are due.

## Wire it on the cluster

Apply the annotations from `module.credentials.service_account_annotations` to your ServiceAccount + Pod template. The `azure.workload.identity/use=true` label opts the pod into Workload Identity webhook mutation.

## ADRs

- [ADR-0002 — Dual provider SDK abstraction](../../../docs/adr/0002-dual-provider-sdk.md)
- [ADR-0004 — Workload Identity, no client secrets](../../../docs/adr/0004-workload-identity-no-secrets.md)
