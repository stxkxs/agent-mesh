import type { ZodType } from 'zod';

/**
 * A scorer evaluates one case's actual output against the case's expected
 * shape. Score is `[0, 1]`; `pass` is the binary verdict callers use for
 * regression gating.
 */
export interface ScoreResult {
  readonly score: number;
  readonly pass: boolean;
  readonly details?: Readonly<Record<string, unknown>>;
}

export interface Scorer<C> {
  readonly type: string;
  score(args: { actual: unknown; case: C }): Promise<ScoreResult> | ScoreResult;
}

// ─── exact-match ────────────────────────────────────────────────────────────

export const exactMatchScorer = <C extends { expected: unknown }>(): Scorer<C> => ({
  type: 'exact-match',
  score: ({ actual, case: c }) => {
    const eq = JSON.stringify(actual) === JSON.stringify(c.expected);
    return { score: eq ? 1 : 0, pass: eq };
  },
});

// ─── zod-shape ──────────────────────────────────────────────────────────────

/**
 * Verifies the actual output parses cleanly against a Zod schema. Useful
 * when "did the model produce the right shape" is the only thing you can
 * check (e.g. open-ended summaries where exact match doesn't apply).
 */
export const zodShapeScorer = <C>(schema: ZodType<unknown>): Scorer<C> => ({
  type: 'zod-shape',
  score: ({ actual }) => {
    const r = schema.safeParse(actual);
    return { score: r.success ? 1 : 0, pass: r.success };
  },
});

// ─── word-overlap ───────────────────────────────────────────────────────────

const tokenize = (s: string): Set<string> =>
  new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, ' ')
      .split(/\s+/)
      .filter((t) => t.length > 0),
  );

/**
 * Jaccard word overlap between actual.<field> and case.expectedText.
 * Coarse but cheap; useful for free-text summary similarity.
 */
export const wordOverlapScorer = <C extends { expectedText: string }>(opts: {
  field: string;
  passThreshold?: number;
}): Scorer<C> => ({
  type: 'word-overlap',
  score: ({ actual, case: c }) => {
    const actualText = ((actual as Record<string, unknown>)[opts.field] ?? '') as string;
    const a = tokenize(actualText);
    const b = tokenize(c.expectedText);
    const intersect = [...a].filter((t) => b.has(t)).length;
    const union = new Set([...a, ...b]).size;
    const score = union === 0 ? 0 : intersect / union;
    return { score, pass: score >= (opts.passThreshold ?? 0.5) };
  },
});

// ─── semantic (LLM-as-judge) ────────────────────────────────────────────────

/**
 * Calls a judging callable (typically a Haiku-class model) to score
 * actual vs. expected on semantic similarity. Caller supplies the judge
 * implementation; this scorer just frames the call.
 */
export const semanticScorer = <C extends { expectedText: string }>(opts: {
  field: string;
  judge: (args: { actual: string; expected: string }) => Promise<number>;
  passThreshold?: number;
}): Scorer<C> => ({
  type: 'semantic',
  score: async ({ actual, case: c }) => {
    const actualText = ((actual as Record<string, unknown>)[opts.field] ?? '') as string;
    const score = await opts.judge({ actual: actualText, expected: c.expectedText });
    return { score, pass: score >= (opts.passThreshold ?? 0.7), details: { judge_score: score } };
  },
});

// ─── aggregate ──────────────────────────────────────────────────────────────

/**
 * Combine N ScoreResults into one. Score = arithmetic mean; pass = all
 * inputs pass. Customize via `mode: 'min'` to require the worst case to
 * still clear its threshold (stricter; used for regression gating).
 */
export const aggregate = (
  results: readonly ScoreResult[],
  mode: 'mean' | 'min' = 'mean',
): ScoreResult => {
  if (results.length === 0) return { score: 0, pass: false };
  const scores = results.map((r) => r.score);
  const score =
    mode === 'min' ? Math.min(...scores) : scores.reduce((a, b) => a + b, 0) / scores.length;
  return { score, pass: results.every((r) => r.pass) };
};
