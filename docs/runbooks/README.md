# Runbooks

Operator-side procedures referenced by Datadog monitor messages, GitHub Actions step summaries, and the terraform module READMEs.

| Runbook                                                | Triggered by                                                        |
| ------------------------------------------------------ | ------------------------------------------------------------------- |
| [budget-breach.md](./budget-breach.md)                 | Consumption Budget hits the kill-switch threshold (default 120%).   |
| [kill-switch-disengage.md](./kill-switch-disengage.md) | Operator restoring access after a budget breach has been mitigated. |

Format: Detect → Triage → Mitigate → Recover → Postmortem. Each runbook is short enough to read on a phone at 3am.

Future runbooks land here as M4-M6 work surfaces new failure modes — latency spikes, MCP gateway outages, cache poisoning, audit pipeline lag, key rotation failures, eval regressions, DLQ redrive.
