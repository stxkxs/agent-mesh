output "action_group_id" {
  description = "Action Group resource ID. Pass to the cost module's anomaly_action_group_id to route Cost Anomaly Detection alerts through the same notification fanout."
  value       = azurerm_monitor_action_group.budget.id
}

output "budget_id" {
  description = "Consumption Budget resource ID."
  value       = azurerm_consumption_budget_resource_group.this.id
}

output "kill_switch_logic_app_id" {
  description = "Logic App resource ID. Null if `deploy_kill_switch = false`."
  value       = var.deploy_kill_switch ? azurerm_logic_app_workflow.kill_switch[0].id : null
}

output "kill_switch_principal_id" {
  description = "Managed-identity principal ID of the kill-switch Logic App. Operator grants Application.ReadWrite.OwnedBy on Microsoft Graph out-of-band to this principal so it can delete federated credentials."
  value       = var.deploy_kill_switch ? azurerm_logic_app_workflow.kill_switch[0].identity[0].principal_id : null
}

output "kill_switch_post_apply_steps" {
  description = "Plain-language steps the operator must run after `terraform apply` to wire up the kill-switch Graph permissions."
  value = var.deploy_kill_switch ? join("\n", [
    "Kill-switch Logic App is deployed but needs Microsoft Graph permission to delete federated credentials.",
    "Run as a Global Admin or Privileged Role Admin:",
    "",
    "  PRINCIPAL=$(terraform output -raw kill_switch_principal_id)",
    "  GRAPH_SP=$(az ad sp list --display-name 'Microsoft Graph' --query '[0].id' -o tsv)",
    "  APP_RW=$(az ad sp show --id $GRAPH_SP --query \"appRoles[?value=='Application.ReadWrite.OwnedBy'].id | [0]\" -o tsv)",
    "  az rest --method post \\",
    "    --uri https://graph.microsoft.com/v1.0/servicePrincipals/$PRINCIPAL/appRoleAssignments \\",
    "    --body \"{\\\"principalId\\\":\\\"$PRINCIPAL\\\",\\\"resourceId\\\":\\\"$GRAPH_SP\\\",\\\"appRoleId\\\":\\\"$APP_RW\\\"}\"",
    "",
    "Once granted, exercise the kill-switch with: docs/runbooks/budget-breach.md",
  ]) : null
}
