output "vnet_id" {
  description = "Virtual network resource ID. Pass to downstream modules (AKS, App Gateway, Bastion)."
  value       = azurerm_virtual_network.this.id
}

output "vnet_name" {
  description = "Virtual network name."
  value       = azurerm_virtual_network.this.name
}

output "subnet_ids" {
  description = "Map of subnet labels to resource IDs. Keys: aks_system, aks_user, mcp, endpoints, appgateway."
  value       = { for k, v in azurerm_subnet.this : k => v.id }
}

output "endpoints_subnet_id" {
  description = "Convenience accessor for the Private Endpoints subnet."
  value       = azurerm_subnet.this["endpoints"].id
}

output "aks_user_subnet_id" {
  description = "Convenience accessor for the AKS user node-pool subnet."
  value       = azurerm_subnet.this["aks_user"].id
}

output "mcp_subnet_id" {
  description = "Convenience accessor for the MCP gateway pool subnet."
  value       = azurerm_subnet.this["mcp"].id
}

output "appgateway_subnet_id" {
  description = "Convenience accessor for the Application Gateway / WAF v2 subnet."
  value       = azurerm_subnet.this["appgateway"].id
}

output "firewall_id" {
  description = "Azure Firewall resource ID, or null if disabled."
  value       = var.deploy_azure_firewall ? azurerm_firewall.this[0].id : null
}

output "firewall_private_ip" {
  description = "Internal IP of the Azure Firewall, for use in UDRs from the AKS subnets. Null if disabled."
  value       = var.deploy_azure_firewall ? azurerm_firewall.this[0].ip_configuration[0].private_ip_address : null
}

output "private_endpoint_ids" {
  description = "Map of label -> Private Endpoint resource ID for everything passed in `private_endpoint_targets`."
  value       = { for k, v in azurerm_private_endpoint.this : k => v.id }
}
