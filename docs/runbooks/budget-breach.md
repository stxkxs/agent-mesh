# Runbook — budget breach

**Trigger:** Action Group fires on the workspace's Consumption Budget breaching the `kill_switch_threshold_pct` (default 120% of `monthly_budget_usd`).

**Severity:** P2 (revenue / cost-control); P1 if the breach is anomalous (cost-anomaly monitor fired too).

**Detect → Triage → Mitigate → Recover → Postmortem**

## Detect

The Action Group page should already be open. Confirm:

- Datadog `[agent-mesh:<workspace>] Spend anomaly detected` is firing (cross-check)
- The kill-switch Logic App run history shows a recent successful invocation (Azure portal → Logic Apps → `la-agent-mesh-<workspace>-killswitch` → Run history)
- Pods in the workspace's namespace are returning 401 from Key Vault — `kubectl logs` should show `AuthenticationFailedException` or similar

## Triage

```bash
# Confirm kill-switch state: list current federated credentials on the workspace app
APP_ID=$(terraform output -raw workload_identity_client_id)
az ad app federated-credential list --id "$APP_ID" --query '[].name' -o tsv
# Expected: empty list (kill-switch engaged)
```

Look at the burn before deciding:

```bash
# What's the actual spend?
RG=$(terraform output -raw resource_group_name)
az consumption usage list --start-date "$(date -u -v1d +%Y-%m-%d)" --end-date "$(date -u +%Y-%m-%d)" \
  --query "[?contains(instanceName, '$RG')].{date:date,name:instanceName,cost:pretaxCost}" -o table | head -50
```

Identify the runaway:

- Datadog → search `agent_mesh.cost_usd by agent_mesh.agent` over the last 4h → top offender
- Synapse Serverless: `cost_reconciliation_emf_vs_cur` view shows date × delta_pct
- AKS → check if a Deployment ramped up replica count unexpectedly

## Mitigate

The kill-switch has already mitigated. Pods can't call providers. Do NOT disengage until you've identified root cause.

If a single agent is at fault, prepare a targeted fix (downscale, kill, code rollback). If it's a tenant-shaped problem (one project's traffic exploded), prepare to disable that tenant's Service Bus subscription only.

## Recover

See [kill-switch-disengage.md](./kill-switch-disengage.md). Recovery is PIM-gated.

## Postmortem

Within 24 hours, capture:

- What was the spending pattern (line graph from Datadog)?
- Was the model selection appropriate? (e.g. Opus where Sonnet would do)
- Did caching help / hurt?
- Was there a code change in the last 7 days that correlates?
- Should the monthly budget be revised, or the threshold ladder tightened?
