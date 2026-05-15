import {
  GuardrailViolationError,
  PromptInjectionError,
  SchemaValidationError,
} from '@agent-mesh/core/errors';

import { redact, type RedactionMode, type RedactionResult } from './redactor.js';

import type { PIIRule } from './pii-rules.js';
import type { ZodType } from 'zod';

/**
 * Layer markers — what each `processInput` / `processOutput` call covers:
 *
 *   Layer 1 — Input validation (Zod against input schema)
 *   Layer 2 — Tool-output egress validation (lives in @agent-mesh/runtime-agent)
 *   Layer 3 — Classifier hook (injection_risk / off_policy)
 *   Layer 4 — Structured-output enforcement (lives in @agent-mesh/runtime-agent)
 *   Layer 5 — PII redaction (input + output sides)
 */

export interface InjectionClassifier {
  /** Async hook. Return injection_risk + off_policy in [0, 1]. */
  readonly classify: (text: string) => Promise<{ injection_risk: number; off_policy: number }>;
}

export interface ProcessInputOptions<I> {
  /** Zod schema for the unparsed input event. Layer 1. */
  readonly inputSchema: ZodType<I>;
  /**
   * Optional classifier hook. Layer 3. If injection_risk > 0.7 or
   * off_policy > 0.7, throws PromptInjectionError.
   */
  readonly classifier?: InjectionClassifier;
  /** When `'replace'` or `'hash'`, redact PII on the inbound text. */
  readonly piiMode?: RedactionMode;
  /** Override the default PII rule set. */
  readonly customPatterns?: readonly PIIRule[];
  /**
   * Whether to wrap user-supplied text in a `<user_input>` delimiter
   * (a.k.a. "spotlighting"). Helps the model distinguish system prompt
   * from injected instructions inside the user message.
   */
  readonly spotlightInput?: boolean;
}

export interface ProcessInputResult<I> {
  readonly validated: I;
  readonly inputForModel: string;
  readonly inboundRedactions: readonly { entityType: string; count: number }[];
}

/**
 * Run an inbound event through layers 1, 3, and inbound-5.
 */
export const processInput = async <I>(
  event: unknown,
  rawText: string,
  opts: ProcessInputOptions<I>,
): Promise<ProcessInputResult<I>> => {
  // Layer 1 — input schema validation
  const parsed = opts.inputSchema.safeParse(event);
  if (!parsed.success) {
    throw new SchemaValidationError('Input event failed schema validation', {
      issues: parsed.error.issues,
    });
  }

  // Layer 3 — classifier (if configured)
  if (opts.classifier !== undefined) {
    const verdict = await opts.classifier.classify(rawText);
    if (verdict.injection_risk > 0.7 || verdict.off_policy > 0.7) {
      throw new PromptInjectionError('Input flagged by classifier', { verdict });
    }
  }

  // Layer 5 inbound — PII redaction
  let inputForModel = rawText;
  let inboundRedactions: RedactionResult['detections'] = [];
  if (opts.piiMode !== undefined) {
    const r = redact(rawText, opts.customPatterns, opts.piiMode);
    inputForModel = r.text;
    inboundRedactions = r.detections;
  }

  // Spotlight — wrap in delimiter so the model can disambiguate.
  if (opts.spotlightInput === true) {
    inputForModel = `<user_input>\n${inputForModel}\n</user_input>`;
  }

  return {
    validated: parsed.data,
    inputForModel,
    inboundRedactions,
  };
};

export interface ProcessOutputOptions<O> {
  /** Zod schema the agent output must conform to. Layer 4. */
  readonly outputSchema: ZodType<O>;
  /** When set, redact PII on the outbound text fields. */
  readonly piiMode?: RedactionMode;
  /** Override the default PII rule set. */
  readonly customPatterns?: readonly PIIRule[];
}

export interface ProcessOutputResult<O> {
  readonly validated: O;
  readonly outboundRedactions: readonly { entityType: string; count: number }[];
}

/**
 * Run an agent output through layer 4 + outbound-5. The agent loop
 * already validates `agent.output`, but this hook lets callers re-validate
 * at the application boundary (and apply outbound PII redaction at a
 * different rule-set than the inbound side).
 *
 * The redaction here walks the JSON serialisation of the output, then
 * round-trips through the schema — so redacted strings become typed
 * fields again.
 */
export const processOutput = <O>(
  output: unknown,
  opts: ProcessOutputOptions<O>,
): ProcessOutputResult<O> => {
  let value: unknown = output;
  let outboundRedactions: RedactionResult['detections'] = [];

  if (opts.piiMode !== undefined) {
    const serialized = typeof output === 'string' ? output : JSON.stringify(output);
    const r = redact(serialized, opts.customPatterns, opts.piiMode);
    value = typeof output === 'string' ? r.text : (JSON.parse(r.text) as unknown);
    outboundRedactions = r.detections;
  }

  const parsed = opts.outputSchema.safeParse(value);
  if (!parsed.success) {
    throw new GuardrailViolationError('Output failed schema validation after redaction', {
      issues: parsed.error.issues,
    });
  }

  return {
    validated: parsed.data,
    outboundRedactions,
  };
};
