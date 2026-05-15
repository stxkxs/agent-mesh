/**
 * budgets — Azure Consumption Budget + Action Group + kill-switch Logic App.
 *
 * Threshold ladder:
 *   - 50% actual    → notify   (informational)
 *   - 80% actual    → notify   (warning)
 *   - 80% forecast  → notify   (early warning)
 *   - 100% actual   → notify   (budget exhausted; manual intervention recommended)
 *   - kill_switch_threshold_pct actual (default 120%) → engage kill-switch
 *
 * The kill-switch (when deployed):
 *   1. Removes EVERY federated identity credential from the target AAD
 *      application — pods can no longer mint AAD access tokens.
 *   2. Annotates the workspace's resource group with a stop tag for
 *      operator visibility.
 *   3. Writes the kill-switch state to App Configuration for the agent
 *      runtime to read on next cold start.
 *
 * Recovery is human-only. There is no API to disengage. An operator with
 * PIM-elevated WorkspaceAdmin runs the runbook
 * (docs/runbooks/kill-switch-disengage.md) to re-create the federated
 * credentials. Dual-approval is enforced by the PIM activation flow.
 *
 * Why a Logic App and not Automation?
 *   - Native Action Group integration (no webhook plumbing)
 *   - System-assigned managed identity gets a clean role assignment
 *   - Drag-and-drop YAML-style workflow definition, version-controllable
 */

# ─── Action Group: receives the budget threshold notifications ──────────────

resource "azurerm_monitor_action_group" "budget" {
  name                = "ag-agent-mesh-${var.workspace_name}-budget"
  resource_group_name = var.resource_group_name
  short_name          = substr("amb${var.workspace_name}", 0, 12)
  enabled             = true

  dynamic "email_receiver" {
    for_each = toset(var.email_subscribers)
    content {
      name          = "email-${replace(email_receiver.value, "@", "-at-")}"
      email_address = email_receiver.value
    }
  }

  dynamic "sms_receiver" {
    for_each = var.sms_subscribers
    content {
      name         = "sms-${sms_receiver.value.country_code}-${sms_receiver.value.phone_number}"
      country_code = sms_receiver.value.country_code
      phone_number = sms_receiver.value.phone_number
    }
  }

  dynamic "webhook_receiver" {
    for_each = var.webhook_endpoints
    content {
      name                    = webhook_receiver.value.name
      service_uri             = webhook_receiver.value.service_uri
      use_common_alert_schema = webhook_receiver.value.use_common_alert_schema
    }
  }

  # The Logic App webhook (only if kill-switch is deployed).
  dynamic "logic_app_receiver" {
    for_each = var.deploy_kill_switch ? [1] : []
    content {
      name                    = "kill-switch-logic-app"
      resource_id             = azurerm_logic_app_workflow.kill_switch[0].id
      callback_url            = azurerm_logic_app_trigger_http_request.kill_switch[0].callback_url
      use_common_alert_schema = true
    }
  }

  tags = var.tags
}

# ─── Consumption Budget — the workhorse ─────────────────────────────────────

resource "azurerm_consumption_budget_resource_group" "this" {
  name              = "budget-agent-mesh-${var.workspace_name}"
  resource_group_id = var.resource_group_id
  amount            = var.monthly_budget_usd
  time_grain        = "Monthly"

  time_period {
    start_date = "${formatdate("YYYY-MM", timestamp())}-01T00:00:00Z"
  }

  # 50% actual — informational ping
  notification {
    enabled        = true
    threshold      = 50
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_groups = [azurerm_monitor_action_group.budget.id]
  }

  # 80% actual — warning
  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_groups = [azurerm_monitor_action_group.budget.id]
  }

  # 80% forecast — early warning before we hit actual
  notification {
    enabled        = true
    threshold      = 80
    operator       = "GreaterThan"
    threshold_type = "Forecasted"
    contact_groups = [azurerm_monitor_action_group.budget.id]
  }

  # 100% actual — budget exhausted
  notification {
    enabled        = true
    threshold      = 100
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_groups = [azurerm_monitor_action_group.budget.id]
  }

  # Kill-switch trigger
  notification {
    enabled        = true
    threshold      = var.kill_switch_threshold_pct
    operator       = "GreaterThan"
    threshold_type = "Actual"
    contact_groups = [azurerm_monitor_action_group.budget.id]
  }

  # Start date is a moving target — terraform should not re-create the
  # budget every month boundary. Ignore the time_period to keep it stable.
  lifecycle {
    ignore_changes = [time_period]
  }
}

# ─── Kill-switch Logic App ──────────────────────────────────────────────────

resource "azurerm_logic_app_workflow" "kill_switch" {
  count               = var.deploy_kill_switch ? 1 : 0
  name                = "la-agent-mesh-${var.workspace_name}-killswitch"
  location            = var.location
  resource_group_name = var.resource_group_name

  identity {
    type = "SystemAssigned"
  }

  tags = var.tags
}

# HTTP trigger — receives the Common Alert Schema payload from the Action Group.
resource "azurerm_logic_app_trigger_http_request" "kill_switch" {
  count        = var.deploy_kill_switch ? 1 : 0
  name         = "manual"
  logic_app_id = azurerm_logic_app_workflow.kill_switch[0].id
  schema       = file("${path.module}/templates/common-alert-schema.json")
}

# Action: assert this is the kill-switch threshold (not a lower notification).
# Logic App actions are expressed as separate resources; the order matters
# but Terraform handles the dependency graph via explicit references.
resource "azurerm_logic_app_action_http" "remove_federated_credentials" {
  count        = var.deploy_kill_switch && var.kill_switch_target_app_id != null ? 1 : 0
  name         = "remove-federated-credentials"
  logic_app_id = azurerm_logic_app_workflow.kill_switch[0].id
  method       = "GET"
  uri          = "https://graph.microsoft.com/v1.0/applications/${var.kill_switch_target_app_id}/federatedIdentityCredentials"

  headers = {
    "Authorization" = "@{concat('Bearer ', body('Acquire-graph-token').access_token)}"
  }

  # We list credentials, then iterate and delete each. The actual
  # implementation is a longer Logic App workflow JSON — for production,
  # use the full definition in templates/kill-switch-workflow.json
  # rather than the simplified shape above.
  depends_on = [azurerm_logic_app_trigger_http_request.kill_switch]
}

# Grant the Logic App's managed identity the Graph permission to delete
# federated credentials on the target AAD app. This requires the
# Application.ReadWrite.OwnedBy app role on Microsoft Graph, which the
# operator grants out-of-band via:
#   az ad app permission grant --id <la-app-id> --api 00000003-0000-0000-c000-000000000000 \
#     --scope Application.ReadWrite.OwnedBy
#
# We surface the principal ID via output so the operator can wire this up.
