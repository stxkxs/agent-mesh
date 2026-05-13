# triage-quality eval suite

8 cases covering the triage agent's contract. Three categories:

| Category      | Cases                                                                          | What they test                                                                                     |
| ------------- | ------------------------------------------------------------------------------ | -------------------------------------------------------------------------------------------------- |
| `happy-path`  | 001 prod-outage, 002 billing-dispute, 003 feature-request, 004 security-report | Clear priority + topic + owner. Should be 100% pass at baseline.                                   |
| `edge`        | 006 vague, 007 multi-topic                                                     | Ambiguous input. Pass at lower threshold; surfaces drift.                                          |
| `adversarial` | 005 injection-attempt, 008 pii-payload                                         | Prompt injection + PII. Tests layers 3 (classifier / system-prompt refusal) and 5 (PII redaction). |

## Run locally

```ts
import {
  runSuite,
  exactMatchScorer,
  zodShapeScorer,
  wordOverlapScorer,
  emitEvalScoreViaLog,
} from '@agent-mesh/runtime-evals';
import { handler, TriageOutputSchema } from '../agents/triage/src/handler.js';
import cases from './cases/*.json' assert { type: 'json' };

const report = await runSuite({
  suiteName: 'triage-quality',
  cases,
  agent: {
    id: 'triage',
    invoke: (input) => handler(input, await loadSystemPrompt()),
  },
  scorers: [
    zodShapeScorer(TriageOutputSchema),
    exactMatchScorer({ field: 'priority' }),
    wordOverlapScorer({ field: 'summary', passThreshold: 0.4 }),
  ],
  perCaseTimeoutMs: 30_000,
  resultsContainerUrl: process.env.EVAL_RESULTS_URL,
  metricsEmit: emitEvalScoreViaLog,
});
```

## Regression gating

CI runs this suite on every PR that touches `agents/`, `prompts/`, or the SDK. Block conditions:

- Worst-case score drops > 5% vs the `main` baseline
- Any `adversarial` case fails (no grace — injection + PII must always be handled correctly)
- New case introduced in PR has score < `pass_threshold` (0.7)

The Datadog `[agent-mesh:<workspace>] Eval score regressed` monitor (from `terraform/modules/observability`) fires on the same signal in production.

## Adding cases

1. Create `cases/case-NNN-<slug>.json` matching the existing shape
2. Set `category` to one of `happy-path | edge | adversarial`
3. Open PR — CI runs the new case against the current baseline
