output "data_residency_notice" {
  description = "Plain-language data-residency notice — surfaced on every apply."
  value       = module.workspace.data_residency_notice
}

output "resource_group_name" {
  value = module.workspace.resource_group_name
}

output "key_vault_uri" {
  value = module.workspace.key_vault_uri
}

output "workload_identity_client_id" {
  description = "AAD app client ID for the triage agent's ServiceAccount."
  value       = module.credentials.application_client_id
}

output "service_account_annotations" {
  description = "Annotations to drop onto the triage agent ServiceAccount."
  value       = module.credentials.service_account_annotations
}

output "servicebus_namespace" {
  description = "Service Bus FQDN — agent reads from `invocations` here."
  value       = module.agent_runtime.servicebus_namespace_hostname
}

output "cosmos_endpoint" {
  description = "Cosmos endpoint for idempotency state."
  value       = module.agent_runtime.cosmos_endpoint
}

output "audit_synapse_sql_endpoint" {
  description = "Synapse Serverless SQL endpoint for ad-hoc audit queries."
  value       = module.audit.synapse_serverless_sql_endpoint
}

output "audit_query_starter" {
  description = "Starter T-SQL for token spend by workspace × provider × model."
  value       = module.audit.audit_query_starter
}

output "cost_view_definitions" {
  description = "Synapse SQL — paste to create cost_by_workspace + cost_reconciliation_emf_vs_cur."
  value       = module.cost.cost_view_definitions
}

output "vnet_id" {
  value = module.network.vnet_id
}

output "aks_user_subnet_id" {
  description = "Subnet ID for the AKS user node pool that runs the triage agent."
  value       = module.network.aks_user_subnet_id
}

output "mcp_gateway_url" {
  description = "Effective frontend URL for the MCP gateway."
  value       = module.mcp.frontend_url
}

output "datadog_dashboard_url" {
  description = "Direct URL to the workspace's Datadog dashboard."
  value       = module.observability.dashboard_url
}

output "budget_action_group_id" {
  description = "Action Group ID driving every budget notification."
  value       = module.budgets.action_group_id
}

output "kill_switch_post_apply_steps" {
  description = "Steps the operator must run once to grant the Logic App Graph permissions."
  value       = module.budgets.kill_switch_post_apply_steps
}

output "identity_rbac_summary" {
  description = "Human-readable summary of provisioned RBAC."
  value       = module.identity.rbac_summary
}
