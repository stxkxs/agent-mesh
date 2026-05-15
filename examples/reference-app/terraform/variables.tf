variable "workspace_name" {
  description = "Workspace name (kebab-case)."
  type        = string
  default     = "agent-mesh-reference"
}

variable "project" {
  description = "Project within the workspace."
  type        = string
  default     = "alpha"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus2"
}

variable "compliance_preset" {
  description = "standard | iso27001-aligned | hipaa-aware."
  type        = string
  default     = "standard"
}

variable "data_residency" {
  description = "Where model traffic terminates."
  type        = string
  default     = "azure-eastus2"
}

variable "aks_oidc_issuer_url" {
  description = "OIDC issuer URL of an existing AKS cluster. Empty = no federated cred wiring."
  type        = string
  default     = ""
}

variable "monthly_budget_usd" {
  description = "Monthly budget in USD."
  type        = number
  default     = 500
}

variable "datadog_notify_handles" {
  description = "Datadog @handles for monitors."
  type        = list(string)
  default     = []
}

variable "budget_email_subscribers" {
  description = "Email addresses notified on every budget threshold."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default = {
    environment = "sandbox"
    owner       = "platform-team"
    example     = "reference-app"
  }
}
