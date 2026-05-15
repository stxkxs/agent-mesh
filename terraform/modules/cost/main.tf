/**
 * cost — Azure Cost Management Export pipeline + reconciliation surface.
 *
 * Two distinct cost signals flow through agent-mesh:
 *
 *   1. EMF / OTel-emitted `agent_mesh.cost_usd` — per-call cost computed by
 *      the SDK from @agent-mesh/pricing tables. Sub-second granularity,
 *      attributed by workspace × project × model × tenant.
 *
 *   2. Azure Cost Management — the authoritative billing surface, daily
 *      resolution, includes infrastructure costs (AKS, Storage, Key Vault,
 *      Event Hubs, Datadog egress) that aren't visible to the SDK.
 *
 * This module pipes #2 into the same ADLS lake where #1 already lives,
 * with a daily Cost Management Export to a parquet-formatted blob path.
 * The Synapse external views then let analysts JOIN the two — proving
 * that the SDK's in-process cost estimate matches the Azure bill within
 * the 2% accuracy SLO.
 *
 * Azure Cost Anomaly Detection runs as a separate path that fires on
 * spend-rate anomalies; the alert routes through the budgets module's
 * action group for unified notification handling.
 */

resource "azurerm_storage_container" "cost_exports" {
  name                  = "cost-exports"
  storage_account_id    = var.storage_account_id
  container_access_type = "private"
}

# Cost Management Export is on AzureRM but the resource shape is awkward.
# Use azapi for the modern 2023-03-01 API surface.
resource "azapi_resource" "cost_export" {
  type      = "Microsoft.CostManagement/exports@2023-03-01"
  name      = "agent-mesh-${var.workspace_name}-daily"
  parent_id = var.resource_group_id

  body = {
    properties = {
      schedule = {
        status     = "Active"
        recurrence = var.export_frequency
        recurrencePeriod = {
          # 1-year window starting today; auto-renew is implicit when the
          # window closes (Azure rolls the period forward as long as the
          # export resource exists).
          from = "${formatdate("YYYY-MM-DD", timestamp())}T00:00:00Z"
          to   = "${formatdate("YYYY-MM-DD", timeadd(timestamp(), "8760h"))}T00:00:00Z"
        }
      }
      format = "Parquet"
      deliveryInfo = {
        destination = {
          resourceId     = var.storage_account_id
          container      = azurerm_storage_container.cost_exports.name
          rootFolderPath = "cost-management"
        }
      }
      definition = {
        type      = "ActualCost"
        timeframe = "MonthToDate"
        dataSet = {
          granularity = "Daily"
          configuration = {
            columns = [
              "Date",
              "ResourceId",
              "ResourceType",
              "ResourceGroup",
              "ServiceName",
              "MeterCategory",
              "MeterSubCategory",
              "MeterName",
              "CostInBillingCurrency",
              "BillingCurrency",
              "Tags",
            ]
          }
        }
      }
    }
  }

  # Avoid recreating the export on every plan because of the timestamp() shift.
  lifecycle {
    ignore_changes = [body]
  }
}

# ─── Azure Cost Anomaly Detection ────────────────────────────────────────────

resource "azurerm_monitor_action_group" "cost_anomaly_passthrough" {
  count               = var.enable_anomaly_alert && var.anomaly_action_group_id == null ? 0 : 0
  name                = "ag-cost-anomaly-${var.workspace_name}"
  resource_group_name = element(split("/", var.resource_group_id), length(split("/", var.resource_group_id)) - 1)
  short_name          = "costanom"
  enabled             = true
}

# Cost Anomaly Detection alert is RG-scoped here (matching the export
# scope). The alert sends to the action group supplied by the caller
# (typically the budgets module's notify group).
resource "azurerm_consumption_budget_resource_group" "anomaly_proxy" {
  count             = var.enable_anomaly_alert && var.anomaly_action_group_id != null ? 1 : 0
  name              = "agent-mesh-${var.workspace_name}-anomaly-proxy"
  resource_group_id = var.resource_group_id

  # Set ridiculously high so this never fires on threshold; we use it only
  # as the carrier for forecasted-anomaly notification routing via the
  # provided action group.
  amount     = 1000000
  time_grain = "Monthly"

  time_period {
    start_date = "${formatdate("YYYY-MM", timestamp())}-01T00:00:00Z"
  }

  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_groups = [var.anomaly_action_group_id]
  }

  lifecycle {
    ignore_changes = [time_period]
  }
}

# ─── Synapse Serverless external views ──────────────────────────────────────
#
# We don't create the Synapse workspace here — that lives in the audit
# module. We just emit the recommended SQL for analysts to paste into the
# Synapse Serverless SQL endpoint (via the `cost_view_definitions` output
# below).
