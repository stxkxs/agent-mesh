/**
 * Datadog monitors for the agent-mesh workspace.
 *
 * Each monitor:
 *  - filters by `agent_mesh.workspace:<name>` (so the same Terraform can run
 *    per-workspace without collisions in DD)
 *  - has a thoughtful threshold (no "1 error in 1 minute" pages)
 *  - notifies the configured handles
 *
 * Monitor messages link back to the relevant runbook in
 * docs/runbooks/.
 */

locals {
  workspace_tag = "agent_mesh.workspace:${var.workspace_name}"
  all_tags      = concat(["agent-mesh", "workspace:${var.workspace_name}"], var.tags)
  notify_block  = length(var.notify_handles) > 0 ? "\n${join(" ", var.notify_handles)}" : ""
  runbook_base  = "https://github.com/stxkxs/agent-mesh/blob/main/docs/runbooks"
}

# ─── Per-model p99 latency alerts ────────────────────────────────────────────

resource "datadog_monitor" "p99_latency_opus" {
  name              = "[agent-mesh:${var.workspace_name}] Opus p99 latency above SLO"
  type              = "query alert"
  message           = "Opus p99 latency exceeded ${var.slo_p99_latency_ms.opus}ms over 5min. Check provider status, recent prompt-size changes, or fallback chain config. Runbook: ${local.runbook_base}/latency-spike.md${local.notify_block}"
  query             = "avg(last_5m):p99:trace.agent_mesh.messages.duration_ms{${local.workspace_tag},agent_mesh.model:claude-opus*} > ${var.slo_p99_latency_ms.opus}"
  priority          = 3
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 60
  tags              = local.all_tags
}

resource "datadog_monitor" "p99_latency_sonnet" {
  name              = "[agent-mesh:${var.workspace_name}] Sonnet p99 latency above SLO"
  type              = "query alert"
  message           = "Sonnet p99 latency exceeded ${var.slo_p99_latency_ms.sonnet}ms over 5min. Runbook: ${local.runbook_base}/latency-spike.md${local.notify_block}"
  query             = "avg(last_5m):p99:trace.agent_mesh.messages.duration_ms{${local.workspace_tag},agent_mesh.model:claude-sonnet*} > ${var.slo_p99_latency_ms.sonnet}"
  priority          = 3
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 60
  tags              = local.all_tags
}

resource "datadog_monitor" "p99_latency_haiku" {
  name              = "[agent-mesh:${var.workspace_name}] Haiku p99 latency above SLO"
  type              = "query alert"
  message           = "Haiku p99 latency exceeded ${var.slo_p99_latency_ms.haiku}ms over 5min. Runbook: ${local.runbook_base}/latency-spike.md${local.notify_block}"
  query             = "avg(last_5m):p99:trace.agent_mesh.messages.duration_ms{${local.workspace_tag},agent_mesh.model:claude-haiku*} > ${var.slo_p99_latency_ms.haiku}"
  priority          = 3
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 60
  tags              = local.all_tags
}

resource "datadog_monitor" "p99_latency_gpt4o" {
  name              = "[agent-mesh:${var.workspace_name}] GPT-4o p99 latency above SLO"
  type              = "query alert"
  message           = "GPT-4o p99 latency exceeded ${var.slo_p99_latency_ms.gpt_4o}ms over 5min. Runbook: ${local.runbook_base}/latency-spike.md${local.notify_block}"
  query             = "avg(last_5m):p99:trace.agent_mesh.messages.duration_ms{${local.workspace_tag},agent_mesh.model:gpt-4o*} > ${var.slo_p99_latency_ms.gpt_4o}"
  priority          = 3
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 60
  tags              = local.all_tags
}

# ─── Error rate ──────────────────────────────────────────────────────────────

resource "datadog_monitor" "error_rate" {
  name = "[agent-mesh:${var.workspace_name}] Error rate above threshold"
  type = "query alert"
  message = trimspace(
    <<-EOT
      Error rate over 5min exceeded ${var.error_rate_threshold_pct}% — likely provider issue (Anthropic 5xx, Azure OpenAI capacity) or runaway BadRequest from a misconfigured agent.

      Check:
       - DD trace breakdown by `agent_mesh.error_class`
       - DD logs filtered to `service:agent-mesh @status:error`
       - Provider status pages
       - Recent prompt or agent definition deploys

      Runbook: ${local.runbook_base}/error-rate-high.md
      ${local.notify_block}
    EOT
  )
  query             = "avg(last_5m):( sum:agent_mesh.messages.errors{${local.workspace_tag}}.as_count() / sum:agent_mesh.messages.requests{${local.workspace_tag}}.as_count() ) * 100 > ${var.error_rate_threshold_pct}"
  priority          = 2
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 60
  tags              = local.all_tags
}

# ─── Cache hit-rate week-over-week drop ──────────────────────────────────────

resource "datadog_monitor" "cache_hit_drop" {
  name              = "[agent-mesh:${var.workspace_name}] Cache hit rate dropped"
  type              = "query alert"
  message           = "Cache hit rate dropped ${var.cache_hit_drop_threshold_pp} percentage points week-over-week (sustained 10min). Likely a prompt-template change broke cache hits, or a model rollover invalidated cached prefixes. Runbook: ${local.runbook_base}/cache-poisoning.md${local.notify_block}"
  query             = "avg(last_10m):( anomalies(avg:agent_mesh.cache.hit_rate{${local.workspace_tag}}, 'agile', 1, direction='below', alert_window='last_10m', interval=60, count_default_zero='true', seasonality='weekly') ) >= 1"
  priority          = 3
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 240
  tags              = local.all_tags
}

# ─── Eval-score regression ───────────────────────────────────────────────────

resource "datadog_monitor" "eval_regression" {
  name              = "[agent-mesh:${var.workspace_name}] Eval score regressed"
  type              = "query alert"
  message           = "Eval-suite worst-case score dropped > ${var.eval_score_regression_threshold_pct}% vs. last 7d baseline. Block the next deploy until investigated. Runbook: ${local.runbook_base}/eval-regression.md${local.notify_block}"
  query             = "avg(last_15m):( anomalies(min:agent_mesh.eval.score{${local.workspace_tag}}, 'agile', 1, direction='below', alert_window='last_15m', interval=60, count_default_zero='true') ) >= 1"
  priority          = 2
  evaluation_delay  = 120
  notify_no_data    = true
  no_data_timeframe = 4320 # 3 days — eval suites may not run continuously
  renotify_interval = 0
  tags              = local.all_tags
}

# ─── Audit pipeline lag ──────────────────────────────────────────────────────

resource "datadog_monitor" "audit_lag" {
  name              = "[agent-mesh:${var.workspace_name}] Audit pipeline lag"
  type              = "query alert"
  message           = "Event Hubs Capture write lag exceeded ${var.audit_lag_threshold_minutes}min. Compliance evidence may be delayed. Runbook: ${local.runbook_base}/audit-pipeline-lag.md${local.notify_block}"
  query             = "avg(last_5m):avg:azure.eventhub_namespaces.capture_backlog_seconds{${local.workspace_tag}} > ${var.audit_lag_threshold_minutes * 60}"
  priority          = 3
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 120
  tags              = local.all_tags
}

# ─── Spend anomaly ───────────────────────────────────────────────────────────

resource "datadog_monitor" "spend_anomaly" {
  name              = "[agent-mesh:${var.workspace_name}] Spend anomaly detected"
  type              = "query alert"
  message           = "Token spend anomalous vs 7d trend. Investigate runaway agent or batch-fanout job. Runbook: ${local.runbook_base}/spend-anomaly.md${local.notify_block}"
  query             = "avg(last_30m):( anomalies(sum:agent_mesh.cost_usd{${local.workspace_tag}}.as_rate(), 'agile', 2, direction='above', alert_window='last_30m', interval=60, count_default_zero='true', seasonality='weekly') ) >= 1"
  priority          = 2
  evaluation_delay  = 60
  notify_no_data    = false
  renotify_interval = 60
  tags              = local.all_tags
}
