# cost

Cost Management Export pipeline + reconciliation surface. Two cost signals — the SDK-emitted EMF cost (sub-second, per-call, attributed to workspace/project/model/tenant) and the Azure billing surface (daily, per-resource) — meet in the same ADLS Storage Account, joinable in Synapse Serverless.

```hcl
module "cost" {
  source = "../../modules/cost"

  workspace_name       = module.workspace.workspace_name
  resource_group_id    = module.workspace.resource_group_id
  storage_account_id   = module.workspace.storage_account_id
  storage_account_name = module.workspace.storage_account_name

  enable_anomaly_alert    = true
  anomaly_action_group_id = module.budgets.action_group_id
  enable_synapse_views    = true
}
```

## What it provisions

- **Cost Management Export** scoped to the workspace's resource group, daily parquet to `cost-exports/cost-management/<yyyy>/<mm>/<dd>/manifest.json` in the workspace Storage Account. We use the `azapi_resource` `Microsoft.CostManagement/exports@2023-03-01` API because `azurerm_cost_management_*` lags new export features.
- **`cost-exports` blob container** on the existing workspace ADLS Gen2 Storage Account.
- **Anomaly proxy budget** (only if `enable_anomaly_alert = true`) — a budget set to a ridiculously high threshold whose only purpose is to carry forecasted-anomaly notifications to the supplied action group.

## Synapse views

`enable_synapse_views = true` emits a `cost_view_definitions` output containing T-SQL ready to paste into the audit module's Synapse Serverless SQL endpoint. The views:

| View                             | Purpose                                                                                                                                                                                          |
| -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `cost_by_workspace`              | Daily Azure-billed cost rolled up by ServiceName for the workspace's RG                                                                                                                          |
| `cost_reconciliation_emf_vs_cur` | Joins SDK-emitted `agent_mesh.call_event` cost (from the audit lake) against Azure billing. Surfaces `delta_pct`. **Persistent > 2% delta = pricing-table drift; surface as a Datadog monitor.** |

The Synapse workspace itself comes from the `audit` module — this module just emits the SQL. Run them once after both `audit` and `cost` are deployed.

## Why a separate export, not just Datadog cost?

Datadog has cost metrics from the SDK side (`agent_mesh.cost_usd`). Azure Cost Management is the authoritative billing surface — it includes:

- Infrastructure costs the SDK can't see (Storage operations, Event Hubs throughput, AKS node-hours)
- Cross-resource cost attribution via tags
- The actual Azure invoice line items for audit/finance

Reconciliation between the two is non-negotiable for any team running > $10k/mo of LLM workloads; the `cost_reconciliation_emf_vs_cur` view is how we keep both honest.
