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
