output "workspace_name" {
  description = "Echoed workspace name. Use as a stable identifier across modules."
  value       = var.workspace_name
}

output "resource_group_name" {
  description = "Resource group that holds every workspace resource."
  value       = azurerm_resource_group.this.name
}

output "resource_group_id" {
  description = "Resource group ID — handed to downstream modules for scope-binding role assignments."
  value       = azurerm_resource_group.this.id
}

output "location" {
  description = "Azure region."
  value       = azurerm_resource_group.this.location
}

output "key_vault_id" {
  description = "Key Vault resource ID. Other modules reference this for secret/key access."
  value       = azurerm_key_vault.this.id
}

output "key_vault_uri" {
  description = "Key Vault DNS URI (`https://<name>.vault.azure.net/`)."
  value       = azurerm_key_vault.this.vault_uri
}

output "cmk_data_id" {
  description = "Key Vault Key resource ID for the data CMK. Used by Storage, Service Bus, Cosmos."
  value       = azurerm_key_vault_key.data.id
}

output "cmk_logs_id" {
  description = "Key Vault Key resource ID for the logs CMK. Used by Log Analytics + audit log container. Auditor role has decrypt on this key only."
  value       = azurerm_key_vault_key.logs.id
}

output "storage_account_id" {
  description = "Storage Account resource ID (ADLS Gen2)."
  value       = azurerm_storage_account.this.id
}

output "storage_account_name" {
  description = "Storage Account name."
  value       = azurerm_storage_account.this.name
}

output "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID for diagnostic-setting targets."
  value       = azurerm_log_analytics_workspace.this.id
}

output "log_analytics_workspace_customer_id" {
  description = "Log Analytics workspace customer ID (UUID, distinct from the resource ID)."
  value       = azurerm_log_analytics_workspace.this.workspace_id
}

output "tenant_id" {
  description = "Azure AD tenant ID."
  value       = data.azurerm_client_config.current.tenant_id
}

output "tags" {
  description = "Merged workspace tags — apply to every resource downstream modules create."
  value       = local.tags
}

output "compliance_preset" {
  description = "Echoed compliance preset (`standard` / `iso27001-aligned` / `hipaa-aware`). Drives downstream module defaults."
  value       = var.compliance_preset
}

output "data_residency_notice" {
  description = "Plain-language notice surfaced on every deploy: where Claude / Azure OpenAI traffic terminates. Audit checks expect this in deploy logs."
  value       = "Workspace ${var.workspace_name} declares data_residency=${var.data_residency} under compliance=${var.compliance_preset}. Model traffic terminates outside the AKS cluster; consult docs/compliance/SUBPROCESSOR-NOTE.md before processing regulated data."
}
