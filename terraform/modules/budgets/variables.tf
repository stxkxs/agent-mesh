variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "resource_group_id" {
  description = "Resource group ID from the `workspace` module — budget scope."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group name from the `workspace` module — Logic App + Action Group live here."
  type        = string
}

variable "location" {
  description = "Azure region for the Logic App + Action Group."
  type        = string
}

variable "tags" {
  description = "Tags from the `workspace` module."
  type        = map(string)
  default     = {}
}

variable "monthly_budget_usd" {
  description = "Monthly budget for the workspace in USD."
  type        = number
  validation {
    condition     = var.monthly_budget_usd > 0
    error_message = "monthly_budget_usd must be positive."
  }
}

variable "kill_switch_threshold_pct" {
  description = "Threshold percentage that triggers the kill-switch automation. 120 = engage when actual spend hits 120% of monthly_budget_usd. Set above 100% so single-day spikes don't trip it; the budget's 100% notification still fires as a warning."
  type        = number
  default     = 120
  validation {
    condition     = var.kill_switch_threshold_pct >= 100 && var.kill_switch_threshold_pct <= 200
    error_message = "kill_switch_threshold_pct must be 100-200."
  }
}

variable "email_subscribers" {
  description = "Email addresses to notify at every budget threshold."
  type        = list(string)
  default     = []
}

variable "sms_subscribers" {
  description = "Phone numbers (E.164 country-code + number) to SMS-notify at the kill-switch threshold."
  type = list(object({
    country_code = string
    phone_number = string
  }))
  default = []
}

variable "webhook_endpoints" {
  description = "Generic HTTPS webhooks to POST to on every threshold (Slack, PagerDuty, custom). Format: list of {name, uri, use_common_alert_schema}."
  type = list(object({
    name                    = string
    service_uri             = string
    use_common_alert_schema = optional(bool, true)
  }))
  default = []
}

variable "kill_switch_target_app_id" {
  description = "AAD application ID whose federated credentials get nuked by the kill-switch. Pass module.credentials.application_object_id."
  type        = string
  default     = null
}

variable "deploy_kill_switch" {
  description = "Whether to deploy the Logic App that nukes credentials on hard breach. Disable for sandbox / dev workspaces where you'd rather just get paged."
  type        = bool
  default     = true
}
