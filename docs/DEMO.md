# 5-minute demo

A scripted walkthrough of `examples/reference-app` from clone to "triage agent processing a message end-to-end with audit + cost + redaction visible in Datadog."

Times are wall-clock for a competent operator on a sandbox subscription. First-time runs add ~5 min for Azure resource provisioning.

## 0. Prereqs (one-time)

- Azure subscription with Contributor + User Access Administrator
- Datadog API + APP keys (any tier; LLM Observability product is optional)
- `az`, `terraform`, `helm`, `pnpm` on PATH
- `agent-mesh doctor` reports green

```bash
git clone https://github.com/stxkxs/agent-mesh.git
cd agent-mesh
pnpm install && pnpm --filter @agent-mesh/cli build
pnpm --filter @agent-mesh/cli exec agent-mesh doctor
```

## 1. Provision Azure (90s)

```bash
cd examples/reference-app/terraform
terraform init
terraform apply -auto-approve
```

Outputs you'll need next:

```bash
terraform output -raw resource_group_name
terraform output -raw workload_identity_client_id
terraform output -raw servicebus_namespace
terraform output -raw cosmos_endpoint
terraform output -raw datadog_dashboard_url
terraform output -raw mcp_gateway_url
```

## 2. Grant the kill-switch Graph permission (one-time, 10s)

```bash
terraform output -raw kill_switch_post_apply_steps | bash
```

## 3. Drop the Anthropic key (10s)

```bash
VAULT=$(terraform output -raw key_vault_uri | sed -E 's|https://([^.]+).*|\1|')
az keyvault secret set --vault-name "$VAULT" --name anthropic-key-alpha \
  --value '{"apiKey":"sk-ant-…","issuedAt":"'"$(date -u +%Y-%m-%dT%H:%M:%SZ)"'","rotationGeneration":1}'
```

Azure OpenAI uses Workload Identity directly — no key needed.

## 4. Upload the system prompt (15s)

```bash
PROMPT=$(cat ../prompts/triage-system.v1.mdx)
SHA=$(echo -n "$PROMPT" | sha256sum | cut -d' ' -f1)
BLOB_URL="https://$(terraform output -raw storage_account_name).blob.core.windows.net/prompts/triage-system/${SHA}.mdx"

# Upload the blob (using AAD auth — no SAS, no key)
az storage blob upload \
  --account-name "$(terraform output -raw storage_account_name)" \
  --auth-mode login \
  --container-name prompts \
  --name "triage-system/${SHA}.mdx" \
  --file ../prompts/triage-system.v1.mdx

# Set the App Configuration pointer
APPCS=$(terraform output -raw appconfig_endpoint)
az appconfig kv set --endpoint "$APPCS" --auth-mode login \
  --key "agent-mesh/prompts/triage-system/current" \
  --value "{\"url\":\"$BLOB_URL\",\"sha256\":\"$SHA\"}" \
  --yes
```

## 5. Deploy the MCP server + triage agent (60s)

```bash
# Build + push the MCP image
cd ../mcp-servers/filesystem-readonly
docker build -t "$ACR.azurecr.io/mcp-filesystem-readonly:demo" .
docker push "$ACR.azurecr.io/mcp-filesystem-readonly:demo"

helm install filesystem ../../../charts/mcp-server \
  --namespace mcp --create-namespace \
  --set workspace="$(terraform -chdir=../../terraform output -raw resource_group_name | sed 's/rg-agent-mesh-//')" \
  --set project=alpha \
  --set name=filesystem-readonly \
  --set image.repository="$ACR.azurecr.io/mcp-filesystem-readonly" \
  --set image.tag=demo

# Build + push the agent image (your Dockerfile bundles agents/triage/)
docker build -t "$ACR.azurecr.io/agent-triage:demo" -f Dockerfile.triage ../../
docker push "$ACR.azurecr.io/agent-triage:demo"

helm install triage ../../../charts/agent-runtime \
  --namespace agent-mesh --create-namespace \
  --set workspace=agent-mesh-reference \
  --set project=alpha \
  --set agentId=triage \
  --set workloadIdentity.clientId="$(terraform -chdir=../../terraform output -raw workload_identity_client_id)" \
  --set workloadIdentity.tenantId="$(az account show --query tenantId -o tsv)" \
  --set image.repository="$ACR.azurecr.io/agent-triage" \
  --set image.tag=demo \
  --set servicebus.namespace="$(terraform -chdir=../../terraform output -raw servicebus_namespace)" \
  --set servicebus.queue=invocations \
  --set cosmos.endpoint="$(terraform -chdir=../../terraform output -raw cosmos_endpoint)" \
  --set provider.default=azure-openai \
  --set provider.azureOpenAI.endpoint="$AZURE_OPENAI_ENDPOINT" \
  --set provider.azureOpenAI.deployment=gpt-4o
```

## 6. Send a test message (5s)

```bash
SBNS=$(terraform -chdir=../../terraform output -raw servicebus_namespace)
az servicebus message send \
  --namespace-name "$(echo $SBNS | cut -d. -f1)" \
  --queue-name invocations \
  --body '{
    "correlationId": "demo-001",
    "sender": { "email": "ops-relay" },
    "body": "URGENT: production checkout is returning 503 errors for 100% of requests since 14:32 UTC. Need engineering response."
  }'
```

## 7. Watch the dashboard (60s of observation)

```bash
open "$(terraform -chdir=../../terraform output -raw datadog_dashboard_url)"
```

Look for:

- **Row 1 (Volume)**: One call appears within ~5s
- **Row 2 (Performance)**: p99 latency 2-5s for gpt-4o; cache hit rate 0% on first call
- **Row 4 (Cost)**: USD/min jumps; total spend ~$0.001 for the test call
- **Row 5 (Compliance)**: One outbound redaction (the `ops-relay` sender field if redaction caught it)

## 8. Query the audit trail (30s)

```bash
SYNAPSE=$(terraform -chdir=../../terraform output -raw audit_synapse_sql_endpoint)
echo "Connect Azure Data Studio to: $SYNAPSE"
echo "Run this query:"
echo
terraform -chdir=../../terraform output -raw audit_query_starter
```

Expected output: one row, `workspace=agent-mesh-reference, provider=azure-openai, model=gpt-4o, total_tokens_in=~120, total_tokens_out=~40, total_cost_usd≈$0.001`.

## 9. Run the eval suite (60s)

```bash
cd ../../evals/triage-quality
pnpm tsx run.ts  # operator-supplied runner that wires runSuite() against the handler
```

Expected: 8/8 cases pass. Worst-case score logged to stdout as `agent_mesh.eval.worst_score`; Datadog ingests it within ~30s. The injection-attempt and PII-payload cases prove layers 3 and 5 of the guardrail stack are firing.

## 10. Exercise the kill-switch (optional, ~3 min)

```bash
# Lower the budget to force a breach
terraform -chdir=../../terraform apply -auto-approve -var monthly_budget_usd=1

# Send 200 messages to spike cost
for i in $(seq 1 200); do
  az servicebus message send --namespace-name ... --queue-name invocations \
    --body '{...}'
done

# Within ~24h (Azure Budget refresh cadence), the kill-switch fires:
APP_ID=$(terraform output -raw workload_identity_client_id)
az ad app federated-credential list --id "$APP_ID" --query '[].name' -o tsv
# Expected: empty list

# Recover via docs/runbooks/kill-switch-disengage.md
```

## What just happened (the elevator pitch)

In ~5 minutes, we stood up:

- A workspace with two CMKs (data + logs), CMK-encrypted Storage, public network disabled everywhere
- An AAD app + federated credential the triage pod uses to mint AAD tokens — no client secrets anywhere
- A VNet with Private Endpoints for every Azure service the workload touches
- Six scoped AAD groups — Auditor reads audit metadata but can't decrypt the model data
- An audit pipeline shipping every CallEvent to ADLS with a SQL endpoint over it
- A Datadog dashboard + 9 monitors covering latency, cost, errors, cache hit rate, audit lag
- A budget with five-step notifications + a Logic App kill-switch
- Service Bus + Cosmos for KEDA-driven scale + idempotency
- An Application Gateway v2 + WAF v2 fronting MCP servers
- A triage agent that processed a message with 5-layer guardrails + tools + Zod-validated output + per-call cost telemetry

Replace the demo with your workload's actual prompt + tools + eval suite, and the same primitives carry you to production.
