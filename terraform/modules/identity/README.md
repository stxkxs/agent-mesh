# identity

Six AAD groups per workspace, each scoped to a least-privilege intersection of workspace resources. Replaces claudium's six Identity Center permission sets + the SCP + permission-boundary stack on AWS.

```hcl
module "identity" {
  source = "../../modules/identity"

  workspace_name      = module.workspace.workspace_name
  resource_group_id   = module.workspace.resource_group_id
  subscription_id     = data.azurerm_client_config.current.subscription_id
  key_vault_id        = module.workspace.key_vault_id
  cmk_logs_id         = module.workspace.cmk_logs_id
  storage_account_id  = module.workspace.storage_account_id
  synapse_workspace_id = module.audit.synapse_workspace_id  # optional
  tags                = module.workspace.tags
}
```

## What each group can do

| Group              | Workspace RG | Key Vault       | Data CMK | Logs CMK               | Storage                                 | Synapse |
| ------------------ | ------------ | --------------- | -------- | ---------------------- | --------------------------------------- | ------- |
| **PlatformAdmin**  | Owner        | —               | —        | —                      | —                                       | —       |
| **WorkspaceAdmin** | Contributor  | —               | —        | —                      | —                                       | —       |
| **Developer**      | —            | Secrets Officer | —        | —                      | Blob Data Contributor                   | —       |
| **Auditor**        | —            | —               | **NONE** | Crypto Encryption User | Blob Data Reader (audit container only) | Reader  |
| **FinOps**         | Reader       | —               | —        | —                      | —                                       | —       |
| **ReadOnly**       | Reader       | —               | —        | —                      | —                                       | —       |

The critical invariant: **Auditor cannot decrypt the data CMK.** They can read audit-trail metadata (workspace, project, model, tokens, cost, timestamps) but the raw model input/output is encrypted under the data CMK they can't unwrap.

## Membership management

The module creates the groups but does NOT assign members — that's an org-side concern (PIM, SCIM, Lifecycle Workflows). Outputs include `group_ids` and `group_names` for downstream automation.

For Admin tiers (PlatformAdmin, WorkspaceAdmin), wire up [Azure AD Privileged Identity Management](https://learn.microsoft.com/azure/active-directory/privileged-identity-management/) on these groups so:

- Membership is time-bound (default 8 hours)
- Activation requires MFA + reason
- Activation events stream to your SIEM

## What this replaces

Claudium had SCPs (Service Control Policies) at the AWS Organizations level enforcing universal denies. Azure doesn't have a direct SCP equivalent — the closest is **Azure Policy** at Management Group scope (M3 will surface a `policies` module for that). For now the per-RBAC approach is the workhorse.

## ADRs

- [ADR-0006 — Azure Policy + AAD groups in lieu of SCPs](../../../docs/adr/0006-azure-policy-vs-scps.md)
