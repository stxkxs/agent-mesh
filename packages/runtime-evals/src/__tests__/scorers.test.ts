import { describe, expect, it } from 'vitest';
import { z } from 'zod';

import {
  aggregate,
  exactMatchScorer,
  semanticScorer,
  wordOverlapScorer,
  zodShapeScorer,
} from '../scorers.js';

describe('scorers', () => {
  it('exact-match returns 1 on equal JSON, 0 otherwise', async () => {
    const s = exactMatchScorer<{ expected: unknown }>();
    expect((await s.score({ actual: { a: 1 }, case: { expected: { a: 1 } } })).score).toBe(1);
    expect((await s.score({ actual: { a: 1 }, case: { expected: { a: 2 } } })).score).toBe(0);
  });

  it('zod-shape passes when actual parses cleanly', async () => {
    const schema = z.object({ priority: z.enum(['low', 'high']) });
    const s = zodShapeScorer(schema);
    expect((await s.score({ actual: { priority: 'high' }, case: {} })).score).toBe(1);
    expect((await s.score({ actual: { priority: 'mid' }, case: {} })).score).toBe(0);
  });

  it('word-overlap computes Jaccard similarity', async () => {
    const s = wordOverlapScorer<{ expectedText: string }>({
      field: 'summary',
      passThreshold: 0.5,
    });
    const r = await s.score({
      actual: { summary: 'production is down for billing' },
      case: { expectedText: 'production billing is currently down' },
    });
    expect(r.score).toBeGreaterThan(0.5);
    expect(r.pass).toBe(true);
  });

  it('semantic scorer routes through the supplied judge', async () => {
    const s = semanticScorer<{ expectedText: string }>({
      field: 'summary',
      judge: async () => 0.85,
      passThreshold: 0.7,
    });
    const r = await s.score({
      actual: { summary: 'about right' },
      case: { expectedText: 'expected summary' },
    });
    expect(r.score).toBe(0.85);
    expect(r.pass).toBe(true);
    expect(r.details).toEqual({ judge_score: 0.85 });
  });

  it('aggregate mean averages scores; pass requires all pass', () => {
    const r = aggregate([
      { score: 1, pass: true },
      { score: 0.5, pass: false },
    ]);
    expect(r.score).toBeCloseTo(0.75);
    expect(r.pass).toBe(false);
  });

  it('aggregate min returns the worst case', () => {
    const r = aggregate(
      [
        { score: 1, pass: true },
        { score: 0.2, pass: false },
      ],
      'min',
    );
    expect(r.score).toBe(0.2);
  });
});
