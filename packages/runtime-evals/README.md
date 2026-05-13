# @agent-mesh/runtime-evals

Eval suite runner + 4 built-in scorers (exact-match, zod-shape, word-overlap, semantic). `runSuite` orchestrates per-case execution with timeouts, applies the configured scorers, aggregates, and optionally:

- uploads the JSON report to Blob Storage
- emits the **worst-case** score as `agent_mesh.eval.worst_score` so the Datadog regression monitor fires when any one case regresses, not just the average

```ts
import {
  runSuite,
  exactMatchScorer,
  zodShapeScorer,
  emitEvalScoreViaLog,
} from '@agent-mesh/runtime-evals';
import { z } from 'zod';

interface TriageCase {
  id: string;
  input: { body: string };
  expected: { priority: 'low' | 'medium' | 'high' };
}

const cases: TriageCase[] = await loadCasesFromDisk('evals/triage/cases');

const TriageOutput = z.object({ priority: z.enum(['low', 'medium', 'high']) });

const report = await runSuite({
  suiteName: 'triage-quality',
  cases,
  agent: { id: 'triage', invoke: async (input) => triageHandler(input) },
  scorers: [exactMatchScorer<TriageCase>(), zodShapeScorer<TriageCase>(TriageOutput)],
  perCaseTimeoutMs: 30_000,
  resultsContainerUrl: 'https://amplatform.blob.core.windows.net/eval-results',
  metricsEmit: emitEvalScoreViaLog,
});

console.log(`worst case: ${Math.min(...report.cases.map((c) => c.aggregate.score))}`);
```

## Scorers

| Type           | Pass condition                                             | Use when                                                                                               |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------------------------------------------------ |
| `exact-match`  | `JSON.stringify(actual) === JSON.stringify(case.expected)` | Output is structured and small (priorities, classifications, IDs).                                     |
| `zod-shape`    | Actual parses against the supplied Zod schema              | "Did the model produce the right shape?" — useful when the value is free-form but the structure isn't. |
| `word-overlap` | Jaccard similarity ≥ passThreshold (default 0.5)           | Free-text summaries where exact match is unreasonable but you want some signal.                        |
| `semantic`     | LLM-as-judge score ≥ passThreshold (default 0.7)           | Highest-fidelity but costs API calls per case. Wrap a Haiku-class model.                               |

Compose multiple scorers — `aggregate` computes mean (or min if you regression-gate). The runner records every scorer's individual score per case for postmortem analysis.

## What regression-gating looks like

```yaml
# .github/workflows/eval.yml
- name: Run triage eval
  run: pnpm tsx evals/triage/run.ts
- name: Block on regression
  run: |
    WORST=$(jq -r '.aggregate.score' eval-report.json)
    BASELINE=$(jq -r '.aggregate.score' eval-baseline.json)
    if awk "BEGIN { exit !($WORST < $BASELINE - 0.05) }"; then
      echo "::error::Eval score regressed: $WORST < $BASELINE - 0.05"
      exit 1
    fi
```

The Datadog `[agent-mesh:<workspace>] Eval score regressed` monitor (from `terraform/modules/observability`) fires on the same signal.
