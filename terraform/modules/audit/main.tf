/**
 * audit — the data plane for every CallEvent the platform emits.
 *
 * Flow:
 *   Agent pod  →  OTLP log line  →  OTel Collector  →  (forks)
 *      ↳ Datadog Logs (operator pane of glass)
 *      ↳ Event Hubs (audit capture path)
 *           ↳ Capture-to-Blob writes Avro files into the audit container
 *             at yyyy/mm/dd/hh/<eh>-<partition>-<offset>.avro
 *           ↳ Synapse Serverless workspace exposes a SQL endpoint over the
 *             container; analysts run `token_spend_by_workspace` style
 *             queries against external tables.
 *
 * Why Event Hubs + Capture (vs. direct OTel→Blob exporter): Event Hubs
 * Capture is a managed, idempotent, schema-enforcing write path with
 * built-in partitioning. The OTel direct-to-Blob exporter is not
 * partition-aware and gives you a single hot-blob write pattern.
 *
 * Why Synapse Serverless over Fabric (today): Synapse has full AzureRM
 * coverage + zero fixed cost; Fabric's Terraform support is preview-ish.
 * See ADR-0005.
 */

resource "random_string" "namespace_suffix" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

# ─── Event Hubs namespace + audit hub ────────────────────────────────────────

resource "azurerm_eventhub_namespace" "this" {
  name                          = "ehns-agent-mesh-${var.workspace_name}-${random_string.namespace_suffix.result}"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  sku                           = var.compliance_preset == "hipaa-aware" ? "Premium" : "Standard"
  capacity                      = 1
  auto_inflate_enabled          = true
  maximum_throughput_units      = var.compliance_preset == "hipaa-aware" ? 0 : 10
  public_network_access_enabled = false
  minimum_tls_version           = "1.2"
  local_authentication_enabled  = false
  tags                          = var.tags
}

resource "azurerm_eventhub" "audit" {
  name              = "audit"
  namespace_id      = azurerm_eventhub_namespace.this.id
  partition_count   = var.event_hub_partition_count
  message_retention = var.compliance_preset == "hipaa-aware" ? 7 : 1
  status            = "Active"

  capture_description {
    enabled             = true
    encoding            = "Avro"
    interval_in_seconds = var.capture_interval_seconds
    size_limit_in_bytes = var.capture_size_bytes
    skip_empty_archives = true

    destination {
      name                = "EventHubArchive.AzureBlockBlob"
      archive_name_format = "{Namespace}/{EventHub}/{Year}/{Month}/{Day}/{Hour}/{Minute}/{Second}-{PartitionId}-{Second}"
      blob_container_name = azurerm_storage_container.audit.name
      storage_account_id  = var.storage_account_id
    }
  }
}

# ─── Audit blob container — receives the captured Avro files ─────────────────

resource "azurerm_storage_container" "audit" {
  name                  = "audit"
  storage_account_id    = var.storage_account_id
  container_access_type = "private"
}

# Workspace-CMK-encrypted via the parent Storage Account already (workspace
# module sets account-level CMK). Object Lock / immutability policy is
# attached separately for iso27001-aligned + hipaa-aware presets.
resource "azurerm_storage_container_immutability_policy" "audit" {
  count                                 = var.compliance_preset == "standard" ? 0 : 1
  storage_container_resource_manager_id = azurerm_storage_container.audit.id
  immutability_period_in_days           = var.compliance_preset == "hipaa-aware" ? 2555 : 90 # 7y vs 90d
  protected_append_writes_all_enabled   = true
}

# ─── Synapse Serverless — SQL over the captured Avro ─────────────────────────

resource "azurerm_synapse_workspace" "this" {
  count                                = var.deploy_synapse ? 1 : 0
  name                                 = "syn-agent-mesh-${var.workspace_name}"
  resource_group_name                  = var.resource_group_name
  location                             = var.location
  storage_data_lake_gen2_filesystem_id = azurerm_storage_data_lake_gen2_filesystem.synapse[0].id
  sql_administrator_login              = "synadmin"
  sql_administrator_login_password     = random_string.synapse_sql_admin_password[0].result
  public_network_access_enabled        = false
  managed_virtual_network_enabled      = true

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# Synapse needs a dedicated ADLS Gen2 filesystem for workspace metadata.
resource "azurerm_storage_data_lake_gen2_filesystem" "synapse" {
  count              = var.deploy_synapse ? 1 : 0
  name               = "synapseworkspace"
  storage_account_id = var.storage_account_id
}

resource "random_string" "synapse_sql_admin_password" {
  count   = var.deploy_synapse ? 1 : 0
  length  = 32
  special = true
  upper   = true
  lower   = true
  numeric = true
  # SQL passwords have restricted special-char set
  override_special = "!@#$%^&*()-_"
}

# Grant the Synapse workspace identity Storage Blob Data Reader on the
# audit container so the serverless pool can query the captured files.
resource "azurerm_role_assignment" "synapse_storage_blob_reader" {
  count                = var.deploy_synapse ? 1 : 0
  scope                = var.storage_account_id
  role_definition_name = "Storage Blob Data Reader"
  principal_id         = azurerm_synapse_workspace.this[0].identity[0].principal_id
}
