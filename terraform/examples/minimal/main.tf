/**
 * agent-mesh — minimal example.
 *
 * Provisions a single workspace + a single project's credentials. This is
 * the smallest demoable agent-mesh deployment — no AKS cluster, no MCP,
 * no audit pipeline. Use as the smoke-test before layering on the rest.
 *
 * If you supply `aks_oidc_issuer_url`, the credentials module also wires
 * Workload Identity federated credentials so pods in
 * `default/agent-runtime` on that cluster can assume the workspace's AAD
 * application identity.
 */

module "workspace" {
  source = "../../modules/workspace"

  workspace_name    = var.workspace_name
  location          = var.location
  compliance_preset = var.compliance_preset
  data_residency    = var.data_residency
  tags              = var.tags
}

module "credentials" {
  source = "../../modules/credentials"

  workspace_name      = module.workspace.workspace_name
  project             = var.project
  key_vault_id        = module.workspace.key_vault_id
  aks_oidc_issuer_url = var.aks_oidc_issuer_url
  namespace           = "agent-mesh"
  service_account     = "agent-runtime"
  tags                = module.workspace.tags
}
