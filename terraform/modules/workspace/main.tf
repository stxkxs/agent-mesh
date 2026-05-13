/**
 * Workspace — the architectural spine.
 *
 * Creates the resource group + KMS-equivalent key material (Key Vault
 * with customer-managed keys for both data and logs) + Storage Account
 * with CMK encryption + Log Analytics workspace. Every other agent-mesh
 * module attaches to this Workspace via the IDs surfaced in outputs.
 *
 * Two CMKs per workspace:
 *   - data CMK: encrypts Storage (audit lake, skill bundles, results),
 *     Service Bus, Cosmos. Auditor role has NO decrypt permission.
 *   - logs CMK: encrypts Log Analytics + ADLS audit-log container only.
 *     Auditor role has decrypt permission on this key only.
 *
 * Purge protection is a one-way switch — once on, you cannot disable it
 * without re-creating the vault. We default to ON for iso27001-aligned +
 * hipaa-aware presets, OFF for standard (sandbox / iteration).
 */

data "azurerm_client_config" "current" {}

locals {
  preset_defaults = {
    standard = {
      log_retention_days       = 30
      purge_protection_enabled = false
      immutable_blob_versioning = false
    }
    iso27001-aligned = {
      log_retention_days       = 90
      purge_protection_enabled = true
      immutable_blob_versioning = true
    }
    hipaa-aware = {
      log_retention_days       = 365
      purge_protection_enabled = true
      immutable_blob_versioning = true
    }
  }

  preset = local.preset_defaults[var.compliance_preset]

  log_retention_days       = coalesce(var.log_retention_days, local.preset.log_retention_days)
  purge_protection_enabled = coalesce(var.purge_protection_enabled, local.preset.purge_protection_enabled)

  required_tags = {
    workspace      = var.workspace_name
    compliance     = var.compliance_preset
    data_residency = var.data_residency
    managed_by     = "agent-mesh"
  }
  tags = merge(local.required_tags, var.tags)

  # Storage account names: lowercase alphanumeric only, 3-24 chars.
  storage_account_name = substr(replace("am${var.workspace_name}", "-", ""), 0, 24)
}

# ─── Resource group ──────────────────────────────────────────────────────────

resource "azurerm_resource_group" "this" {
  name     = "rg-agent-mesh-${var.workspace_name}"
  location = var.location
  tags     = local.tags
}

# ─── Key Vault — holds CMKs + provider API key secrets ───────────────────────

resource "azurerm_key_vault" "this" {
  name                          = "kv-am-${substr(var.workspace_name, 0, 18)}"
  location                      = azurerm_resource_group.this.location
  resource_group_name           = azurerm_resource_group.this.name
  tenant_id                     = data.azurerm_client_config.current.tenant_id
  sku_name                      = "premium"
  enable_rbac_authorization     = true
  purge_protection_enabled      = local.purge_protection_enabled
  soft_delete_retention_days    = 90
  public_network_access_enabled = false
  network_acls {
    default_action = "Deny"
    bypass         = "AzureServices"
  }
  tags = local.tags
}

# Caller (Terraform principal) needs Crypto Officer to create + manage keys.
resource "azurerm_role_assignment" "kv_caller_crypto_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Crypto Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_role_assignment" "kv_caller_secrets_officer" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Secrets Officer"
  principal_id         = data.azurerm_client_config.current.object_id
}

resource "azurerm_key_vault_key" "data" {
  name         = "cmk-data"
  key_vault_id = azurerm_key_vault.this.id
  key_type     = "RSA"
  key_size     = 4096
  key_opts     = ["decrypt", "encrypt", "sign", "unwrapKey", "verify", "wrapKey"]
  rotation_policy {
    automatic {
      time_before_expiry = "P30D"
    }
    expire_after         = "P365D"
    notify_before_expiry = "P60D"
  }
  tags       = local.tags
  depends_on = [azurerm_role_assignment.kv_caller_crypto_officer]
}

resource "azurerm_key_vault_key" "logs" {
  name         = "cmk-logs"
  key_vault_id = azurerm_key_vault.this.id
  key_type     = "RSA"
  key_size     = 4096
  key_opts     = ["decrypt", "encrypt", "sign", "unwrapKey", "verify", "wrapKey"]
  rotation_policy {
    automatic {
      time_before_expiry = "P30D"
    }
    expire_after         = "P365D"
    notify_before_expiry = "P60D"
  }
  tags       = local.tags
  depends_on = [azurerm_role_assignment.kv_caller_crypto_officer]
}

# ─── Storage Account (audit + skill bundles + eval results) ──────────────────

resource "azurerm_user_assigned_identity" "storage" {
  name                = "id-storage-${var.workspace_name}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  tags                = local.tags
}

resource "azurerm_role_assignment" "storage_id_kv_crypto_user" {
  scope                = azurerm_key_vault.this.id
  role_definition_name = "Key Vault Crypto Service Encryption User"
  principal_id         = azurerm_user_assigned_identity.storage.principal_id
}

resource "azurerm_storage_account" "this" {
  name                            = local.storage_account_name
  resource_group_name             = azurerm_resource_group.this.name
  location                        = azurerm_resource_group.this.location
  account_tier                    = "Standard"
  account_replication_type        = var.compliance_preset == "hipaa-aware" ? "GZRS" : "ZRS"
  account_kind                    = "StorageV2"
  is_hns_enabled                  = true # ADLS Gen2
  min_tls_version                 = "TLS1_2"
  shared_access_key_enabled       = false
  public_network_access_enabled   = false
  allow_nested_items_to_be_public = false
  default_to_oauth_authentication = true

  identity {
    type         = "UserAssigned"
    identity_ids = [azurerm_user_assigned_identity.storage.id]
  }

  customer_managed_key {
    key_vault_key_id          = azurerm_key_vault_key.data.id
    user_assigned_identity_id = azurerm_user_assigned_identity.storage.id
  }

  blob_properties {
    versioning_enabled = local.preset.immutable_blob_versioning
    change_feed_enabled = local.preset.immutable_blob_versioning
    delete_retention_policy {
      days = 30
    }
    container_delete_retention_policy {
      days = 30
    }
  }

  network_rules {
    default_action = "Deny"
    bypass         = ["AzureServices", "Logging", "Metrics"]
  }

  tags       = local.tags
  depends_on = [azurerm_role_assignment.storage_id_kv_crypto_user]
}

# ─── Log Analytics (the workspace-scoped log sink) ───────────────────────────

resource "azurerm_log_analytics_workspace" "this" {
  name                = "log-agent-mesh-${var.workspace_name}"
  location            = azurerm_resource_group.this.location
  resource_group_name = azurerm_resource_group.this.name
  sku                 = "PerGB2018"
  retention_in_days   = local.log_retention_days
  daily_quota_gb      = -1
  tags                = local.tags
}
