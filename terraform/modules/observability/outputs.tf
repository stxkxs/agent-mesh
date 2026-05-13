output "dashboard_id" {
  description = "Datadog dashboard ID."
  value       = datadog_dashboard.workspace.id
}

output "dashboard_url" {
  description = "Direct URL to the dashboard."
  value       = datadog_dashboard.workspace.url
}

output "monitor_ids" {
  description = "Map of monitor key -> Datadog monitor ID."
  value = {
    p99_latency_opus   = datadog_monitor.p99_latency_opus.id
    p99_latency_sonnet = datadog_monitor.p99_latency_sonnet.id
    p99_latency_haiku  = datadog_monitor.p99_latency_haiku.id
    p99_latency_gpt4o  = datadog_monitor.p99_latency_gpt4o.id
    error_rate         = datadog_monitor.error_rate.id
    cache_hit_drop     = datadog_monitor.cache_hit_drop.id
    eval_regression    = datadog_monitor.eval_regression.id
    audit_lag          = datadog_monitor.audit_lag.id
    spend_anomaly      = datadog_monitor.spend_anomaly.id
  }
}
