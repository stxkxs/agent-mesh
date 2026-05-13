# Runbook — kill-switch disengage

**Trigger:** A workspace's kill-switch has previously fired (see [budget-breach.md](./budget-breach.md)), root-cause is identified and remediated, and stakeholders have agreed to restore the workspace's ability to mint provider tokens.

**Severity:** P2 (service-restoration); kill-switch state itself is not an incident — leaving it engaged longer than necessary is.

**This is a dual-approval, MFA-gated, audit-logged operation.** Treat it as you would a production database restore.

**Detect → Triage → Mitigate → Recover → Postmortem**

## Detect

You're reading this runbook because you've decided to disengage. Re-confirm the workspace is actually in kill-switch state before proceeding:

```bash
APP_ID=$(terraform output -raw workload_identity_client_id)
az ad app federated-credential list --id "$APP_ID" --query '[].name' -o tsv
# Expected: empty list (kill-switch engaged). If non-empty, the workspace is
# already healthy — stop and investigate why this runbook was opened.
```

Cross-reference the Logic App run history (Azure portal → Logic Apps → `la-agent-mesh-<workspace>-killswitch` → Run history) to find the engage timestamp and operator-of-record.

## Triage

Verify the preconditions for safe disengage. **All four must hold** — if any is false, stop here and return to root-cause work:

- Root-cause analysis from [budget-breach.md](./budget-breach.md) is complete and attached to the incident record.
- The runaway is confirmed mitigated at the application layer (deploy reverted, agent disabled, tenant traffic capped, etc.).
- Stakeholders have agreed on the budget revision (if any) and the incident-driver has signed off.
- Two operators are available: the executor and the PIM approver (per tenant policy).

## Mitigate

Mitigation here is _authorization_, not service-restoration. Without PIM elevation, the disengage cannot proceed — that's the dual-approval property.

The executor activates `agent-mesh-<workspace>-WorkspaceAdmin` (from the `identity` module) via Azure PIM:

1. Azure portal → Privileged Identity Management → My roles → Azure AD groups
2. Activate `agent-mesh-<workspace>-WorkspaceAdmin`
3. Set duration: 1 hour
4. Justification: paste the incident ID + summary
5. If your tenant requires approver workflow: a second approver receives the request and approves through PIM

The activation generates an audit-log entry that survives the credential restoration. A unilateral disengage by a compromised operator could re-enable spend at unbounded rate — PIM activation is the technical control that prevents it.

## Recover

Restore the federated credentials and verify the workspace is healthy.

**1. Restore federated credentials.** The cleanest path is to re-run `terraform apply` on the workspace's root module:

```bash
cd terraform/examples/<your-deployment>
terraform plan -out tfplan
# Expect ONLY federated_identity_credential resource(s) to be (re-)created.
# If terraform proposes anything else, STOP and investigate.

terraform apply tfplan
```

The credentials module's `azuread_application_federated_identity_credential` declarations recreate any deleted federated credentials.

**2. Verify credentials + pod health.**

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

**3. Confirm budget guard is still wired.**

```bash
az consumption budget show \
  --budget-name "budget-agent-mesh-<workspace>" \
  --resource-group "$(terraform output -raw resource_group_name)" \
  --query "{amount:amount, current:currentSpend.amount, threshold:notifications}"

LA_ID=$(terraform output -raw kill_switch_logic_app_id || echo)
test -n "$LA_ID" && az resource show --ids "$LA_ID" --query "properties.state" -o tsv
# Expected: Enabled
```

If the budget was raised during triage: the Logic App is still pointed at the (new, higher) threshold. Confirm the threshold is what you expect.

## Postmortem

Within 24 hours, append to the incident postmortem:

- Disengage timestamp and the PIM activation log link (auditor-readable for the next 90 days)
- Whether `monthly_budget_usd` or `kill_switch_threshold_pct` was revised
- Whether the threshold ladder needs tightening (e.g. add a 110% step)
- Time-in-kill-switch (engage timestamp → disengage timestamp): the SLO target is < 4h business-hours

If the budget was raised: file a follow-up to revisit in 30 days — never let a raised budget become permanent without an explicit re-approval.
