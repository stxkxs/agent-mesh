# agent-mesh — minimal example

The smallest demoable agent-mesh footprint: one workspace + one project's credentials.

## Provisions

- Resource group `rg-agent-mesh-<workspace>`
- Key Vault with two customer-managed keys (data CMK, logs CMK) and purge protection
- ADLS Gen2 Storage Account, CMK-encrypted, public network = denied
- Log Analytics workspace
- AAD application + service principal for the workload
- (optional) Workload Identity federated credential wiring AKS OIDC → AAD app
- Placeholder Key Vault secrets for both provider API keys (real values set out-of-band)

## Quick start

```bash
# Authenticate as a principal with Contributor + User Access Administrator on the target sub
az login

cd terraform/examples/minimal
terraform init
terraform plan -out tfplan
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

## Wiring Workload Identity on an existing AKS cluster

```hcl
# In your AKS cluster module:
oidc_issuer_enabled = true
workload_identity_enabled = true

# Then pass:
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
