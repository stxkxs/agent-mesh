variable "workspace_name" {
  description = "Workspace name (kebab-case)."
  type        = string
  default     = "agent-mesh-minimal"
}

variable "project" {
  description = "Project name within the workspace."
  type        = string
  default     = "alpha"
}

variable "location" {
  description = "Azure region."
  type        = string
  default     = "eastus2"
}

variable "compliance_preset" {
  description = "Compliance preset: standard | iso27001-aligned | hipaa-aware."
  type        = string
  default     = "standard"
}

variable "data_residency" {
  description = "Where model traffic terminates."
  type        = string
  default     = "azure-eastus2"
}

variable "aks_oidc_issuer_url" {
  description = "OIDC issuer URL of an existing AKS cluster. Leave empty to skip Workload Identity federated credential creation."
  type        = string
  default     = ""
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default = {
    environment = "sandbox"
    owner       = "platform-team"
  }
}
