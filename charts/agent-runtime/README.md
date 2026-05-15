# agent-mesh-agent-runtime

Helm chart for one agent. Combines:

- Workload-Identity-annotated **ServiceAccount**
- **Deployment** running the agent code (TypeScript, `@agent-mesh/sdk`)
- **DLQ handler** Deployment that consumes dead-lettered messages and emits Datadog events
- **KEDA TriggerAuthentication + ScaledObject** for 0→N scale on Service Bus queue depth
- **PodDisruptionBudget** keeping at least 1 pod alive during node drains

Each chart release is one agent — you `helm install triage` for the triage agent, `helm install summarizer` for the summarizer, etc. They share the same Service Bus namespace + Cosmos DB account (provisioned by `terraform/modules/agent-runtime`); they don't share Deployments or ScaledObjects.

```bash
helm install triage ./charts/agent-runtime \
  --namespace agent-mesh \
  --create-namespace \
  --set workspace=platform-prod \
  --set project=alpha \
  --set agentId=triage \
  --set workloadIdentity.clientId="$(terraform output -raw workload_identity_client_id)" \
  --set workloadIdentity.tenantId="$(az account show --query tenantId -o tsv)" \
  --set image.repository=myregistry.azurecr.io/agent-triage \
  --set image.tag=v0.1.0 \
  --set servicebus.namespace="$(terraform output -raw agent_runtime_servicebus_namespace_hostname)" \
  --set servicebus.queue=invocations \
  --set cosmos.endpoint="$(terraform output -raw agent_runtime_cosmos_endpoint)" \
  --set keyVault.uri="$(terraform output -raw key_vault_uri)" \
  --set provider.default=azure-openai \
  --set provider.azureOpenAI.endpoint="$AZURE_OPENAI_ENDPOINT" \
  --set provider.azureOpenAI.deployment=gpt-4o
```

## Image expectations

The container should:

1. Run as user `10001` (non-root, matches the pod securityContext)
2. Expose a default command that boots the agent loop from `@agent-mesh/runtime-agent` (when published)
3. Expose `node /app/dist/dlq-handler.js` for the DLQ subcommand
4. Mount `/tmp` as the only writable path (`readOnlyRootFilesystem: true`)

A reference Dockerfile lives at `examples/reference-app/agents/triage/Dockerfile` (lands in M6).

## KEDA scaler

The `ScaledObject` polls the Service Bus queue depth every 15s. Each replica handles up to `servicebus.messageCountPerReplica` (default 10) messages. Scale up is aggressive (sub-minute reaction); scale-down has a 60s cooldown to avoid thrashing on bursty traffic.

For long-running batch agents, set `minReplicaCount: 1` so a worker is always warm.

## DLQ handler

When a message is dead-lettered (lock expired N times, body shape failed validation, etc.), it lands in `<queue>/$DeadLetterQueue`. The DLQ handler Deployment consumes from there continuously (always `replicas: 1`) and emits a Datadog event for each dead-letter so the on-call gets notified out-of-band from any monitor that fires on queue depth.

Disable with `--set dlqHandler.enabled=false` if you handle DLQs elsewhere.
