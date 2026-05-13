output "event_hubs_namespace_id" {
  description = "Event Hubs namespace ID. The OTel Collector + agent runtime publish here via Workload Identity."
  value       = azurerm_eventhub_namespace.this.id
}

output "event_hubs_namespace_hostname" {
  description = "Event Hubs namespace FQDN. Use as `<hostname>` in OTel Collector exporter config."
  value       = "${azurerm_eventhub_namespace.this.name}.servicebus.windows.net"
}

output "audit_event_hub_name" {
  description = "Name of the audit event hub. Used by publishers."
  value       = azurerm_eventhub.audit.name
}

output "audit_container_name" {
  description = "ADLS container receiving captured Avro files."
  value       = azurerm_storage_container.audit.name
}

output "audit_container_url" {
  description = "Full HTTPS URL of the audit container. Use as `bulk insert` source in Synapse queries."
  value       = "https://${var.storage_account_name}.blob.core.windows.net/${azurerm_storage_container.audit.name}"
}

output "synapse_workspace_id" {
  description = "Synapse workspace ID. Null if `deploy_synapse = false`."
  value       = var.deploy_synapse ? azurerm_synapse_workspace.this[0].id : null
}

output "synapse_serverless_sql_endpoint" {
  description = "Synapse Serverless SQL endpoint. Connect with SSMS, Azure Data Studio, or any T-SQL client."
  value       = var.deploy_synapse ? "${azurerm_synapse_workspace.this[0].name}-ondemand.sql.azuresynapse.net" : null
}

locals {
  audit_query_starter_sql = <<-EOT
    SELECT
      JSON_VALUE(jsonPayload, '$.workspace') AS workspace,
      JSON_VALUE(jsonPayload, '$.provider') AS provider,
      JSON_VALUE(jsonPayload, '$.model') AS model,
      SUM(CAST(JSON_VALUE(jsonPayload, '$.costUsd') AS FLOAT)) AS total_cost_usd,
      SUM(CAST(JSON_VALUE(jsonPayload, '$.tokensIn') AS BIGINT)) AS total_tokens_in,
      SUM(CAST(JSON_VALUE(jsonPayload, '$.tokensOut') AS BIGINT)) AS total_tokens_out
    FROM OPENROWSET(
      BULK '${azurerm_storage_container.audit.name}/*/*/*/*/*/*.avro',
      DATA_SOURCE = 'audit_lake',
      FORMAT = 'AVRO'
    ) WITH (jsonPayload VARCHAR(MAX)) AS rows
    WHERE JSON_VALUE(jsonPayload, '$.schema') = 'agent-mesh.call-event/v1'
    GROUP BY
      JSON_VALUE(jsonPayload, '$.workspace'),
      JSON_VALUE(jsonPayload, '$.provider'),
      JSON_VALUE(jsonPayload, '$.model')
    ORDER BY total_cost_usd DESC;
  EOT
}

output "audit_query_starter" {
  description = "Starter T-SQL for ad-hoc auditing. Run from the Synapse SQL Serverless endpoint."
  value       = var.deploy_synapse ? local.audit_query_starter_sql : null
}
