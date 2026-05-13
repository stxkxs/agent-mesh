variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "project" {
  description = "Project within the workspace. Used in resource naming + Cosmos partition keys."
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

variable "compliance_preset" {
  description = "Echoed from the `workspace` module. Drives Service Bus SKU + Cosmos consistency + replication."
  type        = string
}

variable "log_analytics_workspace_id" {
  description = "Log Analytics workspace ID from the `workspace` module — Diagnostic Settings sink."
  type        = string
}

variable "tags" {
  description = "Tags from the `workspace` module."
  type        = map(string)
  default     = {}
}

variable "agent_workload_principal_id" {
  description = "Principal ID of the workload identity that will read from Service Bus + Cosmos. Pass module.credentials.service_principal_object_id."
  type        = string
}

variable "queues" {
  description = "Per-agent Service Bus queues. Each entry creates a queue + its DLQ subscription is automatically configured."
  type = map(object({
    max_size_megabytes             = optional(number, 1024)
    default_message_ttl_iso8601    = optional(string, "PT8H")
    lock_duration_iso8601          = optional(string, "PT5M")
    max_delivery_count             = optional(number, 5)
    requires_session               = optional(bool, false)
    duplicate_detection_window_iso = optional(string, "PT10M")
  }))
  default = {
    invocations = {}
  }
}

variable "cosmos_partition_paths" {
  description = "Cosmos container partition key path. The idempotency state is keyed by (workspace, tenant, agent, idempotency_key) so the partition key is `/agent_id`."
  type        = string
  default     = "/agent_id"
}

variable "cosmos_ttl_seconds" {
  description = "Default TTL on idempotency records. Production typically uses 7 days (604800). Cosmos enforces TTL on document expire_at field."
  type        = number
  default     = 604800
}
