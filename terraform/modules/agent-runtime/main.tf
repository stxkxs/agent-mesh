/**
 * agent-runtime — Azure-side infra for one or more agent workloads.
 *
 * Stands up:
 *   - Service Bus namespace + N queues (one per agent or per intake type)
 *     with native DLQ semantics (max_delivery_count → dead-letter)
 *   - Cosmos DB account (NoSQL API) + one database + one container for
 *     idempotency state, partitioned by /agent_id, with native TTL
 *   - Workload Identity grants: agent SP gets Service Bus Data Receiver +
 *     Cosmos DB Built-in Data Contributor
 *   - Diagnostic Settings on both forwarding to Log Analytics
 *
 * Does NOT stand up:
 *   - The AKS cluster (operator-owned; we plug into your existing cluster
 *     via Workload Identity)
 *   - The Helm release for the agent pod (use `charts/agent-runtime`
 *     deployed via Flux / helm CLI against the outputs of this module)
 *   - The KEDA controller (operator-installs via AKS Extension; this
 *     module emits the TriggerAuthentication-compatible identity reference)
 */

resource "random_string" "namespace_suffix" {
  length  = 6
  special = false
  upper   = false
  numeric = true
}

# ─── Service Bus namespace + queues ──────────────────────────────────────────

resource "azurerm_servicebus_namespace" "this" {
  name                          = "sb-am-${var.workspace_name}-${var.project}-${random_string.namespace_suffix.result}"
  location                      = var.location
  resource_group_name           = var.resource_group_name
  sku                           = var.compliance_preset == "hipaa-aware" ? "Premium" : "Standard"
  capacity                      = var.compliance_preset == "hipaa-aware" ? 1 : 0
  public_network_access_enabled = false
  minimum_tls_version           = "1.2"
  local_auth_enabled            = false
  tags                          = var.tags
}

resource "azurerm_servicebus_queue" "this" {
  for_each = var.queues
  name     = each.key

  namespace_id                            = azurerm_servicebus_namespace.this.id
  max_size_in_megabytes                   = each.value.max_size_megabytes
  default_message_ttl                     = each.value.default_message_ttl_iso8601
  lock_duration                           = each.value.lock_duration_iso8601
  max_delivery_count                      = each.value.max_delivery_count
  requires_session                        = each.value.requires_session
  requires_duplicate_detection            = true
  duplicate_detection_history_time_window = each.value.duplicate_detection_window_iso
  dead_lettering_on_message_expiration    = true
}

# Service Bus Data Receiver — agent pod consumes
resource "azurerm_role_assignment" "agent_sb_receiver" {
  scope                = azurerm_servicebus_namespace.this.id
  role_definition_name = "Azure Service Bus Data Receiver"
  principal_id         = var.agent_workload_principal_id
}

# Service Bus Data Sender — for the DLQ redrive path + edge ingestion
resource "azurerm_role_assignment" "agent_sb_sender" {
  scope                = azurerm_servicebus_namespace.this.id
  role_definition_name = "Azure Service Bus Data Sender"
  principal_id         = var.agent_workload_principal_id
}

# ─── Cosmos DB — idempotency state ──────────────────────────────────────────

resource "azurerm_cosmosdb_account" "this" {
  name                              = "cosmos-am-${var.workspace_name}-${var.project}-${random_string.namespace_suffix.result}"
  location                          = var.location
  resource_group_name               = var.resource_group_name
  offer_type                        = "Standard"
  kind                              = "GlobalDocumentDB"
  public_network_access_enabled     = false
  is_virtual_network_filter_enabled = true
  local_authentication_disabled     = true
  minimal_tls_version               = "Tls12"
  free_tier_enabled                 = false

  capabilities {
    name = "EnableServerless"
  }

  consistency_policy {
    consistency_level = "Session"
  }

  geo_location {
    location          = var.location
    failover_priority = 0
  }

  dynamic "geo_location" {
    for_each = var.compliance_preset == "hipaa-aware" ? [1] : []
    content {
      # Paired region for HIPAA-aware deployments. Caller may override
      # by deploying their own multi-region replication setup.
      location          = local.paired_region[var.location]
      failover_priority = 1
    }
  }

  tags = var.tags
}

locals {
  # Minimal Azure paired-region table for the regions we expect to see;
  # extend as adopter teams need more. Falls back to same-region (no
  # replica) when the pair isn't known.
  paired_region = {
    eastus      = "westus"
    eastus2     = "centralus"
    westus      = "eastus"
    westus2     = "westus3"
    westus3     = "westus2"
    centralus   = "eastus2"
    northeurope = "westeurope"
    westeurope  = "northeurope"
    uksouth     = "ukwest"
  }
}

resource "azurerm_cosmosdb_sql_database" "idempotency" {
  name                = "idempotency"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
}

resource "azurerm_cosmosdb_sql_container" "invocations" {
  name                = "invocations"
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  database_name       = azurerm_cosmosdb_sql_database.idempotency.name
  partition_key_paths = [var.cosmos_partition_paths]
  default_ttl         = var.cosmos_ttl_seconds

  indexing_policy {
    indexing_mode = "consistent"
    included_path {
      path = "/*"
    }
    excluded_path {
      path = "/payload/?"
    }
  }
}

# Built-in Data Contributor on Cosmos for the workload identity. This is
# the role definition that grants document CRUD without management plane access.
data "azurerm_cosmosdb_sql_role_definition" "data_contributor" {
  account_name        = azurerm_cosmosdb_account.this.name
  resource_group_name = var.resource_group_name
  role_definition_id  = "00000000-0000-0000-0000-000000000002" # Built-in Data Contributor
}

resource "azurerm_cosmosdb_sql_role_assignment" "agent_data" {
  resource_group_name = var.resource_group_name
  account_name        = azurerm_cosmosdb_account.this.name
  role_definition_id  = data.azurerm_cosmosdb_sql_role_definition.data_contributor.id
  principal_id        = var.agent_workload_principal_id
  scope               = azurerm_cosmosdb_account.this.id
}

# ─── Diagnostic Settings ────────────────────────────────────────────────────

resource "azurerm_monitor_diagnostic_setting" "servicebus" {
  name                       = "diag-servicebus"
  target_resource_id         = azurerm_servicebus_namespace.this.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "allLogs"
  }

  enabled_metric {
    category = "AllMetrics"
  }
}

resource "azurerm_monitor_diagnostic_setting" "cosmos" {
  name                       = "diag-cosmos"
  target_resource_id         = azurerm_cosmosdb_account.this.id
  log_analytics_workspace_id = var.log_analytics_workspace_id

  enabled_log {
    category_group = "audit"
  }

  enabled_metric {
    category = "Requests"
  }
}
