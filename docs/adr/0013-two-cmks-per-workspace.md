# ADR-0013 — Two Customer-Managed Keys per workspace (data + logs)

**Status:** accepted · 2026-05-12

## Context

A workspace produces two kinds of encrypted-at-rest material:

1. **Data** — model I/O, idempotency records, batch payloads, MCP scratch, eval inputs. Touching the plaintext here would let a reader reconstruct prompts, completions, tool outputs, and tenant data.
2. **Logs/audit** — call events, redaction summaries, eval scores, kill-switch engage/disengage records, Datadog forwarding. Touching the plaintext here lets a reader see _what happened_ and _who triggered it_, but not the underlying conversation payloads (those are already redacted by the guardrail stack before they land here).

The principal that legitimately needs to _audit_ the workspace must read the second set without ever being able to read the first. With a single CMK, the auditor either sees everything (no separation of duties) or nothing (no auditability) — neither is acceptable.

We considered:

- **Single CMK, ABAC on the principal** — fragile; an auditor with `Key Vault Crypto User` on the only key can decrypt data blobs by reaching into the storage path directly. ABAC doesn't compose well with the Storage Blob Data role assignments needed for log delivery.
- **Single CMK + envelope encryption layer on top of data** — adds a second key-management surface the platform now owns. We already have one (Key Vault). Adding a custom envelope is operational overhead without buying anything Key Vault doesn't already give us.
- **Two CMKs, role-scoped** — clean separation: the auditor role gets `Key Vault Crypto Service Encryption User` on the _logs_ key only. Decrypting any data resource requires the data key, which the auditor role doesn't have. Separation of duties enforced at the IAM layer, not at the application layer.

## Decision

**Each workspace provisions two Key Vault CMKs:**

| Key        | Encrypts                                                                                        | Granted to                                                          |
| ---------- | ----------------------------------------------------------------------------------------------- | ------------------------------------------------------------------- |
| `data-cmk` | ADLS data containers, Cosmos accounts, Service Bus payloads, Key Vault secrets housing API keys | Workspace runtime managed identity (Crypto Service Encryption User) |
| `logs-cmk` | Log Analytics workspace, Datadog forwarder staging, eval-results blob                           | Workspace runtime MI (encrypt-only); Auditor role (decrypt + read)  |

Both keys live in the same workspace Key Vault; the separation is purely at the role-assignment layer. Both rotate annually; both have soft-delete retention of 90 days and purge protection enabled in `soc2-aligned` / `hipaa-aware` presets.

The auditor role is defined in `terraform/modules/workspace/iam.tf` and pinned to `logs-cmk` only — the data-key resource ID never appears in the auditor's role assignments.

## Why two keys is the right line, not three or four

We thought about further splitting (e.g., one key per major data store). The blast radius of a single compromised data-key is "one workspace's data" — which is already the unit we want to bound to. Splitting further would mean N role assignments per workspace runtime MI, which adds rotation complexity without changing the auditor story.

## Consequences

**Positive**

- Auditor principals can investigate incidents (read logs, eval results, kill-switch events) without ever being able to read raw prompts or tool outputs.
- Compliance reviewers can produce evidence that the auditor role is technically prevented from accessing prompt data — not just policy-prevented.
- Key rotation can proceed independently per concern area. A logs-key rotation never touches data-encrypted blobs.

**Negative**

- Two keys means two Key Vault key resources, two rotation schedules, two sets of role assignments per workspace. Modest operational cost.
- New data resources must explicitly choose which key. The workspace module exposes `data_cmk_id` and `logs_cmk_id` outputs to make the choice obvious at the call site.

**Neutral**

- Cost: Key Vault keys are billed per operation, not per key. The doubled count adds no meaningful spend.
