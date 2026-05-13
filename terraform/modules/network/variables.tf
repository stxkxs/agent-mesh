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

variable "address_space" {
  description = "VNet CIDR. Defaults to 10.40.0.0/16; pick a non-overlapping range if you peer."
  type        = string
  default     = "10.40.0.0/16"
}

variable "subnets" {
  description = "Per-purpose subnets. Defaults give each role a /22 (1024 addresses)."
  type = object({
    aks_system = optional(string, "10.40.0.0/22")
    aks_user   = optional(string, "10.40.4.0/22")
    mcp        = optional(string, "10.40.8.0/22")
    endpoints  = optional(string, "10.40.12.0/24")
    firewall   = optional(string, "10.40.13.0/26")
    bastion    = optional(string, "10.40.14.0/26")
    appgateway = optional(string, "10.40.15.0/24")
  })
  default = {}
}

variable "deploy_azure_firewall" {
  description = "Whether to deploy Azure Firewall as the egress chokepoint. Strongly recommended for iso27001-aligned + hipaa-aware."
  type        = bool
  default     = false
}

variable "compliance_preset" {
  description = "Echoed from the `workspace` module — drives NSG strictness + firewall defaults."
  type        = string
}

variable "private_endpoint_targets" {
  description = "Map of {label = resource_id} for Azure resources that should receive a Private Endpoint in this VNet. The audit + workspace modules feed these in."
  type        = map(string)
  default     = {}
}

variable "private_endpoint_subresources" {
  description = "Map of {label = subresource_name} matched to private_endpoint_targets. e.g. `audit_eh = \"namespace\"`, `kv = \"vault\"`."
  type        = map(string)
  default     = {}
}
