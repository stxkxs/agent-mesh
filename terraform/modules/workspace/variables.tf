variable "workspace_name" {
  description = "Workspace name. Used as the prefix for every resource and as a tag value. Must match `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,62}[a-z0-9]$", var.workspace_name))
    error_message = "workspace_name must be kebab-case, 3-64 chars, starting with a letter."
  }
}

variable "location" {
  description = "Azure region for all workspace resources."
  type        = string
  default     = "eastus2"
}

variable "compliance_preset" {
  description = "Compliance posture preset. Drives defaults for log retention, immutability, encryption, and network policy."
  type        = string
  default     = "standard"
  validation {
    condition     = contains(["standard", "iso27001-aligned", "hipaa-aware"], var.compliance_preset)
    error_message = "compliance_preset must be one of: standard, iso27001-aligned, hipaa-aware."
  }
}

variable "data_residency" {
  description = "Required, no default. Where the model traffic terminates. Surfaced on every deploy as the `data_residency_notice` output."
  type        = string
  validation {
    condition     = can(regex("^(aws|azure)-[a-z0-9-]+$", var.data_residency)) || contains(["us-anthropic", "unknown"], var.data_residency)
    error_message = "data_residency must match `aws-<region>` / `azure-<region>` / `us-anthropic` / `unknown`."
  }
}

variable "tags" {
  description = "Additional tags applied to every workspace resource. Workspace tags `workspace`, `compliance`, `data_residency` are always added."
  type        = map(string)
  default     = {}
}

variable "log_retention_days" {
  description = "Log Analytics retention. Defaults: 30 for standard, 90 for iso27001-aligned, 365 for hipaa-aware."
  type        = number
  default     = null
  validation {
    condition     = var.log_retention_days == null ? true : var.log_retention_days >= 30 && var.log_retention_days <= 730
    error_message = "log_retention_days must be between 30 and 730."
  }
}

variable "purge_protection_enabled" {
  description = "Key Vault purge protection. Defaults to true for iso27001-aligned + hipaa-aware. Once enabled, cannot be disabled."
  type        = bool
  default     = null
}
