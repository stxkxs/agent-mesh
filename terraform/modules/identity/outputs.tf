output "group_ids" {
  description = "Map of role -> AAD group object ID. Use these to manage memberships out of band (e.g. via Microsoft Graph or AAD admin UI)."
  value       = { for k, g in azuread_group.this : k => g.object_id }
}

output "group_names" {
  description = "Map of role -> AAD group display name."
  value       = { for k, g in azuread_group.this : k => g.display_name }
}

output "platform_admin_group_id" {
  description = "Convenience accessor for the PlatformAdmin group object ID. Null if PlatformAdmin not in `roles`."
  value       = contains(var.roles, "PlatformAdmin") ? azuread_group.this["PlatformAdmin"].object_id : null
}

output "auditor_group_id" {
  description = "Convenience accessor for the Auditor group object ID. Null if Auditor not in `roles`."
  value       = contains(var.roles, "Auditor") ? azuread_group.this["Auditor"].object_id : null
}

output "rbac_summary" {
  description = "Human-readable summary of what each group can do. Echoed on every apply for visibility."
  value = join("\n", [
    for k, spec in {
      for r, s in {
        PlatformAdmin  = "Owner on workspace RG"
        WorkspaceAdmin = "Contributor on workspace RG (no RBAC)"
        Developer      = "KV Secrets Officer + Storage Blob Data Contributor"
        Auditor        = "Storage Blob Data Reader on audit container; Crypto Service Encryption User on LOGS CMK only"
        FinOps         = "Reader on workspace RG (Cost Mgmt Reader assigned out-of-band)"
        ReadOnly       = "Reader on workspace RG"
      } : r => s if contains(var.roles, r)
    } : "  ${k} → ${spec}"
  ])
}
