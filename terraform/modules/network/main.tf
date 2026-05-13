/**
 * network — the VNet + subnet layout + Private Endpoints that lets
 * every other agent-mesh module run with `public_network_access_enabled
 * = false`.
 *
 * Subnet layout:
 *   - aks_system   /22  — system node pool (control-plane components)
 *   - aks_user     /22  — user workloads (agent runtime, MCP servers)
 *   - mcp          /22  — reserved for MCP gateway pool (separate from
 *                         general agent traffic for blast radius)
 *   - endpoints    /24  — Private Endpoints for KV / Storage / EH / Cosmos
 *   - firewall     /26  — Azure Firewall (if enabled). MUST be exactly /26.
 *   - bastion      /26  — Azure Bastion (if you add it later). MUST be /26.
 *   - appgateway   /24  — Application Gateway / WAF v2 frontend (M4)
 *
 * NSGs:
 *   - All subnets get a baseline NSG that denies internet inbound + allows
 *     intra-VNet. The `endpoints` subnet additionally denies all egress
 *     (PE connections are reachable only inbound from VNet sources).
 *
 * Azure Firewall is optional but recommended for iso27001-aligned +
 * hipaa-aware deployments — gives a stateful allow-list for outbound
 * traffic and DNS-based egress filtering.
 */

resource "azurerm_virtual_network" "this" {
  name                = "vnet-agent-mesh-${var.workspace_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  address_space       = [var.address_space]
  tags                = var.tags
}

locals {
  subnet_specs = {
    aks_system = {
      name              = "snet-aks-system"
      cidr              = var.subnets.aks_system
      service_endpoints = ["Microsoft.KeyVault", "Microsoft.Storage", "Microsoft.EventHub"]
    }
    aks_user = {
      name              = "snet-aks-user"
      cidr              = var.subnets.aks_user
      service_endpoints = ["Microsoft.KeyVault", "Microsoft.Storage", "Microsoft.EventHub", "Microsoft.AzureCosmosDB"]
    }
    mcp = {
      name              = "snet-mcp"
      cidr              = var.subnets.mcp
      service_endpoints = ["Microsoft.KeyVault", "Microsoft.Storage"]
    }
    endpoints = {
      name              = "snet-endpoints"
      cidr              = var.subnets.endpoints
      service_endpoints = []
    }
    appgateway = {
      name              = "snet-appgw"
      cidr              = var.subnets.appgateway
      service_endpoints = []
    }
  }
}

resource "azurerm_subnet" "this" {
  for_each             = local.subnet_specs
  name                 = each.value.name
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [each.value.cidr]
  service_endpoints    = each.value.service_endpoints
  # PE-only subnet must allow private-link policies.
  private_endpoint_network_policies = each.key == "endpoints" ? "Disabled" : "Enabled"
}

# Firewall subnet has a fixed name requirement.
resource "azurerm_subnet" "firewall" {
  count                = var.deploy_azure_firewall ? 1 : 0
  name                 = "AzureFirewallSubnet"
  resource_group_name  = var.resource_group_name
  virtual_network_name = azurerm_virtual_network.this.name
  address_prefixes     = [var.subnets.firewall]
}

# ─── Baseline NSG attached to every subnet ──────────────────────────────────

resource "azurerm_network_security_group" "baseline" {
  name                = "nsg-agent-mesh-${var.workspace_name}-baseline"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "AllowVnetInBound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "VirtualNetwork"
  }

  security_rule {
    name                       = "DenyInternetInBound"
    priority                   = 200
    direction                  = "Inbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "Internet"
    destination_address_prefix = "*"
  }

  security_rule {
    name                       = "AllowAzureLoadBalancerInBound"
    priority                   = 150
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "AzureLoadBalancer"
    destination_address_prefix = "*"
  }

  tags = var.tags
}

# Endpoint-subnet specific NSG: deny all egress (PEs answer inbound only).
resource "azurerm_network_security_group" "endpoints" {
  name                = "nsg-agent-mesh-${var.workspace_name}-endpoints"
  location            = var.location
  resource_group_name = var.resource_group_name

  security_rule {
    name                       = "AllowVnetInBound"
    priority                   = 100
    direction                  = "Inbound"
    access                     = "Allow"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "VirtualNetwork"
    destination_address_prefix = "VirtualNetwork"
  }

  security_rule {
    name                       = "DenyAllOutBound"
    priority                   = 100
    direction                  = "Outbound"
    access                     = "Deny"
    protocol                   = "*"
    source_port_range          = "*"
    destination_port_range     = "*"
    source_address_prefix      = "*"
    destination_address_prefix = "*"
  }

  tags = var.tags
}

resource "azurerm_subnet_network_security_group_association" "subnets" {
  for_each                  = { for k, v in local.subnet_specs : k => v if k != "endpoints" }
  subnet_id                 = azurerm_subnet.this[each.key].id
  network_security_group_id = azurerm_network_security_group.baseline.id
}

resource "azurerm_subnet_network_security_group_association" "endpoints" {
  subnet_id                 = azurerm_subnet.this["endpoints"].id
  network_security_group_id = azurerm_network_security_group.endpoints.id
}

# ─── Private Endpoints ──────────────────────────────────────────────────────

# Resolves the subresource name + DNS zone for a given Azure service.
locals {
  # Map subresource → privatelink DNS zone the customer should pair with the PE.
  # Callers pre-create the DNS zones in their hub VNet (typical pattern) or
  # set `private_dns_zone_id` per-PE if they manage zones here.
  private_dns_zones_per_subresource = {
    vault            = "privatelink.vaultcore.azure.net"
    blob             = "privatelink.blob.core.windows.net"
    dfs              = "privatelink.dfs.core.windows.net"
    namespace        = "privatelink.servicebus.windows.net"
    SQL              = "privatelink.documents.azure.com"
    "Sql"            = "privatelink.sql.azuresynapse.net"
    sqlOnDemand      = "privatelink.sql.azuresynapse.net"
    sqlServerlessSQL = "privatelink.sql.azuresynapse.net"
  }
}

resource "azurerm_private_endpoint" "this" {
  for_each            = var.private_endpoint_targets
  name                = "pe-${each.key}"
  location            = var.location
  resource_group_name = var.resource_group_name
  subnet_id           = azurerm_subnet.this["endpoints"].id

  private_service_connection {
    name                           = "psc-${each.key}"
    private_connection_resource_id = each.value
    is_manual_connection           = false
    subresource_names              = [var.private_endpoint_subresources[each.key]]
  }

  tags = var.tags
}

# ─── Azure Firewall (optional, recommended for stricter compliance) ─────────

resource "azurerm_public_ip" "firewall" {
  count               = var.deploy_azure_firewall ? 1 : 0
  name                = "pip-agent-mesh-${var.workspace_name}-afw"
  location            = var.location
  resource_group_name = var.resource_group_name
  allocation_method   = "Static"
  sku                 = "Standard"
  tags                = var.tags
}

resource "azurerm_firewall_policy" "this" {
  count               = var.deploy_azure_firewall ? 1 : 0
  name                = "afwp-agent-mesh-${var.workspace_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku                 = "Standard"

  dns {
    proxy_enabled = true
  }

  threat_intelligence_mode = "Alert"
  tags                     = var.tags
}

resource "azurerm_firewall_policy_rule_collection_group" "egress" {
  count              = var.deploy_azure_firewall ? 1 : 0
  name               = "egress"
  firewall_policy_id = azurerm_firewall_policy.this[0].id
  priority           = 500

  application_rule_collection {
    name     = "allow-llm-egress"
    priority = 100
    action   = "Allow"

    rule {
      name = "anthropic"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses  = [var.address_space]
      destination_fqdns = ["api.anthropic.com"]
    }

    rule {
      name = "azure-openai"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses      = [var.address_space]
      destination_fqdn_tags = ["AzureCognitiveServices"]
    }

    rule {
      name = "datadog-ingest"
      protocols {
        type = "Https"
        port = 443
      }
      source_addresses = [var.address_space]
      destination_fqdns = [
        "api.datadoghq.com",
        "*.agent.datadoghq.com",
        "*.logs.datadoghq.com",
        "trace.agent.datadoghq.com",
      ]
    }
  }
}

resource "azurerm_firewall" "this" {
  count               = var.deploy_azure_firewall ? 1 : 0
  name                = "afw-agent-mesh-${var.workspace_name}"
  location            = var.location
  resource_group_name = var.resource_group_name
  sku_name            = "AZFW_VNet"
  sku_tier            = "Standard"
  firewall_policy_id  = azurerm_firewall_policy.this[0].id

  ip_configuration {
    name                 = "configuration"
    subnet_id            = azurerm_subnet.firewall[0].id
    public_ip_address_id = azurerm_public_ip.firewall[0].id
  }

  tags = var.tags
}
