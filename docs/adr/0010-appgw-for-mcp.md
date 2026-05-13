# ADR-0010 — Application Gateway v2 + WAF v2 for MCP ingress

**Status:** accepted · 2026-05-12

## Context

MCP servers are HTTP backends that the agent runtime calls to fetch external context (file contents, weather, database rows, etc.). They're internal-facing to the platform — agents in the workspace call them — but they need to be reachable from anywhere the agent runtime runs, which means a stable ingress with:

- **TLS termination** (1.2 minimum, 1.3 preferred)
- **WAF protection** — agents might pass tenant-supplied input to MCP servers; the WAF is defense-in-depth against injection / scanning
- **Path-based routing** to N backends (filesystem, weather, github, etc.)
- **Custom domain support** for production
- **Auto-scale** so we don't have to provision peak capacity

Options considered:

| Option                                    | Fit                                                                                                                                                        |
| ----------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Application Gateway v2 (SKU `WAF_v2`)** | First-party L7 + WAF, integrates with Key Vault for cert auto-rotation, auto-scales, dedicated subnet. ✓                                                   |
| Azure Front Door                          | Global anycast frontend — wrong shape; we want regional ingress that doesn't traverse Microsoft's edge for internal-platform traffic. ✗                    |
| APIM                                      | Full API management surface — overkill for "reverse-proxy a few HTTP backends with WAF." ~5× the cost of AG v2 at low volume. ✗                            |
| AKS Ingress (nginx-ingress / Contour)     | Cheaper but moves WAF responsibility into the cluster (mod_security, OPA), and cert rotation becomes cert-manager's job. Workable but more moving parts. ✗ |
| Azure Load Balancer + Pod-side TLS        | L4 only — no WAF, no path-routing. ✗                                                                                                                       |

## Decision

**Application Gateway v2 with the `WAF_v2` SKU.**

- Dedicated subnet (`snet-appgw`, /24) from `terraform/modules/network`
- Auto-scale `capacity` 2 → `max_capacity` 10
- WAF policy: OWASP CRS 3.2 + Microsoft Bot Manager Ruleset in Prevention mode (overridable via the standalone `azurerm_web_application_firewall_policy` resource for false-positive exclusions)
- TLS cert sourced from Key Vault via the AG's user-assigned Managed Identity (`Key Vault Secrets User` role)
- One backend pool + HTTP setting + probe per `backend_fqdns` entry; URL path map routes `/<key>/*` to `pool-<key>`
- SSL policy `AppGwSslPolicy20220101` (TLS 1.2 minimum); Microsoft updates this as new policies ship

Sandbox path: no `tls_certificate_secret_id` → HTTP-only with a synth-time warning surfaced via `deployment_warnings` output. Acceptable for development; the warning makes it impossible to accidentally ship to production.

## Why a dedicated subnet

Azure Application Gateway requires its own subnet (this is a hard constraint, not just our preference). The subnet must be reachable from AKS for backend health probes and from public internet (when public-frontend) for ingress. Sizing as `/24` gives plenty of room for autoscale instances.

## What about WAF false positives

Real MCP traffic will trip OWASP CRS rules occasionally — agents send JSON bodies, sometimes with text payloads that pattern-match SQL injection signatures even though they're benign. Two mitigations:

1. **Start in Detection mode** for the first 2 weeks, watch the WAF logs in Datadog, identify the false-positive rule IDs, then either:
   - Add a per-rule exclusion to the WAF policy
   - Tune the rule (`Microsoft_DefaultRuleSet` allows individual rule disables)
2. **Switch to Prevention** once the noise is gone.

The `waf_mode` variable defaults to Prevention because greenfield deployments should be locked-down-by-default. Operators dial it back to Detection if they need to.

## Consequences

**Positive**

- One ingress, one cert, one WAF policy per workspace — operationally cheap
- Auto-scale absorbs traffic bursts; cost scales with capacity-units, not provisioned size
- Cert rotation is Key Vault's problem, not ours (AG picks up the new cert version automatically)
- WAF logs flow to Log Analytics + Datadog; rule tuning is iterative

**Negative**

- AG v2 has a non-trivial cold start (~10 minutes to provision the first instance, ~60s for scale-out). Not an issue at steady state but bumpy on first deploy.
- Subnet size is fixed at deploy time — bumping from /27 to /24 requires AG recreate. We default to /24 to avoid this.
- AG WAF rule tuning is less ergonomic than nginx's mod_security (Azure portal blade vs. config file). Mitigated by managing the policy as Terraform.

**Neutral**

- AG v2 capacity-unit pricing is ~$0.36/hour per CU + traffic. At 2 CU steady state, that's ~$500/mo per workspace. Worth it for the WAF + cert story.
