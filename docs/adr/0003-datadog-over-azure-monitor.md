# ADR-0003 — Datadog over Azure Monitor

**Status:** accepted · 2026-05-12

## Context

Azure ships Azure Monitor (Logs + Metrics + App Insights + Workbooks) as the in-band observability stack. It's competent, AAD-integrated, and free at low scale. Datadog is a third-party SaaS — additional cost, additional data-egress to consider — but the LLM observability story is materially better: native LLM tracing (token / cost / latency breakdowns per model), better correlation across traces / logs / metrics, faster dashboard iteration, and a mature alerting + on-call surface most platform teams already run.

Agent-mesh adopter teams overwhelmingly already use Datadog for non-Azure observability; routing AKS observability through it consolidates on one pane of glass.

## Decision

**OpenTelemetry SDK + Collector → Datadog OTLP.**

- Application code uses `@opentelemetry/api` only — never the Datadog Node tracer directly. Keeps the application code vendor-neutral.
- Pods send OTLP to `localhost:4317` on the node (the agent-mesh OTel Collector DaemonSet).
- Collector enriches with workspace / project / cluster resource attributes, runs PII redaction over log bodies, batches, and exports via the OTel Collector's `datadog` exporter.
- Datadog dashboards + monitors are managed as code via the `datadog` Terraform provider, alongside the AKS infra in the same plan.

We do NOT use:

- Azure Monitor as a primary backend (it gets Diagnostic Setting feeds for compliance evidence only).
- The Datadog Node tracer SDK in application code (we'd lose OTel vendor-neutrality).
- DD Agent as a primary (the OTel Collector pattern is more flexible — we can add an OpenSearch or Tempo exporter later without changing application code).

## Consequences

**Positive**

- Application code is OTel-only. Swapping Datadog for another backend (Tempo + Loki + Mimir, New Relic, Honeycomb) is a Collector config change, not a code change.
- LLM-specific tagging (`agent_mesh.provider`, `agent_mesh.model`, `agent_mesh.cost_usd`) is uniform across providers. DD's LLM Observability product picks these up natively.
- PII redaction can happen in two places — at the application boundary (5-layer guardrails) AND at the Collector before forward. Belt and suspenders.

**Negative**

- Additional SaaS cost. Datadog is materially more expensive than Azure Monitor for the same data volume — adopter teams need a budget for it. Mitigated by batching at the Collector and aggressive resource-level filters.
- Egress: log payloads leave Azure to Datadog. The PII redaction processor at the Collector level is non-optional for `hipaa-aware` deployments.
- Some Azure-native correlation (e.g. clicking a metric to jump into the AKS resource blade) is lost. Mitigated by keeping Diagnostic Settings flowing to Azure Monitor as a secondary sink.

**Neutral**

- The DD API key sits in Key Vault, synced to a Kubernetes Secret via CSI Secrets Store Provider. Compromise of the API key doesn't grant Azure access, so the blast radius is bounded to "rotate the key + invalidate DD ingestion."
