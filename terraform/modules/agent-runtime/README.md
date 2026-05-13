# agent-runtime

Azure-side infrastructure for one or more agent workloads on AKS. Provisions Service Bus (intake + DLQ semantics) + Cosmos DB (idempotency state, partitioned, TTL'd) + RBAC for the workload identity to reach both — without ever issuing a connection string.

```hcl
module "agent_runtime" {
  source = "../../modules/agent-runtime"

  workspace_name      = module.workspace.workspace_name
  project             = "alpha"
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  compliance_preset   = module.workspace.compliance_preset
  log_analytics_workspace_id = module.workspace.log_analytics_workspace_id
  tags                = module.workspace.tags

  agent_workload_principal_id = module.credentials.service_principal_object_id

  queues = {
    invocations = {
      max_size_megabytes = 1024
      lock_duration_iso8601 = "PT5M"
      max_delivery_count = 5
    }
    batch = {
      max_size_megabytes = 5120
      lock_duration_iso8601 = "PT15M"
      max_delivery_count = 3
    }
  }

  cosmos_ttl_seconds = 604800  # 7 days
}
```

## What it provisions

| Resource                                                                  | Why                                                                                                                                                        |
| ------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Service Bus namespace (Standard / Premium for `hipaa-aware`)              | Intake transport. Public network disabled, AAD-only auth (`local_auth_enabled = false`).                                                                   |
| Service Bus queues                                                        | One per logical workload (invocations, batch, etc.). Native DLQ via `max_delivery_count` + `dead_lettering_on_message_expiration`. Duplicate detection on. |
| Cosmos DB account (Serverless, Session consistency)                       | Idempotency state. Public network disabled, local auth disabled (RBAC only).                                                                               |
| Cosmos SQL database `idempotency` + container `invocations`               | Partition key `/agent_id`, TTL default 7 days. Indexing excludes `/payload/?` (keep idempotency-lookups cheap; we don't query payload).                    |
| RBAC: `Azure Service Bus Data Receiver` + `Azure Service Bus Data Sender` | Workload SP reads from queues + can publish to DLQ redrive.                                                                                                |
| RBAC: Cosmos Built-in Data Contributor                                    | Workload SP does document CRUD.                                                                                                                            |
| Diagnostic Settings → Log Analytics                                       | Service Bus `allLogs` + Cosmos `audit` flow to the workspace's Log Analytics.                                                                              |

## Compliance preset effects

| Setting                | `standard` / `iso27001-aligned` | `hipaa-aware`                                     |
| ---------------------- | ------------------------------- | ------------------------------------------------- |
| Service Bus SKU        | Standard                        | Premium (private-link only)                       |
| Cosmos geo-replication | Single region                   | Paired region replica (eastus2 ↔ centralus, etc.) |

## What this module does NOT do

- **AKS cluster.** Operator-owned. Plugs into your existing cluster via Workload Identity using `module.credentials`'s federated credential.
- **Helm release.** Use `charts/agent-runtime` deployed via Flux or `helm install` against the outputs.
- **KEDA install.** Operator installs via the AKS Extension (`microsoft.keda`). This module emits a `keda_trigger_auth_snippet` output you can paste into the cluster.

## Why Cosmos NoSQL for idempotency

See [ADR-0009](../../../docs/adr/0009-cosmos-for-idempotency.md). The short version: idempotency is a KV-with-TTL workload, Cosmos has native TTL + single-digit-ms point reads, and we'd be re-implementing those primitives if we used PostgreSQL Flexible Server.
