/**
 * agent-mesh — minimal example.
 *
 * M1: workspace + credentials always provision.
 * M2 additions (opt-in via flags):
 *   - var.deploy_audit         → audit pipeline (Event Hubs + Capture + Synapse)
 *   - var.deploy_network       → VNet + Private Endpoints + NSGs
 *   - var.deploy_identity      → six AAD groups + RBAC scoping
 *   - var.deploy_observability → Datadog dashboard + 9 monitors
 *
 * Each flag is independent — you can deploy any combination. The cheapest
 * happy-path is the M1 default (workspace + credentials only).
 */

data "azurerm_client_config" "current" {}

module "workspace" {
  source = "../../modules/workspace"

  workspace_name    = var.workspace_name
  location          = var.location
  compliance_preset = var.compliance_preset
  data_residency    = var.data_residency
  tags              = var.tags
}

module "credentials" {
  source = "../../modules/credentials"

  workspace_name      = module.workspace.workspace_name
  project             = var.project
  key_vault_id        = module.workspace.key_vault_id
  aks_oidc_issuer_url = var.aks_oidc_issuer_url
  namespace           = "agent-mesh"
  service_account     = "agent-runtime"
  tags                = module.workspace.tags
}

module "audit" {
  count  = var.deploy_audit ? 1 : 0
  source = "../../modules/audit"

  workspace_name       = module.workspace.workspace_name
  resource_group_name  = module.workspace.resource_group_name
  location             = module.workspace.location
  storage_account_id   = module.workspace.storage_account_id
  storage_account_name = module.workspace.storage_account_name
  logs_cmk_id          = module.workspace.cmk_logs_id
  compliance_preset    = module.workspace.compliance_preset
  tags                 = module.workspace.tags
}

module "network" {
  count  = var.deploy_network ? 1 : 0
  source = "../../modules/network"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  compliance_preset   = module.workspace.compliance_preset
  tags                = module.workspace.tags

  deploy_azure_firewall = var.compliance_preset != "standard"

  private_endpoint_targets = merge(
    {
      kv           = module.workspace.key_vault_id
      storage_dfs  = module.workspace.storage_account_id
      storage_blob = module.workspace.storage_account_id
    },
    var.deploy_audit ? { audit_eh = module.audit[0].event_hubs_namespace_id } : {},
  )
  private_endpoint_subresources = merge(
    {
      kv           = "vault"
      storage_dfs  = "dfs"
      storage_blob = "blob"
    },
    var.deploy_audit ? { audit_eh = "namespace" } : {},
  )
}

module "identity" {
  count  = var.deploy_identity ? 1 : 0
  source = "../../modules/identity"

  workspace_name       = module.workspace.workspace_name
  resource_group_id    = module.workspace.resource_group_id
  subscription_id      = data.azurerm_client_config.current.subscription_id
  key_vault_id         = module.workspace.key_vault_id
  cmk_logs_id          = module.workspace.cmk_logs_id
  storage_account_id   = module.workspace.storage_account_id
  synapse_workspace_id = var.deploy_audit ? module.audit[0].synapse_workspace_id : null
  tags                 = module.workspace.tags
}

module "observability" {
  count  = var.deploy_observability ? 1 : 0
  source = "../../modules/observability"

  workspace_name = module.workspace.workspace_name
  notify_handles = var.datadog_notify_handles
}
