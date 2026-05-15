variable "workspace_name" {
  description = "Workspace name from the `workspace` module. Used as a tag filter on every dashboard widget + monitor."
  type        = string
}

variable "notify_handles" {
  description = "Datadog notification handles to attach to every monitor (Slack, PagerDuty, email)."
  type        = list(string)
  default     = []
  validation {
    condition     = alltrue([for h in var.notify_handles : startswith(h, "@")])
    error_message = "Each handle must start with @ (e.g. @slack-platform-oncall, @pagerduty-platform)."
  }
}

variable "slo_p99_latency_ms" {
  description = "Per-model p99 latency SLOs (ms). Monitor alerts when p99 exceeds the threshold over 5 minutes."
  type = object({
    opus        = optional(number, 30000)
    sonnet      = optional(number, 12000)
    haiku       = optional(number, 4000)
    gpt_4o      = optional(number, 8000)
    gpt_4o_mini = optional(number, 3000)
  })
  default = {}
}

variable "error_rate_threshold_pct" {
  description = "Alert when error rate exceeds this percent over 5 minutes."
  type        = number
  default     = 2
}

variable "cache_hit_drop_threshold_pp" {
  description = "Alert when cache hit rate drops by this many percentage points week-over-week (sustained 10 min)."
  type        = number
  default     = 20
}

variable "eval_score_regression_threshold_pct" {
  description = "Alert when eval suite worst-case score drops by this percent vs baseline."
  type        = number
  default     = 5
}

variable "audit_lag_threshold_minutes" {
  description = "Alert when Event Hubs Capture lag exceeds this many minutes."
  type        = number
  default     = 15
}

variable "tags" {
  description = "Datadog resource tags. Workspace tag always added."
  type        = list(string)
  default     = []
}
