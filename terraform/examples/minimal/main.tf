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
  compliance_preset    = module.workspace.compliance_preset
  tags                 = module.workspace.tags
}

module "network" {
  count  = var.deploy_network ? 1 : 0
  source = "../../modules/network"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
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
  key_vault_id         = module.workspace.key_vault_id
  cmk_logs_id          = module.workspace.cmk_logs_id
  storage_account_id   = module.workspace.storage_account_id
  synapse_workspace_id = var.deploy_audit ? module.audit[0].synapse_workspace_id : null
}

module "observability" {
  count  = var.deploy_observability ? 1 : 0
  source = "../../modules/observability"

  workspace_name = module.workspace.workspace_name
  notify_handles = var.datadog_notify_handles
}

module "budgets" {
  count  = var.deploy_budgets ? 1 : 0
  source = "../../modules/budgets"

  workspace_name      = module.workspace.workspace_name
  resource_group_id   = module.workspace.resource_group_id
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  monthly_budget_usd        = var.monthly_budget_usd
  kill_switch_threshold_pct = var.kill_switch_threshold_pct
  email_subscribers         = var.budget_email_subscribers
  webhook_endpoints         = var.budget_webhook_endpoints

  kill_switch_target_app_id = module.credentials.application_object_id
  deploy_kill_switch        = true
}

module "cost" {
  count  = var.deploy_cost ? 1 : 0
  source = "../../modules/cost"

  workspace_name       = module.workspace.workspace_name
  resource_group_id    = module.workspace.resource_group_id
  storage_account_id   = module.workspace.storage_account_id
  storage_account_name = module.workspace.storage_account_name

  enable_anomaly_alert    = var.deploy_budgets
  anomaly_action_group_id = var.deploy_budgets ? module.budgets[0].action_group_id : null
  enable_synapse_views    = var.deploy_audit
}

module "agent_runtime" {
  count  = var.deploy_agent_runtime ? 1 : 0
  source = "../../modules/agent-runtime"

  workspace_name             = module.workspace.workspace_name
  project                    = var.project
  resource_group_name        = module.workspace.resource_group_name
  location                   = module.workspace.location
  compliance_preset          = module.workspace.compliance_preset
  log_analytics_workspace_id = module.workspace.log_analytics_workspace_id
  tags                       = module.workspace.tags

  agent_workload_principal_id = module.credentials.service_principal_object_id
}

module "mcp" {
  count  = var.deploy_mcp_gateway && var.deploy_network ? 1 : 0
  source = "../../modules/mcp"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  appgateway_subnet_id      = module.network[0].appgateway_subnet_id
  key_vault_id              = module.workspace.key_vault_id
  tls_certificate_secret_id = var.mcp_tls_certificate_secret_id
  frontend_dns_name         = var.mcp_frontend_dns_name
  backend_fqdns             = var.mcp_backend_fqdns
}
