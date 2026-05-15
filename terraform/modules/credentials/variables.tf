variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "project" {
  description = "Project name within the workspace. Used as a scope qualifier on every secret name and federated credential."
  type        = string
  validation {
    condition     = can(regex("^[a-z][a-z0-9-]{1,62}[a-z0-9]$", var.project))
    error_message = "project must be kebab-case, 3-64 chars, starting with a letter."
  }
}

variable "key_vault_id" {
  description = "Key Vault resource ID from the `workspace` module."
  type        = string
}

variable "aks_oidc_issuer_url" {
  description = "OIDC issuer URL of the target AKS cluster. Required for Workload Identity federated credentials. Empty string = no federated creds emitted (useful for sandbox / non-AKS contexts)."
  type        = string
  default     = ""
}

variable "namespace" {
  description = "Kubernetes namespace where the workload's ServiceAccount lives."
  type        = string
  default     = "default"
}

variable "service_account" {
  description = "Kubernetes ServiceAccount name. Annotated with the AAD app client ID on the cluster side."
  type        = string
  default     = "agent-runtime"
}

variable "tags" {
  description = "Tags applied to created resources."
  type        = map(string)
  default     = {}
}

variable "rotation_period_days" {
  description = "Recommended rotation cadence for API key secrets. Surfaced as the `rotation_period_days` tag on every secret for downstream rotation automation."
  type        = number
  default     = 90
}

variable "enable_azure_openai" {
  description = "Whether to create the Azure-OpenAI-key secret + federated credential. Workspaces using only Anthropic can set false."
  type        = bool
  default     = true
}

variable "enable_anthropic" {
  description = "Whether to create the Anthropic-key secret + federated credential. Workspaces using only Azure OpenAI can set false."
  type        = bool
  default     = true
}
