# Runbook — kill-switch disengage

**This is a dual-approval, MFA-gated, audit-logged operation.** Treat it as you would a production database restore.

## Preconditions

- Root-cause analysis from [budget-breach.md](./budget-breach.md) is complete.
- The runaway is confirmed mitigated at the application layer (deploy reverted, agent disabled, etc.).
- Stakeholders have agreed on the budget revision (if any).
- Two operators are available: the executor and the approver.

## Step 1 — Elevate via PIM

The executor activates `agent-mesh-<workspace>-WorkspaceAdmin` (from the `identity` module) via Azure PIM:

1. Azure portal → Privileged Identity Management → My roles → Azure AD groups
2. Activate `agent-mesh-<workspace>-WorkspaceAdmin`
3. Set duration: 1 hour
4. Justification: paste the incident ID + summary
5. If your tenant requires approver workflow: a second approver receives the request and approves through PIM

The activation generates an audit-log entry that survives the credential restoration.

## Step 2 — Restore federated credentials

The cleanest path is to re-run `terraform apply` on the workspace's root module:

```bash
cd terraform/examples/<your-deployment>
terraform plan -out tfplan
# Expect ONLY federated_identity_credential resource(s) to be (re-)created.
# If terraform proposes anything else, STOP and investigate.

terraform apply tfplan
```

The credentials module's `azuread_application_federated_identity_credential` declarations recreate any deleted federated credentials.

## Step 3 — Verify

```bash
APP_ID=$(terraform output -raw workload_identity_client_id)
az ad app federated-credential list --id "$APP_ID" --query '[].{name:name, subject:subject}' -o table
# Expected: 1+ federated credentials matching system:serviceaccount:<ns>:<sa>

# Force a pod to re-mint its token
NAMESPACE=$(terraform output -raw service_account_annotations | jq -r '.["azure.workload.identity/use"]' || echo agent-mesh)
kubectl -n "$NAMESPACE" rollout restart deployment/<your-agent-runtime>

# Watch logs — should see successful Key Vault reads within ~30s
kubectl -n "$NAMESPACE" logs -l app=<your-agent-runtime> --tail=50 -f
```

## Step 4 — Confirm budget guard health

```bash
# Verify the Consumption Budget is still in place
az consumption budget show \
  --budget-name "budget-agent-mesh-<workspace>" \
  --resource-group "$(terraform output -raw resource_group_name)" \
  --query "{amount:amount, current:currentSpend.amount, threshold:notifications}"

# Verify the kill-switch Logic App is still wired (it should be)
LA_ID=$(terraform output -raw kill_switch_logic_app_id || echo)
test -n "$LA_ID" && az resource show --ids "$LA_ID" --query "properties.state" -o tsv
# Expected: Enabled
```

## Step 5 — Postmortem update

Append to the incident postmortem:

- Disengage timestamp
- PIM activation log link (auditor-readable for the next 90 days)
- Whether `monthly_budget_usd` or `kill_switch_threshold_pct` was revised
- Whether the threshold ladder needs tightening (e.g. add a 110% step)

If the budget was raised: file a follow-up to revisit in 30 days — never let a raised budget become permanent without an explicit re-approval.

## Why this is dual-approval

A unilateral disengage by a compromised operator could re-enable spend at unbounded rate. PIM activation requires either MFA + reason (single-actor tenant policies) or MFA + reason + a second approver's click (the more common org policy). Either way, the activation is logged and traceable.

This mirrors claudium's SSM Change Manager dual-approval pattern on the AWS side — same shape, Azure primitives.
