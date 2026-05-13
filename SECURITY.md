# Security

## Threat model

agent-mesh is the platform layer for LLM agent workloads on AKS. The primary assets are:

- **Provider API keys** — Anthropic key, Azure OpenAI key (when not using AAD-only)
- **Workspace KMS material** — two CMKs (data + logs) protecting Storage, Service Bus, Cosmos, and Log Analytics
- **Audit trail** — every model call's CallEvent record, stored in ADLS with optional Object Lock
- **Tenant identity scope** — the AAD application + Service Principal per (workspace, project)

The primary threat actors:

1. **Compromised pod** — RCE in an agent or MCP server lets the attacker exfiltrate via Key Vault or call the provider on the tenant's dime.
2. **Compromised CI** — a malicious PR or a token leak in a runner could re-plan Terraform with attacker-controlled module sources.
3. **Provider compromise** — Anthropic / Microsoft itself is breached. We can't prevent it, but we can constrain the blast radius.
4. **Insider** — a developer with workspace access tries to exfiltrate via prompt injection of a different tenant's data through a shared MCP server.

## Defenses by asset

### Provider API keys

- Never in environment variables or Kubernetes manifests. Key Vault only.
- Workload Identity is the only access path (`shared_access_key_enabled = false` on Storage too).
- Adapter caches the resolved key in process memory only.
- Rotation is human-managed via the `rotation_period_days` tag — the (not-yet-shipped) rotation runbook in `docs/runbooks/` polls and notifies.

### KMS material

- Two CMKs per workspace (data + logs). Auditor role decrypts logs CMK only; never the data CMK.
- Annual key rotation, 30 days pre-expiry notification.
- Purge protection enabled for `iso27001-aligned` and `hipaa-aware` presets — keys are irrecoverable once purged.

### Audit trail

- ADLS container with optional Object Lock (M2+ in `audit` module).
- Encrypted at rest with `cmk-logs`.
- Public network access denied. Workload Identity only.

### Tenant identity

- One AAD app per (workspace, project) — least privilege scoped to that scope's resources.
- Federated identity credential is locked to a specific `system:serviceaccount:<ns>:<sa>` subject. A different namespace or SA cannot impersonate.

## What agent-mesh does NOT defend against

- **Prompt injection across tenants via a shared MCP server**: shared MCP backends introduce a side channel. Use per-tenant MCP deployments (the `mcp` module's default in M4) unless you've reviewed the MCP server's input validation.
- **Application-layer bugs in your agent code**: agent-mesh defends the platform, not your business logic. A poorly written tool that returns secrets to the model will leak them — the guardrail proxy (M5) helps but isn't a substitute.
- **Provider-side compromise**: Anthropic / Microsoft is outside our trust boundary. If they're breached, your audit trail will at least tell you when and what.
- **DoS against Datadog ingestion**: a runaway agent that loops can blow your DD bill. Budget guards (M3) cap spend, but DD ingestion costs are operator-monitored.

## Reporting a vulnerability

Email <[email protected]> with details. We acknowledge within 48 hours and publish a CVE for any confirmed platform-layer issue. We use the [GitHub Security Advisories](https://github.com/stxkxs/agent-mesh/security) flow for coordinated disclosure.

Do **not** open a public issue for a vulnerability report.
