output "servicebus_namespace_id" {
  description = "Service Bus namespace ID."
  value       = azurerm_servicebus_namespace.this.id
}

output "servicebus_namespace_hostname" {
  description = "Service Bus namespace FQDN. Use as `<hostname>` in the agent pod's Service Bus client + the KEDA ScaledObject `metadata.namespace`."
  value       = "${azurerm_servicebus_namespace.this.name}.servicebus.windows.net"
}

output "queue_names" {
  description = "Map of queue label to queue name."
  value       = { for k, q in azurerm_servicebus_queue.this : k => q.name }
}

output "cosmos_account_id" {
  description = "Cosmos DB account ID."
  value       = azurerm_cosmosdb_account.this.id
}

output "cosmos_endpoint" {
  description = "Cosmos DB SQL endpoint. Use in @azure/cosmos client config."
  value       = azurerm_cosmosdb_account.this.endpoint
}

output "cosmos_database_name" {
  description = "Idempotency database name."
  value       = azurerm_cosmosdb_sql_database.idempotency.name
}

output "cosmos_container_name" {
  description = "Invocations container name. Partition key = /agent_id, TTL = 7d default."
  value       = azurerm_cosmosdb_sql_container.invocations.name
}

output "keda_trigger_auth_snippet" {
  description = "Snippet to paste into your Kubernetes TriggerAuthentication for KEDA's azure-servicebus scaler. Workload Identity replaces the connection-string pattern."
  value       = <<-EOT
    apiVersion: keda.sh/v1alpha1
    kind: TriggerAuthentication
    metadata:
      name: azure-servicebus-${var.project}
      namespace: <your-namespace>
    spec:
      podIdentity:
        provider: azure-workload
        identityId: <workload-identity-client-id-from-credentials-module>
    ---
    apiVersion: keda.sh/v1alpha1
    kind: ScaledObject
    metadata:
      name: ${var.project}-invocations
      namespace: <your-namespace>
    spec:
      scaleTargetRef:
        name: <your-agent-deployment>
      minReplicaCount: 0
      maxReplicaCount: 20
      triggers:
        - type: azure-servicebus
          authenticationRef:
            name: azure-servicebus-${var.project}
          metadata:
            namespace: ${azurerm_servicebus_namespace.this.name}
            queueName: invocations
            messageCount: "10"
  EOT
}
