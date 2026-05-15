# network

The VNet + subnet layout + NSG baseline + Private Endpoints stack that lets every other agent-mesh resource run with `public_network_access_enabled = false`.

```hcl
module "network" {
  source = "../../modules/network"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  compliance_preset   = module.workspace.compliance_preset
  tags                = module.workspace.tags

  # Defaults give every subnet a /22 in 10.40.0.0/16 — override `subnets` and
  # `address_space` if you need to peer with an existing VNet.
  deploy_azure_firewall = false

  private_endpoint_targets = {
    kv          = module.workspace.key_vault_id
    storage_dfs = module.workspace.storage_account_id
    storage_blob = module.workspace.storage_account_id
    audit_eh    = module.audit.event_hubs_namespace_id
  }
  private_endpoint_subresources = {
    kv          = "vault"
    storage_dfs = "dfs"
    storage_blob = "blob"
    audit_eh    = "namespace"
  }
}
```

## Subnet layout (10.40.0.0/16 default)

| Subnet                | CIDR          | Role                                          | NSG                                                                 |
| --------------------- | ------------- | --------------------------------------------- | ------------------------------------------------------------------- |
| `snet-aks-system`     | 10.40.0.0/22  | AKS system node pool                          | baseline (allow VNet in, deny Internet in, allow AzureLoadBalancer) |
| `snet-aks-user`       | 10.40.4.0/22  | AKS workload node pool                        | baseline                                                            |
| `snet-mcp`            | 10.40.8.0/22  | MCP gateway pool — separated for blast-radius | baseline                                                            |
| `snet-endpoints`      | 10.40.12.0/24 | Private Endpoints only                        | restrictive (allow VNet in, deny all out)                           |
| `AzureFirewallSubnet` | 10.40.13.0/26 | Azure Firewall (if deployed)                  | n/a — managed                                                       |
| `AzureBastionSubnet`  | 10.40.14.0/26 | Bastion (reserved)                            | n/a — managed                                                       |
| `snet-appgw`          | 10.40.15.0/24 | App Gateway / WAF v2 frontend (M4)            | baseline                                                            |

## Why a dedicated `snet-mcp`

MCP servers run user-provided container code. Even with WAF + AAD + tenant isolation, the risk profile is different from agent-runtime — keeping it on its own subnet means NSG rules + UDRs + access-list policies have a clean target.

## Private Endpoints

You pass in any `{label: resource_id}` map to `private_endpoint_targets` along with the matching subresource name (e.g. `vault`, `blob`, `dfs`, `namespace`). The module creates one PE per entry in the `snet-endpoints` subnet.

DNS resolution is **your** responsibility — typically a hub VNet hosts `privatelink.<service>.azure.net` Private DNS Zones, and your hub-spoke peering propagates them. The module doesn't try to manage zones because that pattern varies wildly per-org.

## Azure Firewall (optional)

Enable with `deploy_azure_firewall = true`. Ships with three application rule allowlists:

- `api.anthropic.com` (Anthropic API)
- `AzureCognitiveServices` FQDN tag (Azure OpenAI + dependent endpoints)
- Datadog ingest endpoints

You'll need to add UDRs on AKS subnets pointing 0.0.0.0/0 to the firewall's private IP — that wiring lives in your AKS module, since cluster lifecycle expects to manage its own route tables.
