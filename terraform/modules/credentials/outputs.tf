output "application_object_id" {
  description = "AAD application object ID. Use for Microsoft Graph operations."
  value       = azuread_application.this.object_id
}

output "application_client_id" {
  description = "AAD application client ID — this is what the Kubernetes ServiceAccount must be annotated with (`azure.workload.identity/client-id`)."
  value       = azuread_application.this.client_id
}

output "service_principal_object_id" {
  description = "Service principal object ID. Use for role assignments."
  value       = azuread_service_principal.this.object_id
}

output "service_account_name" {
  description = "Echoed Kubernetes ServiceAccount name."
  value       = var.service_account
}

output "namespace" {
  description = "Echoed Kubernetes namespace."
  value       = var.namespace
}

output "anthropic_secret_name" {
  description = "Key Vault secret name for the Anthropic API key (only set if enable_anthropic = true)."
  value       = var.enable_anthropic ? azurerm_key_vault_secret.anthropic_key[0].name : null
}

output "azure_openai_secret_name" {
  description = "Key Vault secret name for the Azure OpenAI API key (only set if enable_azure_openai = true)."
  value       = var.enable_azure_openai ? azurerm_key_vault_secret.azure_openai_key[0].name : null
}

output "service_account_annotations" {
  description = "Suggested ServiceAccount + Pod annotations to enable Workload Identity. Copy into your Helm values or Kubernetes manifest."
  value = {
    "azure.workload.identity/client-id" = azuread_application.this.client_id
    "azure.workload.identity/tenant-id" = data.azurerm_client_config.current.tenant_id
    "azure.workload.identity/use"       = "true"
  }
}
