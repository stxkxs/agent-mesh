variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "resource_group_id" {
  description = "Resource group ID from the `workspace` module. Cost Management export scopes to this RG (so we only get costs incurred by agent-mesh, not the whole sub)."
  type        = string
}

variable "storage_account_id" {
  description = "ADLS Gen2 Storage Account ID — Cost export sink."
  type        = string
}

variable "storage_account_name" {
  description = "Storage Account name."
  type        = string
}

variable "export_frequency" {
  description = "Cost Management Export frequency. `Daily` covers most workflows; `MonthToDate` is for finance close cycles."
  type        = string
  default     = "Daily"
  validation {
    condition     = contains(["Daily", "Weekly", "Monthly", "MonthToDate", "BillingMonthToDate", "TheLastMonth", "TheLastBillingMonth", "WeekToDate", "Custom"], var.export_frequency)
    error_message = "export_frequency must be a recognized Cost Management recurrence."
  }
}

variable "enable_anomaly_alert" {
  description = "Whether to deploy an Azure Cost Anomaly Detection alert. Recommended on; needs an Action Group ID."
  type        = bool
  default     = false
}

variable "anomaly_action_group_id" {
  description = "Action Group ID for the Cost Anomaly Detection alert. Required when enable_anomaly_alert = true. Typically pass the budgets module's notification action group."
  type        = string
  default     = null
}

variable "enable_synapse_views" {
  description = "Whether to deploy Synapse Serverless external views for ad-hoc cost queries. Requires the audit module's Synapse workspace."
  type        = bool
  default     = false
}
