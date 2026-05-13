/**
 * mcp — MCP gateway based on Azure Application Gateway v2 + WAF v2.
 *
 * Sits in front of N MCP servers running on AKS in the dedicated `mcp`
 * subnet. Provides:
 *   - TLS 1.2/1.3 termination (when tls_certificate_secret_id is set)
 *   - WAF v2 with OWASP CRS 3.2 + bot protection in Prevention mode
 *   - Path-based routing to per-server backend pools
 *   - Health probes per backend
 *   - HTTP→HTTPS redirect (when TLS is configured)
 *
 * The MCP servers themselves are deployed via `charts/mcp-server`.
 *
 * Sandbox path: pass `tls_certificate_secret_id = null` and the gateway
 * deploys HTTP-only. The synth banner warns about this. Production MUST
 * provide a cert in Key Vault and a frontend DNS name.
 */

# ─── Public IP for the AG frontend ──────────────────────────────────────────

resource "azurerm_public_ip" "this" {
  name                = "pip-mcp-${var.workspace_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  domain_name_label   = "mcp-${var.workspace_name}"
  tags                = var.tags
}

# ─── User-assigned identity (used to pull TLS cert from Key Vault) ──────────

resource "azurerm_user_assigned_identity" "appgw" {
  name                = "id-mcp-appgw-${var.workspace_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags
}

resource "azurerm_role_assignment" "appgw_kv_secrets_user" {
  count                = var.tls_certificate_secret_id == null ? 0 : 1
  scope                = var.key_vault_id
  role_definition_name = "Key Vault Secrets User"
  principal_id         = azurerm_user_assigned_identity.appgw.principal_id
}

# ─── WAF Policy ──────────────────────────────────────────────────────────────

resource "azurerm_web_application_firewall_policy" "this" {
  name                = "wafpol-mcp-${var.workspace_name}"
  resource_group_name = var.resource_group_name
  location            = var.location

  policy_settings {
    enabled                     = true
    mode                        = var.waf_mode
    request_body_check          = true
    file_upload_limit_in_mb     = 100
    max_request_body_size_in_kb = 128
  }

  managed_rules {
    managed_rule_set {
      type    = "OWASP"
      version = "3.2"
    }
    managed_rule_set {
      type    = "Microsoft_BotManagerRuleSet"
      version = "1.0"
    }
  }

  tags = var.tags
}

# ─── Application Gateway ─────────────────────────────────────────────────────

locals {
  use_tls = var.tls_certificate_secret_id != null
}

resource "azurerm_application_gateway" "this" {
  name                = "appgw-mcp-${var.workspace_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  tags                = var.tags

  sku {
    name = "WAF_v2"
    tier = "WAF_v2"
  }

  autoscale_configuration {
    min_capacity = var.capacity
    max_capacity = var.max_capacity
  }

  firewall_policy_id = azurerm_web_application_firewall_policy.this.id

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.appgw.id]
  }

  gateway_ip_configuration {
    name      = "appgw-ipconfig"
    subnet_id = var.appgateway_subnet_id
  }

  frontend_ip_configuration {
    name                 = "frontend-public"
    public_ip_address_id = azurerm_public_ip.this.id
  }

  frontend_port {
    name = "port-80"
    port = 80
  }

  dynamic "frontend_port" {
    for_each = local.use_tls ? [1] : []
    content {
      name = "port-443"
      port = 443
    }
  }

  dynamic "ssl_certificate" {
    for_each = local.use_tls ? [1] : []
    content {
      name                = "mcp-cert"
      key_vault_secret_id = var.tls_certificate_secret_id
    }
  }

  # One backend pool per backend FQDN entry
  dynamic "backend_address_pool" {
    for_each = var.backend_fqdns
    content {
      name  = "pool-${backend_address_pool.key}"
      fqdns = [backend_address_pool.value]
    }
  }

  dynamic "backend_http_settings" {
    for_each = var.backend_fqdns
    content {
      name                                = "settings-${backend_http_settings.key}"
      cookie_based_affinity               = "Disabled"
      port                                = 8080
      protocol                            = "Http"
      request_timeout                     = 60
      pick_host_name_from_backend_address = true
      probe_name                          = "probe-${backend_http_settings.key}"
    }
  }

  dynamic "probe" {
    for_each = var.backend_fqdns
    content {
      name                                      = "probe-${probe.key}"
      protocol                                  = "Http"
      pick_host_name_from_backend_http_settings = true
      path                                      = "/healthz"
      interval                                  = 30
      timeout                                   = 10
      unhealthy_threshold                       = 3
      match {
        status_code = ["200-299"]
      }
    }
  }

  http_listener {
    name                           = local.use_tls ? "listener-http" : "listener-mcp"
    frontend_ip_configuration_name = "frontend-public"
    frontend_port_name             = "port-80"
    protocol                       = "Http"
    host_name                      = var.frontend_dns_name
    require_sni                    = false
  }

  dynamic "http_listener" {
    for_each = local.use_tls ? [1] : []
    content {
      name                           = "listener-https"
      frontend_ip_configuration_name = "frontend-public"
      frontend_port_name             = "port-443"
      protocol                       = "Https"
      ssl_certificate_name           = "mcp-cert"
      host_name                      = var.frontend_dns_name
      require_sni                    = var.frontend_dns_name != null
    }
  }

  # When TLS is configured, port 80 redirects to port 443.
  dynamic "redirect_configuration" {
    for_each = local.use_tls ? [1] : []
    content {
      name                 = "http-to-https"
      redirect_type        = "Permanent"
      target_listener_name = "listener-https"
      include_path         = true
      include_query_string = true
    }
  }

  # URL path map — when TLS off, routes to first backend by default.
  # In production, you'd extend this to path-route per MCP backend (e.g.
  # /filesystem/* → filesystem-readonly pool).
  dynamic "url_path_map" {
    for_each = length(var.backend_fqdns) > 0 ? [1] : []
    content {
      name                               = "main-path-map"
      default_backend_address_pool_name  = "pool-${keys(var.backend_fqdns)[0]}"
      default_backend_http_settings_name = "settings-${keys(var.backend_fqdns)[0]}"

      dynamic "path_rule" {
        for_each = var.backend_fqdns
        content {
          name                       = "rule-${path_rule.key}"
          paths                      = ["/${path_rule.key}/*"]
          backend_address_pool_name  = "pool-${path_rule.key}"
          backend_http_settings_name = "settings-${path_rule.key}"
        }
      }
    }
  }

  request_routing_rule {
    name      = "rule-mcp"
    rule_type = local.use_tls ? "Basic" : (length(var.backend_fqdns) > 0 ? "PathBasedRouting" : "Basic")
    priority  = 100

    http_listener_name = local.use_tls ? "listener-http" : (length(var.backend_fqdns) > 0 ? "listener-mcp" : "listener-mcp")

    # When TLS: HTTP listener redirects to HTTPS via the redirect config above.
    # When no TLS: HTTP listener uses the URL path map.
    redirect_configuration_name = local.use_tls ? "http-to-https" : null
    url_path_map_name           = local.use_tls ? null : (length(var.backend_fqdns) > 0 ? "main-path-map" : null)
    backend_address_pool_name   = local.use_tls || length(var.backend_fqdns) == 0 ? null : null
    backend_http_settings_name  = local.use_tls || length(var.backend_fqdns) == 0 ? null : null
  }

  dynamic "request_routing_rule" {
    for_each = local.use_tls ? [1] : []
    content {
      name               = "rule-mcp-https"
      rule_type          = length(var.backend_fqdns) > 0 ? "PathBasedRouting" : "Basic"
      priority           = 200
      http_listener_name = "listener-https"
      url_path_map_name  = length(var.backend_fqdns) > 0 ? "main-path-map" : null
    }
  }

  ssl_policy {
    policy_type          = "Predefined"
    policy_name          = "AppGwSslPolicy20220101"
    min_protocol_version = "TLSv1_2"
  }

  depends_on = [azurerm_role_assignment.appgw_kv_secrets_user]
}
