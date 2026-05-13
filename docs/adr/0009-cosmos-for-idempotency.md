# ADR-0009 — Cosmos DB NoSQL for idempotency state

**Status:** accepted · 2026-05-12

## Context

Every agent invocation needs an idempotency key (a hash of the input + agent-id + correlation-id). When the same key arrives twice — because Service Bus delivered a duplicate, because a transient error caused a re-publish, because a tenant's UI triggered a retry — we must serve the same response, not run the agent twice (cost doubles, side effects compound).

The idempotency record needs:

- **Fast point read** on the idempotency key (sub-10ms)
- **Native TTL** — records auto-expire after ~7 days; we don't want a cron-cleanup job
- **Multi-region replication** for HA in `hipaa-aware` deployments
- **Workload-Identity-only auth** — no connection strings, no key rotation
- **Predictable cost at low volume** — the idempotency container holds 100k-10M small records, mostly never read after the first write

Options considered:

| Option                               | Fit                                                                                                                                                                                                                                |
| ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Cosmos DB NoSQL API (Serverless)** | Native `ttl` attribute, sub-10ms point reads at single-digit RUs, AAD RBAC, Serverless billing matches the write-mostly access pattern. ✓                                                                                          |
| PostgreSQL Flexible Server           | Mature, AAD-integrated, but TTL requires either partitioning + drop-old-partition cron OR an `expires_at` column + delete cron. Single-region by default. RBAC works but the DB engine still wants connection strings somewhere. ✗ |
| Azure Tables (Storage Tables)        | Cheap, durable, but TTL is not native (delete on read pattern only), point-read auth via Workload Identity is preview-ish for Storage Tables, and the query surface is anemic. ✗                                                   |
| Redis                                | Native TTL + sub-millisecond reads, but durability story is weaker (replica failover loses writes; persistent Redis options are pricey) and we'd rather not run a stateful cache for state that has to outlive an agent restart. ✗ |
| Cosmos DB Mongo API                  | Same engine as NoSQL but with a wire-protocol that complicates AAD auth + Workload Identity. NoSQL is the cleaner path. ✗                                                                                                          |

## Decision

**Cosmos DB NoSQL API in Serverless mode** is the idempotency store.

- **Account-level** settings: `local_authentication_disabled = true` (RBAC only), `public_network_access_enabled = false`, `is_virtual_network_filter_enabled = true`, `consistency_level = Session`, single region (or paired region for `hipaa-aware`).
- **Database**: `idempotency`, one per workspace+project.
- **Container**: `invocations`, partition key `/agent_id`, `default_ttl = 604800` (7 days, configurable).
- **Indexing policy**: include `/*`, exclude `/payload/?` — we point-read by id + agent_id; we don't query the payload, so don't pay for indexing it.
- **RBAC**: workload SP gets the built-in `Cosmos DB Built-in Data Contributor` role (document CRUD without any management plane access).

## Consequences

**Positive**

- Workload-Identity-only auth — no connection string in any pod
- Native TTL — no cron, no partition rotation, no manual cleanup
- Serverless billing — pay per request, not per provisioned RU/s. Idempotency is bursty, so this is materially cheaper than provisioned
- Multi-region replication is a single `geo_location` block away when `hipaa-aware`

**Negative**

- Cosmos has a learning curve if the operator team is new to it. Mitigated by the AAD-integrated tooling and the @azure/cosmos client's good defaults.
- Serverless has a 1TB container limit. For workspaces processing > 100M invocations / week with 7-day TTL, we'd need to provisioned mode + autoscale. The `cosmos_ttl_seconds` variable lets operators shorten TTL to stay under the cap.
- Session consistency means the same client always reads its own writes, but cross-replica reads have ~10ms lag. Acceptable for idempotency (you only care about your own write).

**Neutral**

- Cosmos costs scale with RU consumption, which at the idempotency workload's profile is ~$5-50/mo for low-to-mid traffic.
