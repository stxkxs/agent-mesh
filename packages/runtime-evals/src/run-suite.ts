import { createHash } from 'node:crypto';

import { DefaultAzureCredential } from '@azure/identity';
import { BlobServiceClient } from '@azure/storage-blob';

import { aggregate, type ScoreResult, type Scorer } from './scorers.js';

/**
 * One eval case. Caller supplies the shape; the runner is generic over
 * input/output types but doesn't import them.
 */
export interface EvalCase {
  readonly id: string;
  readonly input: unknown;
  readonly [extraField: string]: unknown;
}

export interface Agent<I, O> {
  readonly id: string;
  invoke(input: I): Promise<O>;
}

export interface RunSuiteOptions<I, O, C extends EvalCase = EvalCase> {
  readonly suiteName: string;
  readonly cases: readonly C[];
  readonly agent: Agent<I, O>;
  readonly scorers: readonly Scorer<C>[];
  /** Per-case timeout. Default 60s. */
  readonly perCaseTimeoutMs?: number;
  /**
   * Blob container URL to write the report to (e.g. `https://<sa>.blob.core.windows.net/eval-results`).
   * When set, the report lands at `runs/<suite>/<runId>.json`.
   */
  readonly resultsContainerUrl?: string;
  /** Optional metrics emitter for the EvalScore signal. */
  readonly metricsEmit?: (worstScore: number, suiteName: string, agentId: string) => void;
}

export interface CaseResult {
  readonly id: string;
  readonly scores: readonly ({ scorer: string } & ScoreResult)[];
  readonly aggregate: ScoreResult;
  readonly durationMs: number;
  readonly error: string | undefined;
}

export interface SuiteReport {
  readonly suite: string;
  readonly agentId: string;
  readonly runId: string;
  readonly startedAt: string;
  readonly durationMs: number;
  readonly caseCount: number;
  readonly aggregate: ScoreResult;
  readonly cases: readonly CaseResult[];
}

const withTimeout = async <T>(p: Promise<T>, ms: number, label: string): Promise<T> =>
  Promise.race([
    p,
    new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error(`${label} timed out after ${ms}ms`)), ms),
    ),
  ]);

/**
 * Run an eval suite end-to-end:
 *
 *   1. For each case, call `agent.invoke(case.input)` with the timeout.
 *   2. Apply every scorer to the result, collect per-scorer scores, aggregate.
 *   3. Aggregate across cases (default mean; min where you regression-gate).
 *   4. If `resultsContainerUrl` is supplied, upload the JSON report.
 *   5. If `metricsEmit` is supplied, emit the worst per-case score so the
 *      Datadog regression monitor fires when one case drops, not just the avg.
 */
export const runSuite = async <I, O, C extends EvalCase>(
  opts: RunSuiteOptions<I, O, C>,
): Promise<SuiteReport> => {
  const startedAt = new Date();
  const startNs = process.hrtime.bigint();
  const runId = `${opts.suiteName}-${startedAt.toISOString().replaceAll(/[:.]/g, '-')}-${createHash(
    'sha256',
  )
    .update(`${startedAt.getTime()}${opts.agent.id}${opts.suiteName}`)
    .digest('hex')
    .slice(0, 8)}`;
  const timeout = opts.perCaseTimeoutMs ?? 60_000;
  const caseResults: CaseResult[] = [];

  for (const c of opts.cases) {
    const caseStart = process.hrtime.bigint();
    let actual: O | undefined;
    let error: string | undefined;
    try {
      actual = await withTimeout(opts.agent.invoke(c.input as I), timeout, `case ${c.id}`);
    } catch (e) {
      error = e instanceof Error ? e.message : String(e);
    }
    const scorerResults: ({ scorer: string } & ScoreResult)[] = [];
    if (error === undefined && actual !== undefined) {
      for (const scorer of opts.scorers) {
        const r = await scorer.score({ actual, case: c });
        scorerResults.push({ scorer: scorer.type, ...r });
      }
    }
    const aggregated = error === undefined ? aggregate(scorerResults) : { score: 0, pass: false };
    const caseDurationMs = Number(process.hrtime.bigint() - caseStart) / 1_000_000;
    caseResults.push({
      id: c.id,
      scores: scorerResults,
      aggregate: aggregated,
      durationMs: Math.round(caseDurationMs),
      error,
    });
  }

  const suiteAggregate = aggregate(caseResults.map((r) => r.aggregate));
  const durationMs = Number(process.hrtime.bigint() - startNs) / 1_000_000;

  const report: SuiteReport = {
    suite: opts.suiteName,
    agentId: opts.agent.id,
    runId,
    startedAt: startedAt.toISOString(),
    durationMs: Math.round(durationMs),
    caseCount: opts.cases.length,
    aggregate: suiteAggregate,
    cases: caseResults,
  };

  // Worst-case score for the regression alarm
  if (opts.metricsEmit !== undefined) {
    const minScore =
      caseResults.length > 0 ? Math.min(...caseResults.map((c) => c.aggregate.score)) : 0;
    opts.metricsEmit(minScore, opts.suiteName, opts.agent.id);
  }

  // Blob upload
  if (opts.resultsContainerUrl !== undefined) {
    const cred = new DefaultAzureCredential();
    // Container URL → split into account + container
    const m = opts.resultsContainerUrl.match(/^(https:\/\/[^/]+)\/([^/?]+)/);
    if (m !== null && m[1] !== undefined && m[2] !== undefined) {
      const service = new BlobServiceClient(m[1], cred);
      const container = service.getContainerClient(m[2]);
      const blob = container.getBlockBlobClient(`runs/${opts.suiteName}/${runId}.json`);
      const body = JSON.stringify(report, null, 2);
      await blob.upload(body, body.length, {
        blobHTTPHeaders: { blobContentType: 'application/json' },
      });
    }
  }

  return report;
};

/**
 * Default `metricsEmit` — writes a structured log line that the OTel
 * Collector forwards to Datadog as a custom metric. Callers can replace
 * this with their own emitter (OTel SDK direct, Powertools, etc.).
 */
export const emitEvalScoreViaLog = (
  worstScore: number,
  suiteName: string,
  agentId: string,
): void => {
  console.warn(
    JSON.stringify({
      level: 'info',
      service: 'agent-mesh',
      message: 'agent_mesh.eval.score',
      'agent_mesh.eval.suite': suiteName,
      'agent_mesh.eval.agent': agentId,
      'agent_mesh.eval.worst_score': worstScore,
    }),
  );
};
