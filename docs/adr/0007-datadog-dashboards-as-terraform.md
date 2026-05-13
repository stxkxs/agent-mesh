# ADR-0007 — Datadog dashboards as Terraform, not JSON imports

**Status:** accepted · 2026-05-12

## Context

Datadog supports three patterns for managing dashboards-as-code:

1. **Click-ops in the UI, no source-of-truth.** Loses on every reviewability axis.
2. **JSON export → checked into git, re-imported via `terraform_remote_state` or shell scripts.** Source-of-truth exists but the diff is unreadable (Datadog reformats; widget IDs churn).
3. **Native Terraform resources** (`datadog_dashboard`, `datadog_monitor`) — first-class HCL, plan/apply lifecycle, readable diffs.

We want the dashboard + monitors to be:

- Reviewed in PRs (someone tightened the latency SLO? Approve it in review, not after the fact)
- Replayable across workspaces (a new workspace gets the same 5-row dashboard automatically)
- Version-controlled (when a monitor threshold changes, blame can trace why)

## Decision

**All Datadog observability resources are managed as native Terraform resources** in `terraform/modules/observability`. The dashboard widget composition is HCL. The monitor thresholds are HCL variables with defaults. Notification handles are HCL inputs.

No JSON imports. No click-ops as the primary path (operators can experiment in UI, but production state must round-trip through Terraform — if not in HCL, it gets reverted by the next apply).

## Consequences

**Positive**

- Dashboard + monitor changes go through PR review like any other code.
- A new workspace gets the exact same 5-row dashboard + 9 monitors by composing one Terraform module.
- The `notify_handles` variable lets per-workspace teams point alerts at their own on-call without forking.
- Anomaly detection thresholds (cache-hit drop %, eval score regression %) are HCL variables — tunable without touching widget queries.

**Negative**

- HCL is verbose for complex dashboard layouts. Our 5-row dashboard with ~14 widgets is ~200 lines of HCL. For dashboards 10× that size, we'd revisit (potentially generate HCL from a higher-level abstraction).
- The `datadog` Terraform provider has a slight lag on brand-new widget types. Mitigated by the `widget.custom_widget` escape hatch when needed.
- API + APP keys need to be available at plan/apply time. We document the Workload-Identity-from-Key-Vault pattern in the module README.

**Neutral**

- Operators can still iterate in the DD UI for experimental dashboards. We just don't promote those to production until they're translated to HCL.
