output "application_gateway_id" {
  description = "Application Gateway resource ID."
  value       = azurerm_application_gateway.this.id
}

output "public_ip" {
  description = "Public IP address (Standard SKU, static)."
  value       = azurerm_public_ip.this.ip_address
}

output "public_fqdn" {
  description = "Azure-vended FQDN for the public IP."
  value       = azurerm_public_ip.this.fqdn
}

output "frontend_url" {
  description = "Effective frontend URL. Uses var.frontend_dns_name if provided; otherwise the Azure-vended public IP FQDN."
  value       = "http${var.tls_certificate_secret_id == null ? "" : "s"}://${coalesce(var.frontend_dns_name, azurerm_public_ip.this.fqdn)}"
}

output "appgw_identity_principal_id" {
  description = "Application Gateway's user-assigned identity principal ID. Used to grant additional KV access if you add more cert secrets later."
  value       = azurerm_user_assigned_identity.appgw.principal_id
}

output "waf_policy_id" {
  description = "WAF v2 policy ID. Override the policy directly to add custom rules or exclusions."
  value       = azurerm_web_application_firewall_policy.this.id
}

output "deployment_warnings" {
  description = "Warnings emitted by configuration choices that operators should be aware of."
  value = compact([
    var.tls_certificate_secret_id == null ? "[mcp] No TLS certificate configured — gateway is HTTP-only. Sandbox use only. Set tls_certificate_secret_id for production." : "",
    var.frontend_dns_name == null ? "[mcp] No frontend_dns_name set — SNI is disabled and requests must target the public IP directly. Production deployments should bind a real hostname." : "",
    length(var.backend_fqdns) == 0 ? "[mcp] No backend_fqdns supplied — the gateway has no backends and will return 502 for every request. Add backends or deploy charts/mcp-server first." : "",
  ])
}
