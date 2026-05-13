# agent-mesh-otel-collector

OpenTelemetry Collector DaemonSet, wired for **Datadog**, with:

- OTLP gRPC + HTTP receivers on every node (agents send to `localhost:4317`)
- `agent_mesh.workspace`, `agent_mesh.project`, `kube_cluster_name`, `deployment.environment` as resource attributes on every signal
- PII redaction processor on log bodies (CC / SSN / AWS access keys)
- Datadog OTLP exporter for traces, metrics, and logs
- Health probe + Prometheus metrics endpoint on `:8888`

## Quick start

```bash
helm install otel-collector ./charts/otel-collector \
  --namespace agent-mesh-system \
  --create-namespace \
  --set workspace=platform-prod \
  --set cluster=aks-platform-prod \
  --set datadog.site=datadoghq.com \
  --set datadog.apiKeySecretName=agent-mesh-datadog
```

## Datadog API key wiring

The chart expects a Kubernetes Secret named `datadog.apiKeySecretName` containing a `api-key` field. In production you populate it via the CSI Secrets Store Provider (`azure.workload.identity` driver) which syncs from Azure Key Vault — never embed the key in a manifest.

Example `SecretProviderClass`:

```yaml
apiVersion: secrets-store.csi.x-k8s.io/v1
kind: SecretProviderClass
metadata:
  name: agent-mesh-datadog
spec:
  provider: azure
  parameters:
    clientID: <workload-identity-client-id>
    keyvaultName: <key-vault-name>
    objects: |
      array:
        - |
          objectName: datadog-api-key
          objectType: secret
    tenantId: <aad-tenant-id>
  secretObjects:
    - secretName: agent-mesh-datadog
      type: Opaque
      data:
        - objectName: datadog-api-key
          key: api-key
```

## What gets exported

| Signal  | Pipeline                                                                | Datadog product                                        |
| ------- | ----------------------------------------------------------------------- | ------------------------------------------------------ |
| Traces  | OTLP → memory_limiter → resource → batch → datadog                      | APM (`agent_mesh.*` attributes searchable)             |
| Metrics | OTLP → memory_limiter → resource → batch → datadog                      | Custom metrics with resource_attributes_as_tags        |
| Logs    | OTLP → memory_limiter → transform (redact) → resource → batch → datadog | Logs (DD pipeline auto-extracts `agent_mesh.*` fields) |
