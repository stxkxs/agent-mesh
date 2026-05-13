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
