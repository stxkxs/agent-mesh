/**
 * identity — six AAD groups per workspace, each mapped to a least-privilege
 * scope.
 *
 *   PlatformAdmin   — Workspace-level Contributor + RBAC Admin. Can stand
 *                     up new projects.
 *   WorkspaceAdmin  — Workspace-level Contributor, NO RBAC. Can deploy
 *                     workloads but can't grant access to others.
 *   Developer       — Storage Blob Data Contributor + Key Vault Secrets
 *                     Officer on workspace resources; no infra mutation.
 *   Auditor         — Storage Blob Data Reader on the audit container +
 *                     Crypto Service Encryption User on the LOGS CMK only.
 *                     Cannot decrypt the data CMK. Cannot mutate.
 *   FinOps          — Cost Mgmt Reader at sub scope (assigned out-of-band).
 *                     No data plane access.
 *   ReadOnly        — Reader at workspace RG scope. View-only.
 *
 * PIM elevation is the operator's responsibility — set up Privileged
 * Identity Management on these groups in your AAD tenant for the
 * Admin tiers if you want time-bound access + MFA-on-elevation.
 */

data "azurerm_client_config" "current" {}

locals {
  default_owners = length(var.owners) > 0 ? var.owners : [data.azurerm_client_config.current.object_id]

  group_specs = {
    PlatformAdmin = {
      description   = "Full administrative control of the agent-mesh workspace, including RBAC."
      ws_role       = "Owner"
      kv_role       = null
      storage_role  = null
      logs_cmk_role = null
      data_cmk_role = null
      synapse_role  = null
    }
    WorkspaceAdmin = {
      description   = "Workspace-level Contributor — deploy workloads, no RBAC."
      ws_role       = "Contributor"
      kv_role       = null
      storage_role  = null
      logs_cmk_role = null
      data_cmk_role = null
      synapse_role  = null
    }
    Developer = {
      description   = "Developer access: Storage Blob Contributor + KV Secrets Officer at workspace scope."
      ws_role       = null
      kv_role       = "Key Vault Secrets Officer"
      storage_role  = "Storage Blob Data Contributor"
      logs_cmk_role = null
      data_cmk_role = null
      synapse_role  = null
    }
    Auditor = {
      description   = "Audit-only: read the audit container + decrypt the LOGS CMK (NOT the data CMK)."
      ws_role       = null
      kv_role       = null
      storage_role  = "Storage Blob Data Reader"
      logs_cmk_role = "Key Vault Crypto Service Encryption User"
      data_cmk_role = null
      synapse_role  = "Reader"
    }
    FinOps = {
      description   = "Cost + budget visibility. Sub-scope Cost Management Reader assigned separately."
      ws_role       = "Reader"
      kv_role       = null
      storage_role  = null
      logs_cmk_role = null
      data_cmk_role = null
      synapse_role  = null
    }
    ReadOnly = {
      description   = "View-only across workspace resources."
      ws_role       = "Reader"
      kv_role       = null
      storage_role  = null
      logs_cmk_role = null
      data_cmk_role = null
      synapse_role  = null
    }
  }

  active_groups = { for r, spec in local.group_specs : r => spec if contains(var.roles, r) }
}

# ─── AAD groups ──────────────────────────────────────────────────────────────

resource "azuread_group" "this" {
  for_each         = local.active_groups
  display_name     = "agent-mesh-${var.workspace_name}-${each.key}"
  description      = "${each.value.description} (workspace ${var.workspace_name})"
  security_enabled = true
  owners           = local.default_owners
}

# ─── Workspace-level role assignments ────────────────────────────────────────

resource "azurerm_role_assignment" "ws" {
  for_each             = { for k, v in local.active_groups : k => v if v.ws_role != null }
  scope                = var.resource_group_id
  role_definition_name = each.value.ws_role
  principal_id         = azuread_group.this[each.key].object_id
  description          = "agent-mesh ${var.workspace_name}/${each.key} → ${each.value.ws_role}"
}

# ─── Key Vault role assignments (workspace scope) ────────────────────────────

resource "azurerm_role_assignment" "kv" {
  for_each             = { for k, v in local.active_groups : k => v if v.kv_role != null }
  scope                = var.key_vault_id
  role_definition_name = each.value.kv_role
  principal_id         = azuread_group.this[each.key].object_id
  description          = "agent-mesh ${var.workspace_name}/${each.key} → ${each.value.kv_role}"
}

# ─── Storage role assignments — Auditor scoped to audit container only ──────

resource "azurerm_role_assignment" "storage_workspace" {
  for_each             = { for k, v in local.active_groups : k => v if v.storage_role != null && k != "Auditor" }
  scope                = var.storage_account_id
  role_definition_name = each.value.storage_role
  principal_id         = azuread_group.this[each.key].object_id
  description          = "agent-mesh ${var.workspace_name}/${each.key} → ${each.value.storage_role}"
}

# Auditor only sees the audit container.
resource "azurerm_role_assignment" "storage_auditor_audit_only" {
  count                = contains(var.roles, "Auditor") ? 1 : 0
  scope                = "${var.storage_account_id}/blobServices/default/containers/audit"
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azuread_group.this["Auditor"].object_id
  description          = "agent-mesh ${var.workspace_name}/Auditor → Storage Blob Data Reader (audit container only)"
}

# ─── CMK role assignments — Auditor decrypts logs CMK ONLY ──────────────────

resource "azurerm_role_assignment" "logs_cmk" {
  for_each             = { for k, v in local.active_groups : k => v if v.logs_cmk_role != null }
  scope                = var.cmk_logs_id
  role_definition_name = each.value.logs_cmk_role
  principal_id         = azuread_group.this[each.key].object_id
  description          = "agent-mesh ${var.workspace_name}/${each.key} → ${each.value.logs_cmk_role} (LOGS CMK only)"
}

# ─── Synapse role (if a Synapse workspace is supplied) ──────────────────────

resource "azurerm_role_assignment" "synapse" {
  for_each = {
    for k, v in local.active_groups : k => v
    if v.synapse_role != null && var.synapse_workspace_id != null
  }
  scope                = var.synapse_workspace_id
  role_definition_name = each.value.synapse_role
  principal_id         = azuread_group.this[each.key].object_id
  description          = "agent-mesh ${var.workspace_name}/${each.key} → Synapse ${each.value.synapse_role}"
}
