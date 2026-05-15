/**
 * Reference deployment composing every agent-mesh module end-to-end.
 *
 *   workspace (M1)         — the architectural spine
 *   credentials (M1)       — Workload Identity + KV secrets
 *   network (M2)           — VNet + 5 subnets + PE + Azure Firewall
 *   identity (M2)          — 6 AAD groups + scoped RBAC
 *   audit (M2)             — Event Hubs → ADLS capture → Synapse Serverless
 *   observability (M2)     — Datadog dashboard + 9 monitors
 *   budgets (M3)           — Consumption Budget + kill-switch Logic App
 *   cost (M3)              — Cost Management Export + reconciliation views
 *   agent-runtime (M4)     — Service Bus + Cosmos + RBAC + KEDA wiring
 *   mcp (M4)               — Application Gateway v2 + WAF v2
 *
 * Plus opt-in flags for `compliance_preset` to switch standards. Default
 * is `standard`; flip to `iso27001-aligned` for the production-equiv.
 */

module "workspace" {
  source = "../../../terraform/modules/workspace"

  workspace_name    = var.workspace_name
  location          = var.location
  compliance_preset = var.compliance_preset
  data_residency    = var.data_residency
  tags              = var.tags
}

module "credentials" {
  source = "../../../terraform/modules/credentials"

  workspace_name      = module.workspace.workspace_name
  project             = var.project
  key_vault_id        = module.workspace.key_vault_id
  aks_oidc_issuer_url = var.aks_oidc_issuer_url
  namespace           = "agent-mesh"
  service_account     = "triage-agent"
  tags                = module.workspace.tags
}

module "network" {
  source = "../../../terraform/modules/network"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  deploy_azure_firewall = var.compliance_preset != "standard"

  private_endpoint_targets = {
    kv           = module.workspace.key_vault_id
    storage_dfs  = module.workspace.storage_account_id
    storage_blob = module.workspace.storage_account_id
    audit_eh     = module.audit.event_hubs_namespace_id
  }
  private_endpoint_subresources = {
    kv           = "vault"
    storage_dfs  = "dfs"
    storage_blob = "blob"
    audit_eh     = "namespace"
  }
}

module "audit" {
  source = "../../../terraform/modules/audit"

  workspace_name       = module.workspace.workspace_name
  resource_group_name  = module.workspace.resource_group_name
  location             = module.workspace.location
  storage_account_id   = module.workspace.storage_account_id
  storage_account_name = module.workspace.storage_account_name
  compliance_preset    = module.workspace.compliance_preset
  tags                 = module.workspace.tags
}

module "identity" {
  source = "../../../terraform/modules/identity"

  workspace_name       = module.workspace.workspace_name
  resource_group_id    = module.workspace.resource_group_id
  key_vault_id         = module.workspace.key_vault_id
  cmk_logs_id          = module.workspace.cmk_logs_id
  storage_account_id   = module.workspace.storage_account_id
  synapse_workspace_id = module.audit.synapse_workspace_id
}

module "observability" {
  source = "../../../terraform/modules/observability"

  workspace_name = module.workspace.workspace_name
  notify_handles = var.datadog_notify_handles
}

module "budgets" {
  source = "../../../terraform/modules/budgets"

  workspace_name      = module.workspace.workspace_name
  resource_group_id   = module.workspace.resource_group_id
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  monthly_budget_usd        = var.monthly_budget_usd
  kill_switch_threshold_pct = 120
  email_subscribers         = var.budget_email_subscribers

  kill_switch_target_app_id = module.credentials.application_object_id
  deploy_kill_switch        = true
}

module "cost" {
  source = "../../../terraform/modules/cost"

  workspace_name       = module.workspace.workspace_name
  resource_group_id    = module.workspace.resource_group_id
  storage_account_id   = module.workspace.storage_account_id
  storage_account_name = module.workspace.storage_account_name

  enable_anomaly_alert    = true
  anomaly_action_group_id = module.budgets.action_group_id
  enable_synapse_views    = true
}

module "agent_runtime" {
  source = "../../../terraform/modules/agent-runtime"

  workspace_name             = module.workspace.workspace_name
  project                    = var.project
  resource_group_name        = module.workspace.resource_group_name
  location                   = module.workspace.location
  compliance_preset          = module.workspace.compliance_preset
  log_analytics_workspace_id = module.workspace.log_analytics_workspace_id
  tags                       = module.workspace.tags

  agent_workload_principal_id = module.credentials.service_principal_object_id

  queues = {
    invocations = {
      max_size_megabytes    = 1024
      lock_duration_iso8601 = "PT5M"
      max_delivery_count    = 5
    }
  }
}

module "mcp" {
  source = "../../../terraform/modules/mcp"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  appgateway_subnet_id = module.network.appgateway_subnet_id
  key_vault_id         = module.workspace.key_vault_id

  # Sandbox: HTTP-only with synth warning. Production wires
  # tls_certificate_secret_id + frontend_dns_name + per-server backends.
  backend_fqdns = {
    filesystem = "filesystem-readonly.mcp.svc.cluster.local"
  }
}
