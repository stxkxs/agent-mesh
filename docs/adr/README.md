# Architecture Decision Records

Nygard-format ADRs covering the consequential choices in agent-mesh.

| #                                                 | Title                                         | Status   |
| ------------------------------------------------- | --------------------------------------------- | -------- |
| [0001](./0001-terraform-over-bicep.md)            | Terraform over Bicep                          | accepted |
| [0002](./0002-dual-provider-sdk.md)               | Dual provider SDK abstraction                 | accepted |
| [0003](./0003-datadog-over-azure-monitor.md)      | Datadog over Azure Monitor                    | accepted |
| [0004](./0004-workload-identity-no-secrets.md)    | Workload Identity, no client secrets          | accepted |
| [0005](./0005-synapse-over-fabric.md)             | Synapse Serverless over Microsoft Fabric      | accepted |
| [0006](./0006-azure-policy-vs-scps.md)            | Azure Policy + AAD groups in lieu of SCPs     | accepted |
| [0007](./0007-datadog-dashboards-as-terraform.md) | Datadog dashboards as Terraform               | accepted |
| [0008](./0008-budget-kill-switch.md)              | Budget kill-switch via federated cred removal | accepted |
| [0009](./0009-cosmos-for-idempotency.md)          | Cosmos DB NoSQL for idempotency state         | accepted |
| [0010](./0010-appgw-for-mcp.md)                   | Application Gateway v2 + WAF v2 for MCP       | accepted |

Future ADRs land here as M5-M6 work surfaces decisions worth recording — examples: PromptFlow runtime vs. roll-our-own evals, KEDA scaler tuning, prompt cache strategy.
