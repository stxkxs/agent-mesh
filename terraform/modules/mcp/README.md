# mcp

MCP gateway based on Azure Application Gateway v2 + WAF v2. Fronts N MCP servers running on AKS in the dedicated `mcp` subnet, with TLS termination, WAF protection, and path-based routing.

```hcl
module "mcp" {
  source = "../../modules/mcp"

  workspace_name      = module.workspace.workspace_name
  resource_group_name = module.workspace.resource_group_name
  location            = module.workspace.location
  tags                = module.workspace.tags

  appgateway_subnet_id      = module.network.appgateway_subnet_id
  key_vault_id              = module.workspace.key_vault_id
  tls_certificate_secret_id = "https://<vault>.vault.azure.net/secrets/mcp-cert"
  frontend_dns_name         = "mcp.platform.example.com"

  backend_fqdns = {
    filesystem = "filesystem-readonly.mcp.svc.cluster.local"
    weather    = "weather-mcp.mcp.svc.cluster.local"
  }

  waf_mode = "Prevention"
}
```

## What it provisions

| Resource                                                          | Why                                                                                                                                                                                  |
| ----------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Application Gateway v2 (SKU `WAF_v2`)                             | L7 reverse proxy + TLS termination. Auto-scales between `capacity` and `max_capacity` (2-10 default).                                                                                |
| WAF v2 policy with OWASP CRS 3.2 + Bot Manager                    | Default Prevention mode blocks the OWASP top-10. Override individual rules via `azurerm_web_application_firewall_policy` directly if a legitimate MCP request hits a false positive. |
| Public IP (Standard SKU, static)                                  | One per workspace. Domain label `mcp-<workspace>.<region>.cloudapp.azure.com`.                                                                                                       |
| User-assigned Managed Identity                                    | Pulls TLS certificate from Key Vault (`Key Vault Secrets User` role assignment).                                                                                                     |
| One backend pool + HTTP setting + probe per `backend_fqdns` entry | Each MCP server gets its own pool, settings, and `/healthz` probe.                                                                                                                   |
| HTTP→HTTPS redirect (when TLS configured)                         | Port 80 listener redirects to 443.                                                                                                                                                   |
| SSL policy `AppGwSslPolicy20220101` (TLS 1.2 min)                 | Predefined Microsoft policy; bumps to a newer baseline as Microsoft publishes them.                                                                                                  |

## TLS configuration

In production, supply both:

- `key_vault_id` and `tls_certificate_secret_id` (Key Vault Secret containing a PFX-encoded cert)
- `frontend_dns_name` (the FQDN the cert was issued for; enables SNI)

Sandbox: leave both null — the gateway deploys HTTP-only with a synth warning surfaced via `deployment_warnings` output. Don't ship this to production.

## Routing

`backend_fqdns` is a map of `{path_prefix: fqdn}`. The module sets up path-based routing so `/<key>/*` flows to `<value>`:

```
backend_fqdns = {
  filesystem = "filesystem-readonly.mcp.svc.cluster.local"
}
```

`https://mcp.platform.example.com/filesystem/list` → AKS service `filesystem-readonly.mcp.svc.cluster.local:8080/filesystem/list`.

## What this replaces

Claudium's `McpGateway` construct on AWS does the same thing with ALB + WAF + ACM. The Azure version maps:

| AWS (claudium)        | Azure (agent-mesh)                               |
| --------------------- | ------------------------------------------------ |
| ALB                   | Application Gateway v2                           |
| ACM cert (auto-renew) | Key Vault Secret (PFX, operator-managed renewal) |
| WAFv2 web ACL         | WAF v2 policy                                    |
| ALB target groups     | Backend pools + HTTP settings                    |

## ADRs

- [ADR-0010 — Application Gateway v2 for MCP ingress](../../../docs/adr/0010-appgw-for-mcp.md)
