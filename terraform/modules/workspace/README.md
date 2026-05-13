# workspace

The architectural spine of an agent-mesh deployment. Creates the resource group + Key Vault (with two customer-managed keys — one for data, one for logs) + ADLS Gen2 Storage Account (with CMK) + Log Analytics workspace.

Every other agent-mesh Terraform module attaches to the Workspace by passing its outputs through.

```hcl
module "workspace" {
  source = "../../modules/workspace"

  workspace_name    = "platform-prod"
  location          = "eastus2"
  compliance_preset = "iso27001-aligned"
  data_residency    = "azure-eastus2"
  tags = {
    cost_center = "platform"
    environment = "prod"
  }
}
```

## What it makes

| Resource                                                                           | Why                                                                                                                       |
| ---------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------- |
| Resource group `rg-agent-mesh-<workspace>`                                         | Scope boundary for RBAC + tag inheritance.                                                                                |
| Key Vault `kv-am-<workspace>` (Premium, RBAC, soft-delete, purge-protection)       | Holds the two CMKs + (eventually) provider API key secrets. RBAC mode = no access policies. Public network = denied.      |
| Key `cmk-data` (RSA-4096, 365d rotation, 30d-pre-expiry)                           | Encrypts Storage, Service Bus, Cosmos. Auditor role has NO decrypt permission.                                            |
| Key `cmk-logs` (RSA-4096, 365d rotation, 30d-pre-expiry)                           | Encrypts Log Analytics + audit blob container. Auditor role has decrypt permission on this key only.                      |
| User-assigned Managed Identity `id-storage-<workspace>`                            | The identity Storage uses to reach Key Vault for the CMK wrap/unwrap operation.                                           |
| Storage Account `am<workspace>` (ZRS / GZRS, ADLS Gen2, CMK, OAuth-only)           | Audit lake + skill bundles + eval results. `shared_access_key_enabled=false` — Workload Identity is the only access path. |
| Log Analytics workspace `log-agent-mesh-<workspace>` (PerGB2018, preset retention) | Workspace-scoped log sink for Diagnostic Settings on downstream resources.                                                |

## Compliance preset effects

| Setting                       | `standard` | `iso27001-aligned` | `hipaa-aware`        |
| ----------------------------- | ---------- | ------------------ | -------------------- |
| Log retention                 | 30 days    | 90 days            | 365 days             |
| Storage replication           | ZRS        | ZRS                | GZRS (geo-redundant) |
| Blob versioning + change feed | off        | on                 | on                   |
| Key Vault purge protection    | off        | on (irreversible!) | on (irreversible!)   |

## ADRs

- [ADR-0001 — Terraform over Bicep](../../../docs/adr/0001-terraform-over-bicep.md)
- [ADR-0003 — Two CMKs per workspace (data + logs)](../../../docs/adr/0003-two-cmks-per-workspace.md)
