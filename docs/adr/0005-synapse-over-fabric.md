# ADR-0005 — Synapse Serverless over Microsoft Fabric

**Status:** accepted · 2026-05-12

## Context

Microsoft has signaled that **Fabric** (OneLake + Lakehouse + SQL endpoint + Power BI + Spark) is the strategic future of its analytics stack. Synapse Analytics is still GA and still supported, but new Microsoft data investments are landing on Fabric first.

For the agent-mesh audit lake (captured Event Hubs → ADLS Gen2 → ad-hoc SQL queries), both options technically work:

- **Synapse Serverless SQL Pool** — pay-per-query against parquet/Avro in ADLS, zero fixed cost, full AzureRM provider coverage today, well-documented for the exact "external table over a date-partitioned blob path" pattern we need.
- **Microsoft Fabric Lakehouse + SQL endpoint** — newer, integrated with Power BI and OneLake, but Terraform support via `azapi` is preview-ish; per-capacity (F-SKU) pricing has a non-trivial minimum (~$262/mo F2) that doesn't make sense for sandbox / dev workspaces.

## Decision

**Ship Synapse Serverless in M2.** It's the lowest-risk path to a working audit lake today. The captured Avro files in ADLS Gen2 are the source of truth — Synapse Serverless is just one of several possible query surfaces over them.

Record a **planned migration to Fabric** for late 2026 / 2027 once:

- The `azurerm`/`azapi` Fabric resource coverage is GA
- An adopter team has a compelling Fabric-only feature requirement (e.g. real-time intelligence over the audit stream)
- The pricing model makes sense at the workspace scale

Migrating is non-disruptive: the ADLS container is the data plane, Synapse Serverless and Fabric both query the same files via different SQL endpoints. The runbook for the cutover (M6) is just "stand up the Fabric workspace, repoint analyst queries, eventually delete the Synapse workspace."

## Consequences

**Positive**

- Zero fixed cost in M2 — workspaces only pay for queries they run.
- Full Terraform fidelity today; no `azapi` raw-REST workarounds.
- Familiar T-SQL surface for analysts and auditors.

**Negative**

- Eventual migration cost when Fabric becomes the default. Mitigated by keeping the data layout queryable from both.
- We don't get Fabric's Real-Time Intelligence / KQL pipeline for free. If a workspace needs streaming analytics today, they can add it independently (Event Hubs is already there).

**Neutral**

- AAD-integrated SQL auth is supported in both — Auditor group access works either way.
