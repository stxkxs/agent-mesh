# ADR-0008 — Budget kill-switch via federated credential removal

**Status:** accepted · 2026-05-12

## Context

A runaway LLM workload can burn through a monthly budget in hours, not days. The default Azure surface offers:

- **Azure Consumption Budgets** — accurate dollar-tracking with up-to-24h lag; supports threshold notifications but no native "throttle this resource group" action.
- **AWS-equivalent "stop the world"** options on Azure include:
  - Resource Group lock (read-only) — would block legitimate operator recovery actions, and pods would continue running with cached tokens until expiry
  - Subscription delete (obviously not viable)
  - Azure Policy `Deny` assignment — slow propagation, hard to target precisely
  - Removing federated identity credentials from the workload's AAD app — immediate, surgical, reversible

We want the kill-switch to be:

- **Immediate** — pods stop minting new tokens within minutes
- **Surgical** — affects only the workspace, not the whole subscription
- **Reversible** — operator can restore service after triage
- **Auditable** — every engage + disengage event is in AAD audit logs
- **Dual-approval-required** — no single operator can disengage unilaterally (matches claudium's SSM Change Manager pattern on AWS)

## Decision

**The kill-switch removes every federated identity credential from the workspace's AAD application.**

Mechanism:

1. Azure Consumption Budget hits the `kill_switch_threshold_pct` (default 120% of monthly_budget_usd)
2. Action Group routes the notification to a Logic App webhook
3. Logic App's system-assigned managed identity calls Microsoft Graph: list federated identity credentials, then delete each
4. Pods running with the workspace's ServiceAccount can no longer mint AAD access tokens — Key Vault reads fail with 401, provider API calls fail with 401
5. The pod stays alive (we do NOT kill the deployment); load builds up in upstream queues until operators investigate

Recovery requires PIM-elevated `WorkspaceAdmin` activation (MFA + optional second approver per tenant policy), then `terraform apply` to recreate the federated credentials. This is the agent-mesh equivalent of claudium's SSM Change Manager dual approval — same shape, native Azure primitives.

## Why not annotate the AKS deployment or scale it to zero?

Three reasons:

1. **No cluster dependency.** The kill-switch should work even when the AKS cluster is degraded or partially unreachable. The Logic App only touches AAD; AKS doesn't have to be healthy.
2. **No application-side state.** Once federated credentials are gone, no in-cluster config change is needed to re-enable — recreating credentials is sufficient.
3. **Single audit surface.** AAD logs are already auditor-readable; AKS audit logs are a separate forwarder.

## Why a Logic App, not Azure Automation?

- Logic Apps have native Action Group integration (`logic_app_receiver`) — no webhook plumbing
- System-assigned managed identity gets a clean role assignment via Terraform
- The workflow is JSON-defined and version-controllable in this repo
- Logic Apps Consumption pricing is < $5/mo for the expected volume (~10 invocations/year if the budget ladder is well-tuned)

Automation would also work but adds an Account + Runbook resource hierarchy that doesn't pay off at this scope.

## What can go wrong

- **Microsoft Graph permission is manual.** The `Application.ReadWrite.OwnedBy` app role on Graph cannot be granted by Terraform's `azuread` provider; it requires Global Admin / Privileged Role Admin consent. The module emits the exact `az rest` command as a post-apply output, but operators MUST run it once for the kill-switch to actually do anything.
- **Cached tokens persist.** AAD tokens are valid for ~1 hour by default. A pod that already has a token will keep making API calls until that token expires. Plan for up to 1 hour of "kill-switch engaged but pod still spending."
- **Mistargeting.** The kill-switch removes credentials from ONE AAD app (the one tied to ONE project under ONE workspace). Multi-project workspaces need one budget+killswitch per project. The module doesn't currently support multi-project bundling — open issue.

## Consequences

**Positive**

- Sub-2-minute reaction time from budget threshold to "pod can't spend"
- Targeting matches blast-radius: one workspace, one project, no collateral damage
- Recovery is well-defined and audited
- Operator-side disengage cannot bypass MFA / approver workflow

**Negative**

- Cached-token tail (up to 1h). Mitigated by configuring shorter TTLs on the AAD app where supported, but the platform doesn't enforce this.
- One Graph-permission grant operators must do post-apply. We surface the command; we can't automate it.

**Neutral**

- Logic App invocation cost is negligible. Budget breach itself is the headline cost, not the response.
