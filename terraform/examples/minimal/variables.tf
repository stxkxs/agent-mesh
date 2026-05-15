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

variable "deploy_cost" {
  description = "Whether to deploy Cost Management Export to ADLS + Synapse views + cost anomaly proxy."
  type        = bool
  default     = false
}

variable "deploy_budgets" {
  description = "Whether to deploy the workspace budget + Action Group + kill-switch Logic App."
  type        = bool
  default     = false
}

variable "monthly_budget_usd" {
  description = "Monthly budget in USD when deploy_budgets = true."
  type        = number
  default     = 500
}

variable "kill_switch_threshold_pct" {
  description = "Threshold percentage that triggers the kill-switch automation."
  type        = number
  default     = 120
}

variable "budget_email_subscribers" {
  description = "Email addresses notified at every budget threshold."
  type        = list(string)
  default     = []
}

variable "budget_webhook_endpoints" {
  description = "HTTPS webhooks (Slack, PagerDuty) notified at every budget threshold."
  type = list(object({
    name                    = string
    service_uri             = string
    use_common_alert_schema = optional(bool, true)
  }))
  default = []
}

variable "deploy_agent_runtime" {
  description = "Whether to provision Service Bus + Cosmos for the agent runtime data plane."
  type        = bool
  default     = false
}

variable "deploy_mcp_gateway" {
  description = "Whether to provision the MCP Application Gateway v2 + WAF. Requires deploy_network = true."
  type        = bool
  default     = false
}

variable "mcp_tls_certificate_secret_id" {
  description = "Key Vault Secret ID with PFX-encoded TLS cert for the MCP gateway. Leave null for HTTP-only (sandbox)."
  type        = string
  default     = null
}

variable "mcp_frontend_dns_name" {
  description = "DNS hostname for the MCP gateway listener. Leave null for IP-based access."
  type        = string
  default     = null
}

variable "mcp_backend_fqdns" {
  description = "Map of path → AKS service FQDN. Each becomes a backend pool + path rule on the gateway."
  type        = map(string)
  default     = {}
}

variable "tags" {
  description = "Additional tags."
  type        = map(string)
  default = {
    environment = "sandbox"
    owner       = "platform-team"
  }
}
