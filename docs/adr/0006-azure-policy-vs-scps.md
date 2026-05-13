# ADR-0006 — Azure Policy + AAD groups in lieu of SCPs

**Status:** accepted · 2026-05-12

## Context

AWS Organizations supports **SCPs** — Service Control Policies that apply at the Org / OU / Account level and act as an upper bound on any IAM action, regardless of identity policy. Claudium leans on SCPs heavily: `DenyClaudeEgressOutsideGateway`, `EnforceMandatoryTags`, `DenyKMSWithoutEncryptionContext`. These don't grant access; they shrink the universe of grantable actions.

Azure has no direct SCP equivalent. The closest pieces:

1. **Azure Policy** at **Management Group scope** — declarative compliance rules, can `Deny` or `DeployIfNotExists`. Applies to subscriptions in the MG.
2. **AAD permission boundaries** don't exist. Azure RBAC is purely additive.
3. **Azure ABAC** — condition expressions on role assignments (preview-stable for Storage, Key Vault). Lets you say "Reader, but only on objects tagged X."

The closest functional equivalent of SCPs in Azure is **Azure Policy at MG scope + AAD group RBAC + ABAC conditions where supported**.

## Decision

For M2, **agent-mesh ships the AAD groups + RBAC role assignments (the `identity` module)** as the workhorse access-control story. We do NOT ship Management Group Azure Policy assignments in M2 — those are org-shaped (the customer's MG hierarchy varies wildly) and we'd be making opinionated choices that don't generalize.

In M3, we'll ship a separate `policies` module that takes a Management Group scope as input and creates the agent-mesh-equivalent Azure Policy definitions + assignments:

- `Deny-PublicNetworkAccess-OnStorage` (matches claudium's `DenyClaudeEgressOutsideGateway`)
- `Deny-Untagged-Resources` (matches `EnforceMandatoryTags`)
- `Deny-KeyVault-PurgeProtection-Disabled` (no claudium equivalent; new for Azure context)
- `Audit-Resources-Without-PrivateLink` (governance, not deny)

For M2, the `identity` module's per-RBAC restrictions (Auditor decrypts logs CMK only, never data CMK) are the load-bearing control.

## Consequences

**Positive**

- M2 is shippable today without making decisions about the customer's MG hierarchy.
- The Auditor / Developer / WorkspaceAdmin separation in RBAC already provides most of the practical SCP value at workspace scope.
- M3's `policies` module gets to be a clean opt-in: deploy only if you have a MG scope to attach it to.

**Negative**

- We don't have a single deny-all-of-X enforcement tier in M2. A misconfigured WorkspaceAdmin could, e.g., grant their group `Storage Blob Data Reader` on the data CMK-protected container (the role assignment would land; the decrypt would still fail because of the CMK access policy). The defense-in-depth holds, but the deny isn't single-source.
- Tag enforcement happens via the `workspace` module's defaults today; an off-module resource creation could skip the tag policy. M3 fixes this with `Audit-Resources-Without-RequiredTags`.

**Neutral**

- Azure ABAC is still preview for many services. We don't bet on it as the primary mechanism for M2; we use scoped role assignments at specific resource IDs instead.
