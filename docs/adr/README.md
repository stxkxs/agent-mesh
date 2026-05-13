# Architecture Decision Records

Nygard-format ADRs covering the consequential choices in agent-mesh.

| #                                              | Title                                | Status   |
| ---------------------------------------------- | ------------------------------------ | -------- |
| [0001](./0001-terraform-over-bicep.md)         | Terraform over Bicep                 | accepted |
| [0002](./0002-dual-provider-sdk.md)            | Dual provider SDK abstraction        | accepted |
| [0003](./0003-datadog-over-azure-monitor.md)   | Datadog over Azure Monitor           | accepted |
| [0004](./0004-workload-identity-no-secrets.md) | Workload Identity, no client secrets | accepted |

Future ADRs land here as M2+ work surfaces decisions worth recording — examples: Cosmos for idempotency, AG2+WAF for MCP ingress, Synapse Serverless for the audit lake (with a Fabric migration path), kill-switch via AAD-trust-removal + PIM recovery.
