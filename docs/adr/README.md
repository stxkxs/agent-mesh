# Architecture Decision Records

Nygard-format ADRs covering the consequential choices in agent-mesh.

| #                                                 | Title                                     | Status   |
| ------------------------------------------------- | ----------------------------------------- | -------- |
| [0001](./0001-terraform-over-bicep.md)            | Terraform over Bicep                      | accepted |
| [0002](./0002-dual-provider-sdk.md)               | Dual provider SDK abstraction             | accepted |
| [0003](./0003-datadog-over-azure-monitor.md)      | Datadog over Azure Monitor                | accepted |
| [0004](./0004-workload-identity-no-secrets.md)    | Workload Identity, no client secrets      | accepted |
| [0005](./0005-synapse-over-fabric.md)             | Synapse Serverless over Microsoft Fabric  | accepted |
| [0006](./0006-azure-policy-vs-scps.md)            | Azure Policy + AAD groups in lieu of SCPs | accepted |
| [0007](./0007-datadog-dashboards-as-terraform.md) | Datadog dashboards as Terraform           | accepted |

Future ADRs land here as M3+ work surfaces decisions worth recording — examples: Cosmos for idempotency, AG2+WAF for MCP ingress, kill-switch via AAD-trust-removal + PIM recovery, KEDA scaler on Service Bus depth.
