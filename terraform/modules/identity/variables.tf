variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "resource_group_id" {
  description = "Resource group ID — scope for the custom role assignments."
  type        = string
}

variable "key_vault_id" {
  description = "Key Vault ID — Auditor gets `Key Vault Crypto Service Encryption User` on the logs CMK only (encryption-context restricted via role conditions)."
  type        = string
}

variable "cmk_logs_id" {
  description = "Logs CMK key ID — Auditor decrypts this key only."
  type        = string
}

variable "storage_account_id" {
  description = "Storage account ID — Auditor gets read-only on the audit container."
  type        = string
}

variable "synapse_workspace_id" {
  description = "Optional Synapse workspace ID — Auditor gets SQL Serverless User if provided."
  type        = string
  default     = null
}

variable "roles" {
  description = "Which agent-mesh roles to provision. Skip any you already manage org-wide."
  type        = set(string)
  default     = ["PlatformAdmin", "WorkspaceAdmin", "Developer", "Auditor", "FinOps", "ReadOnly"]
  validation {
    condition = alltrue([
      for r in var.roles : contains(["PlatformAdmin", "WorkspaceAdmin", "Developer", "Auditor", "FinOps", "ReadOnly"], r)
    ])
    error_message = "roles must be a subset of: PlatformAdmin, WorkspaceAdmin, Developer, Auditor, FinOps, ReadOnly."
  }
}

variable "owners" {
  description = "AAD object IDs of group owners. Defaults to the current Terraform principal."
  type        = list(string)
  default     = []
}

