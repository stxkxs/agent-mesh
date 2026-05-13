# audit

The audit data plane. Event Hubs → Capture (Avro) → ADLS Gen2 partitioned by `yyyy/mm/dd/hh/<eh>-<partition>-<offset>` → Synapse Serverless SQL endpoint exposing ad-hoc queries over the captured files.

This is the source of truth for the platform's audit story — every CallEvent the SDK emits ends up here, immutable for the retention period your compliance preset dictates.

```hcl
module "audit" {
  source = "../../modules/audit"

  workspace_name       = module.workspace.workspace_name
  resource_group_name  = module.workspace.resource_group_name
  location             = module.workspace.location
  storage_account_id   = module.workspace.storage_account_id
  storage_account_name = module.workspace.storage_account_name
  logs_cmk_id          = module.workspace.cmk_logs_id
  compliance_preset    = module.workspace.compliance_preset
  tags                 = module.workspace.tags

  event_hub_partition_count = 4   # bump for higher fan-in
  capture_interval_seconds  = 300 # 5-min trigger
  deploy_synapse            = true
}
```

## Compliance preset effects

| Setting                               | `standard` | `iso27001-aligned` | `hipaa-aware`                 |
| ------------------------------------- | ---------- | ------------------ | ----------------------------- |
| Event Hubs SKU                        | Standard   | Standard           | Premium (private-link only)   |
| Retention on hub (days)               | 1          | 1                  | 7                             |
| Immutability period on captured blobs | none       | 90 days            | 7 years (2555 days)           |
| Auto-inflate max throughput units     | 10         | 10                 | 0 (Premium uses PUs, not TUs) |

## What the SDK / runtime side does

`@agent-mesh/sdk` emits a structured log line per call (`agent_mesh.call_event`). The OTel Collector chart (`charts/otel-collector`) forks the logs pipeline:

1. **Datadog Logs** — for operator dashboards / incident triage
2. **Event Hubs** (via `azureeventhub` exporter) — for the immutable audit trail

The Event Hubs exporter authenticates with Workload Identity — no SAS keys or connection strings.

## Querying the captured audit

The `audit_query_starter` output gives you a ready-to-paste T-SQL block. Point Azure Data Studio (or SSMS, or `sqlcmd`) at the `audit_serverless_sql_endpoint` output, log in via AAD, and run.

For production: shape the queries into views in your Synapse workspace + grant read to the AAD Auditor group from the `identity` module. Auditors get scoped SQL access; no Storage blob reach-through.

## ADRs

- [ADR-0005 — Synapse Serverless over Fabric (today)](../../../docs/adr/0005-synapse-over-fabric.md)
