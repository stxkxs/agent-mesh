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

variable "deploy_audit" {
  description = "Whether to deploy the audit pipeline (Event Hubs + Capture + Synapse Serverless)."
  type        = bool
  default     = false
}

variable "deploy_network" {
  description = "Whether to deploy the VNet + Private Endpoints stack. Adds non-trivial cost; default off for sandbox."
  type        = bool
  default     = false
}

variable "deploy_identity" {
  description = "Whether to provision the six agent-mesh AAD groups + workspace-scoped role assignments."
  type        = bool
  default     = false
}

variable "deploy_observability" {
  description = "Whether to provision the Datadog dashboard + 9 monitors. Requires DD_API_KEY + DD_APP_KEY env vars."
  type        = bool
  default     = false
}

variable "datadog_notify_handles" {
  description = "Datadog @handles to attach to monitors (e.g. @slack-platform-oncall, @pagerduty-platform)."
  type        = list(string)
  default     = []
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default = {
    environment = "sandbox"
    owner       = "platform-team"
  }
}
