variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group name from the `workspace` module."
  type        = string
}

variable "location" {
  description = "Azure region from the `workspace` module."
  type        = string
}

variable "storage_account_id" {
  description = "ADLS Gen2 Storage Account ID from the `workspace` module — capture target."
  type        = string
}

variable "storage_account_name" {
  description = "Storage Account name from the `workspace` module."
  type        = string
}

variable "compliance_preset" {
  description = "Echoed from the `workspace` module. Drives Event Hubs SKU + retention + Object Lock defaults."
  type        = string
}

variable "tags" {
  description = "Tags propagated from the `workspace` module."
  type        = map(string)
  default     = {}
}

variable "event_hub_partition_count" {
  description = "Event Hubs partition count. Bump for higher write fan-in; partitions are immutable after creation."
  type        = number
  default     = 4
  validation {
    condition     = var.event_hub_partition_count >= 1 && var.event_hub_partition_count <= 32
    error_message = "event_hub_partition_count must be 1-32."
  }
}

variable "capture_interval_seconds" {
  description = "Event Hubs Capture write-out interval. Lower = smaller files + lower query latency; higher = fewer write requests."
  type        = number
  default     = 300
  validation {
    condition     = var.capture_interval_seconds >= 60 && var.capture_interval_seconds <= 900
    error_message = "capture_interval_seconds must be 60-900."
  }
}

variable "capture_size_bytes" {
  description = "Event Hubs Capture write-out trigger size in bytes."
  type        = number
  default     = 314572800 # 300 MiB
}

variable "deploy_synapse" {
  description = "Whether to deploy a Synapse Serverless workspace + external tables. Set false to use Diagnostic Settings only (cheaper, but loses ad-hoc SQL)."
  type        = bool
  default     = true
}
