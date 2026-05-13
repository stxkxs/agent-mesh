# ADR-0004 — Workload Identity, no client secrets

**Status:** accepted · 2026-05-12

## Context

Pods on AKS need to reach Key Vault (for provider API keys), Storage (for skill bundles, eval results, audit logs), Service Bus (for queue work), and Cosmos (for idempotency state). The "easy" path is a long-lived service principal credential (`client_id` + `client_secret` in a Kubernetes Secret), but it's also the path that produces the bulk of post-incident retros titled "service principal credential leaked to a git history."

Microsoft ships **Azure AD Workload Identity** as the AKS-native replacement. Federated credentials trust the AKS OIDC issuer for specific `system:serviceaccount:<ns>:<sa>` subjects; pods exchange their projected SA token for an AAD access token via the Workload Identity webhook. There are no client secrets at any point in the chain.

## Decision

**No client secrets. Ever.** Every agent-mesh-vended Azure identity uses Workload Identity federation:

- `terraform/modules/credentials` creates one AAD application + service principal per `(workspace, project)`.
- A federated identity credential trusts the AKS OIDC issuer for a specific ServiceAccount in a specific namespace.
- The SP gets exactly the roles it needs — `Key Vault Secrets User` on the workspace vault, and (downstream modules) `Storage Blob Data Contributor` on specific containers.

For Anthropic, the API key sits in Key Vault and the adapter fetches it on cold start using `DefaultAzureCredential` → `WorkloadIdentityCredential` → Key Vault.

For Azure OpenAI, we skip the API key entirely — `DefaultAzureCredential` reaches Cognitive Services with the AAD token directly.

CI/CD runners use the same pattern: GitHub Actions OIDC → Azure federated credential → no PAT, no service principal secret.

## Consequences

**Positive**

- The blast radius of a compromised pod is the SP's specific role assignments — not all-of-Azure.
- No credential rotation Lambda / cron job — federated tokens are short-lived by design.
- CI ↔ Azure auth uses the same primitive, so the operator story is uniform.

**Negative**

- Workload Identity requires `oidc_issuer_enabled = true` + `workload_identity_enabled = true` on the AKS cluster. Existing clusters need a one-time enable; both are non-disruptive.
- The ServiceAccount annotation (`azure.workload.identity/client-id`) couples the K8s manifest to a specific AAD app. Helm values + Terraform outputs glue this together; the wiring is templated.
- Local dev needs the pod to see the AAD app — developers either deploy a personal-scope ServiceAccount or use `az login` + `EnvironmentCredential` for non-pod testing. Documented in CONTRIBUTING.md.

**Neutral**

- Federated credential audience is `api://AzureADTokenExchange` (Workload Identity convention). We pin this.

## References

- [Azure AD Workload Identity for Kubernetes](https://azure.github.io/azure-workload-identity/)
- [DefaultAzureCredential resolution order](https://learn.microsoft.com/azure/developer/javascript/sdk/credential-chains)
