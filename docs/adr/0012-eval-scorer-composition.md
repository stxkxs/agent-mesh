# ADR-0012 — Eval scorer composition

**Status:** accepted · 2026-05-12

## Context

Eval gating in CI needs a numeric pass/fail signal that aggregates well across cases of mixed difficulty. The two extremes:

1. **Single scorer** — fast, simple, but maps everything to one number. Exact-match is too strict for free-text; semantic-only is expensive at scale.
2. **Custom scoring per case** — most accurate but unmaintainable. Each case needs hand-written logic; reviewers can't tell at-a-glance what threshold any test enforces.

The middle ground is **composable scorers**: a small set of well-defined primitives that each return `{score: number ∈ [0,1], pass: boolean}`, applied per-case, then aggregated.

## Decision

agent-mesh ships **4 built-in scorers** in `@agent-mesh/runtime-evals/scorers`:

| Type           | Pass condition                                             | Use when                                                     |
| -------------- | ---------------------------------------------------------- | ------------------------------------------------------------ |
| `exact-match`  | `JSON.stringify(actual) === JSON.stringify(case.expected)` | Structured output, small enums (priorities, classifications) |
| `zod-shape`    | Actual parses against the supplied Zod schema              | "Right shape, free-form content"                             |
| `word-overlap` | Jaccard similarity ≥ `passThreshold` (default 0.5)         | Free-text summaries                                          |
| `semantic`     | LLM-as-judge ≥ `passThreshold` (default 0.7)               | Highest fidelity, costs API calls                            |

Each case is scored by **N scorers**; per-case scores are `aggregate()`d to one number. Suite-level aggregation defaults to `mean` (average across cases) but supports `min` for strict regression gating.

The runner emits the **worst per-case score** as the OTel signal that drives the Datadog `EvalScoreRegression` monitor — so a single regressed case is visible, not averaged away.

## Why these 4

- **exact-match**: covers ~60% of structured outputs (classification, routing, priority)
- **zod-shape**: covers "the model produced something parseable" — useful as a cheap floor
- **word-overlap**: cheap free-text signal — bad alone but useful as a regression detector ("similarity dropped 30% week over week")
- **semantic**: expensive but the only viable scorer for nuanced free-form outputs (summaries, reasoning quality)

Not built in:

- **BLEU/ROUGE** — popular but score = 0.X with no actionable threshold; superseded by semantic
- **Embeddings cosine** — needs an embedding model + an additional service call; LLM-as-judge gets you the same signal in one call with explanation built-in
- **Regex match** — a special case of `exact-match` on a string field; callers can write a custom scorer in 5 lines

## Composability

`Scorer<C>` is an interface; custom scorers can implement it directly:

```ts
const myScorer: Scorer<MyCase> = {
  type: 'my-custom',
  score: ({ actual, case: c }) => ({ score: ..., pass: ... }),
};

await runSuite({ ..., scorers: [exactMatchScorer(), myScorer] });
```

Aggregation modes (`mean` / `min`) cover the common regression-gating cases. Workloads that need a weighted mean can flatten the suite into per-scorer-weighted ScoreResults and re-aggregate manually.

## Consequences

**Positive**

- Clear scorer taxonomy — reviewers can tell at-a-glance what's gating
- Worst-case emission means single-test regressions don't get averaged away
- Custom scorers are 5-line additions, not framework-level changes

**Negative**

- Semantic scorer costs API calls. At 100 cases × $0.001/call, that's $0.10 per eval run — meaningful at high cadence
- LLM-as-judge has its own quality drift; pin the judge model (e.g. `claude-haiku-4-5`) and re-validate periodically

**Neutral**

- The 4-scorer set covers most use cases; we'll add more if a workload hits a real need
