variable "workspace_name" {
  description = "Workspace name from the `workspace` module."
  type        = string
}

variable "resource_group_name" {
  description = "Resource group from the `workspace` module."
  type        = string
}

variable "location" {
  description = "Azure region from the `workspace` module."
  type        = string
}

variable "tags" {
  description = "Tags from the `workspace` module."
  type        = map(string)
  default     = {}
}

variable "appgateway_subnet_id" {
  description = "Subnet ID for the Application Gateway. Pass module.network.appgateway_subnet_id. Application Gateway requires a dedicated subnet."
  type        = string
}

variable "key_vault_id" {
  description = "Key Vault ID for sourcing TLS certificates. Required when tls_certificate_secret_id is set."
  type        = string
  default     = null
}

variable "tls_certificate_secret_id" {
  description = "Key Vault Secret ID containing a PFX-encoded TLS certificate. Leave null to deploy HTTP-only (sandbox)."
  type        = string
  default     = null
}

variable "frontend_dns_name" {
  description = "Optional DNS hostname for the listener (e.g. mcp.platform.example.com). When set, the listener requires_sni and uses this as the host. Leave null for IP-based access (sandbox)."
  type        = string
  default     = null
}

variable "backend_fqdns" {
  description = "Map of label → backend FQDN. Each becomes a backend pool + HTTP setting + path rule. Typically point at the AKS service hostnames in the mcp subnet."
  type        = map(string)
  default     = {}
}

variable "waf_mode" {
  description = "WAF v2 mode: Detection (log only) or Prevention (block + log)."
  type        = string
  default     = "Prevention"
  validation {
    condition     = contains(["Detection", "Prevention"], var.waf_mode)
    error_message = "waf_mode must be Detection or Prevention."
  }
}

variable "capacity" {
  description = "Initial AG v2 capacity (instance count). Auto-scaling kicks in above this baseline."
  type        = number
  default     = 2
}

variable "max_capacity" {
  description = "Maximum auto-scale capacity. Bump for higher MCP throughput."
  type        = number
  default     = 10
}
