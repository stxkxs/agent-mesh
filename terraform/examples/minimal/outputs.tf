output "data_residency_notice" {
  description = "Plain-language data-residency notice — echoed on every plan/apply for auditor visibility."
  value       = module.workspace.data_residency_notice
}

output "resource_group_name" {
  value = module.workspace.resource_group_name
}

output "key_vault_uri" {
  value = module.workspace.key_vault_uri
}

output "storage_account_name" {
  value = module.workspace.storage_account_name
}

output "log_analytics_workspace_id" {
  value = module.workspace.log_analytics_workspace_id
}

output "workload_identity_client_id" {
  description = "Client ID for the workload's AAD application. Annotate your Kubernetes ServiceAccount with this via `azure.workload.identity/client-id`."
  value       = module.credentials.application_client_id
}

output "service_account_annotations" {
  description = "Drop these annotations onto your ServiceAccount + Pod template."
  value       = module.credentials.service_account_annotations
}

output "anthropic_secret_name" {
  value = module.credentials.anthropic_secret_name
}

output "azure_openai_secret_name" {
  value = module.credentials.azure_openai_secret_name
}

output "audit_event_hubs_namespace" {
  description = "Event Hubs namespace FQDN. Use as `<hostname>` in OTel Collector exporter config."
  value       = var.deploy_audit ? module.audit[0].event_hubs_namespace_hostname : null
}

output "audit_synapse_sql_endpoint" {
  description = "Synapse Serverless SQL endpoint for ad-hoc audit queries."
  value       = var.deploy_audit ? module.audit[0].synapse_serverless_sql_endpoint : null
}

output "vnet_id" {
  description = "Virtual network resource ID, if `deploy_network = true`."
  value       = var.deploy_network ? module.network[0].vnet_id : null
}

output "aks_subnet_id" {
  description = "Suggested subnet for AKS user node pool, if `deploy_network = true`."
  value       = var.deploy_network ? module.network[0].aks_user_subnet_id : null
}

output "identity_groups" {
  description = "Map of agent-mesh role to AAD group object ID, if `deploy_identity = true`."
  value       = var.deploy_identity ? module.identity[0].group_ids : null
}

output "identity_rbac_summary" {
  description = "Human-readable summary of provisioned RBAC."
  value       = var.deploy_identity ? module.identity[0].rbac_summary : null
}

output "datadog_dashboard_url" {
  description = "Datadog dashboard URL, if `deploy_observability = true`."
  value       = var.deploy_observability ? module.observability[0].dashboard_url : null
}

output "budget_action_group_id" {
  description = "Action Group ID for the workspace budget — drives every notification."
  value       = var.deploy_budgets ? module.budgets[0].action_group_id : null
}

output "kill_switch_logic_app_id" {
  description = "Kill-switch Logic App resource ID."
  value       = var.deploy_budgets ? module.budgets[0].kill_switch_logic_app_id : null
}

output "kill_switch_post_apply_steps" {
  description = "Steps to grant the Logic App's managed identity Microsoft Graph permissions to delete federated credentials. **Operator must run these once** before the kill-switch can fire."
  value       = var.deploy_budgets ? module.budgets[0].kill_switch_post_apply_steps : null
}

output "cost_export_container_url" {
  description = "ADLS container URL receiving daily Cost Management Export parquet files."
  value       = var.deploy_cost ? module.cost[0].cost_exports_container_url : null
}

output "cost_view_definitions" {
  description = "Synapse SQL — paste into the audit module's SQL endpoint to create cost views over the export."
  value       = var.deploy_cost ? module.cost[0].cost_view_definitions : null
}

output "agent_runtime_servicebus_namespace" {
  description = "Service Bus namespace FQDN. Pass to charts/agent-runtime --set servicebus.namespace."
  value       = var.deploy_agent_runtime ? module.agent_runtime[0].servicebus_namespace_hostname : null
}

output "agent_runtime_cosmos_endpoint" {
  description = "Cosmos DB endpoint. Pass to charts/agent-runtime --set cosmos.endpoint."
  value       = var.deploy_agent_runtime ? module.agent_runtime[0].cosmos_endpoint : null
}

output "agent_runtime_keda_snippet" {
  description = "KEDA TriggerAuthentication + ScaledObject snippet — paste into your cluster (or use charts/agent-runtime which templates this automatically)."
  value       = var.deploy_agent_runtime ? module.agent_runtime[0].keda_trigger_auth_snippet : null
}

output "mcp_gateway_url" {
  description = "Effective frontend URL for the MCP gateway."
  value       = var.deploy_mcp_gateway && var.deploy_network ? module.mcp[0].frontend_url : null
}

output "mcp_gateway_public_ip" {
  description = "Public IP of the MCP gateway. Wire your DNS to this address."
  value       = var.deploy_mcp_gateway && var.deploy_network ? module.mcp[0].public_ip : null
}

output "mcp_gateway_warnings" {
  description = "Configuration warnings from the MCP gateway (HTTP-only, missing DNS name, no backends)."
  value       = var.deploy_mcp_gateway && var.deploy_network ? module.mcp[0].deployment_warnings : null
}
