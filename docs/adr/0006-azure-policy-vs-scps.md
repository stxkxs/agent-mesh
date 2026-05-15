# ADR-0006 — Azure Policy + AAD groups for tenant-wide guardrails

**Status:** accepted · 2026-05-12

## Context

We need two access-control tiers:

1. **Per-workspace least-privilege RBAC** — Developer can write blobs but can't grant access; Auditor reads audit metadata but can't decrypt model data; etc.
2. **Org-wide universal denies** — "no public Storage anywhere in this subscription"; "every resource must carry mandatory tags"; "no Key Vault without purge protection."

Azure's primitives for these:

1. **AAD groups + RBAC role assignments** at specific scopes — additive, well-supported, scriptable via Terraform.
2. **Azure Policy** at **Management Group scope** — declarative compliance rules, can `Deny` or `DeployIfNotExists`. Applies to all subscriptions under the MG.
3. **Azure ABAC** — condition expressions on role assignments (preview-stable for Storage, Key Vault). Lets you say "Reader, but only on objects tagged X."

Azure RBAC by itself is purely additive — there's no "permission boundary" concept. The universal-deny tier requires Azure Policy at MG scope.

## Decision

**Ship AAD groups + scoped RBAC in the `identity` module today; defer Management Group Policy assignments to a future module.**

The `identity` module provides six per-workspace AAD groups (PlatformAdmin / WorkspaceAdmin / Developer / Auditor / FinOps / ReadOnly) with scoped role assignments at specific resource IDs. Auditor decrypts the logs CMK only; never the data CMK. Developer gets Secrets Officer on Key Vault + Storage Blob Data Contributor — no infra mutation.

We do **not** ship Management Group Azure Policy assignments yet. Customer MG hierarchies vary too widely (single-tenant orgs, parent-child MG trees, landing-zone-pattern MGs) for one opinionated set of assignments to fit. The future `policies` module will take an MG scope as input and ship a curated agent-mesh policy set:

- `Deny-PublicNetworkAccess-OnStorage`
- `Deny-Untagged-Resources` (mandatory tag enforcement)
- `Deny-KeyVault-PurgeProtection-Disabled`
- `Audit-Resources-Without-PrivateLink` (governance, not deny)

## Consequences

**Positive**

- The `identity` module is shippable today without making decisions about the customer's MG hierarchy.
- The Auditor / Developer / WorkspaceAdmin separation in RBAC already provides most of the practical universal-deny value at workspace scope.
- The future `policies` module gets to be a clean opt-in: deploy only if you have an MG scope to attach it to.

**Negative**

- We don't have a single deny-all-of-X enforcement tier yet. A misconfigured WorkspaceAdmin could, e.g., grant their group `Storage Blob Data Reader` on the data CMK-protected container (the role assignment would land; the decrypt would still fail because of the CMK access policy). The defense-in-depth holds, but the deny isn't single-source.
- Mandatory tag enforcement happens via the `workspace` module's defaults today; an off-module resource creation could skip the tag policy. The `policies` module fixes this with `Audit-Resources-Without-RequiredTags`.

**Neutral**

- Azure ABAC is still preview for many services. We don't bet on it as the primary mechanism; we use scoped role assignments at specific resource IDs instead.
