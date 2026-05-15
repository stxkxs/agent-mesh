# ADR-0011 — 5-layer guardrail stack

**Status:** accepted · 2026-05-12

## Context

LLM agents accept untrusted user input, call external tools, and produce structured output that downstream code consumes. Three failure modes dominate post-incident retros:

1. **Prompt injection** — user input convinces the model to ignore the system prompt
2. **Tool-output trust** — a compromised or buggy MCP server returns malformed output that the model then propagates
3. **Output-shape drift** — the model produces free-text where structured data was expected, and consumers parse it loosely

Single-layer defenses (just a classifier, just Zod, just PII regex) leave gaps. The OWASP LLM Top-10 effectively recommends layered defense, but doesn't prescribe specific layers.

## Decision

agent-mesh implements **five independent layers** across `@agent-mesh/runtime-agent` and `@agent-mesh/runtime-guardrails`:

| #   | Name                              | Lives in                                   | Defends against                                                                                                                            |
| --- | --------------------------------- | ------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------ |
| 1   | **Input validation**              | `processInput`                             | Schema-mismatch attacks (extra fields, malformed shapes). Zod against the application's input schema.                                      |
| 2   | **Tool-output egress**            | `runtime-agent.runAgent`                   | Compromised tools. Every tool's `egress` Zod schema applied to its output before re-feeding the model.                                     |
| 3   | **Classifier hook**               | `processInput`                             | Direct injection ("ignore prior instructions…"). Optional Haiku-class judge returning `injection_risk` + `off_policy`; > 0.7 throws.       |
| 4   | **Structured-output enforcement** | `runtime-agent.runAgent` + `processOutput` | Free-text refusal. Forces the model to respond via the `submit_final_output` tool whose schema is the JSON projection of `agent.output`.   |
| 5   | **PII redaction** (bidirectional) | `processInput` + `processOutput`           | Tenant data leaking inbound (PII into the model) or outbound (PII into downstream systems). Regex-based with replace / hash / block modes. |

Layer 3 (classifier) is **optional**; the rest are mandatory in the default codepath. Operators with a strict no-extra-API-call posture can skip layer 3 and rely on the others.

## What each layer does NOT cover

- Layer 1 does not detect injection — it just ensures the shape is right
- Layer 2 does not validate tool inputs (that's the binding's `input` schema, applied by the model client SDK)
- Layer 3 catches well-known injection patterns but misses novel ones; treat it as defense-in-depth, not a primary control
- Layer 4 prevents free-text output but not malicious _content_ within the structured shape (a tool-call that exfiltrates secrets via the `summary` field is still possible — pair with layer 5 for outbound redaction)
- Layer 5 is regex-only; sophisticated PII (custom enterprise identifiers, names without surrounding context) requires a classifier or Cognitive Services Detect PII as an additional rule source

## Why 5 and not more

Each additional layer adds latency, cost (if it calls a model), and operator complexity. We considered:

- **Output-side classifier** — same purpose as layer 3 but on the response. Useful when off-policy completions matter; not load-bearing if the structured-output schema is tight. Deferred to a future `output_classifier` opt-in.
- **Retrieval-augmented validation** — re-look-up tool outputs against a trusted source. Use-case-specific; not a platform primitive.
- **Constitutional AI / self-critique loop** — model checks its own output before submitting. Doubles cost; deferred.

## Consequences

**Positive**

- Layered defense reduces the impact of any single bypass
- Each layer has a clear contract (Zod schema, classifier function, regex set) — easy to audit
- Failure modes have specific error codes (`schema_validation`, `prompt_injection`, `guardrail_violation`) callers can branch on
- The default codepath is "all layers on"; opt-out is explicit

**Negative**

- Classifier hook adds ~200-500ms latency per invocation when enabled. Mitigated by keeping it optional and letting workloads disable when the latency budget is tight.
- PII regex has false positives (a phone number in a database ID, a credit-card-looking serial number). Customize the rule set per workload.

**Neutral**

- The fail-closed pepper for layer 5 hash mode is a deliberate trade-off. We'd rather hard-fail on missing config than silently emit raw PII to logs.
