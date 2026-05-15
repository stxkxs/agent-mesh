# budgets

Azure Consumption Budget + Action Group + Logic App kill-switch. The budget is scoped to the workspace resource group; every notification flows through one Action Group so adding a Slack channel or PagerDuty service is a one-line change.

```hcl
module "budgets" {
  source = "../../modules/budgets"

  workspace_name      = module.workspace.workspace_name
  resource_group_id   = module.workspace.resource_group_id
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  monthly_budget_usd        = 5000
  kill_switch_threshold_pct = 120

  email_subscribers = ["[email protected]"]
  webhook_endpoints = [
    {
      name        = "slack-platform-oncall"
      service_uri = "https://hooks.slack.com/services/T0/B0/XYZ"
    },
    {
      name        = "pagerduty-platform"
      service_uri = "https://events.pagerduty.com/integration/abc/enqueue"
    },
  ]

  kill_switch_target_app_id = module.credentials.application_object_id
  deploy_kill_switch        = true
}
```

## Threshold ladder

| Threshold                                  | Type       | What happens                                              |
| ------------------------------------------ | ---------- | --------------------------------------------------------- |
| 50%                                        | Actual     | Informational notify (email, webhooks)                    |
| 80%                                        | Actual     | Warning notify                                            |
| 80%                                        | Forecasted | Early warning notify (likely to hit 100% this month)      |
| 100%                                       | Actual     | Budget exhausted notify (manual intervention recommended) |
| `kill_switch_threshold_pct` (default 120%) | Actual     | **Kill-switch engages**                                   |

## Kill-switch design

When the kill-switch threshold trips, the Action Group calls the Logic App webhook. The Logic App's managed identity then:

1. **Lists** all federated identity credentials on the configured AAD application via Microsoft Graph
2. **Deletes** each — pods running with the workspace's ServiceAccount can no longer mint AAD access tokens, which means no Key Vault reads, no Storage writes, no provider API calls
3. **Logs** the action to the Logic App's run history

The pod doesn't crash — it stays alive but every outbound auth call fails with 401, and DLQs build. KEDA may scale on queue depth if you've configured ScaledObjects on Service Bus, but the auth wall is the load-bearing stop.

**Recovery is human-only.** There is no API to re-engage. An operator with PIM-elevated `WorkspaceAdmin` runs the runbook in `docs/runbooks/kill-switch-disengage.md`, which:

1. Elevates via PIM (requires MFA + a second approver if your tenant policy mandates it)
2. Re-creates the federated credentials with `terraform apply` (the credentials module will detect drift and recreate)

Dual-approval is enforced by the PIM activation flow itself — single-actor tenant policies require MFA + reason; org-wide policies typically add an approver workflow.

## Post-apply manual step (Graph permissions)

The Logic App's managed identity needs `Application.ReadWrite.OwnedBy` on Microsoft Graph to delete federated credentials. This grant cannot be automated via Terraform's `azuread` provider — it requires Global Admin / Privileged Role Admin consent. The module emits the exact `az rest` invocation as the `kill_switch_post_apply_steps` output; run it once after `apply`.

## ADRs

- [ADR-0008 — Budget kill-switch via federated credential removal](../../../docs/adr/0008-budget-kill-switch.md)
