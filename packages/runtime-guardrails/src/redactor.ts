import { createHmac } from 'node:crypto';

import { ConfigurationError, GuardrailViolationError } from '@agent-mesh/core/errors';

import { DEFAULT_PII_RULES, type PIIRule } from './pii-rules.js';

/**
 * Redaction modes:
 *  - `replace`: substitute the match with `[REDACTED:<ENTITY>]`. Default.
 *  - `hash`: substitute with `[REDACTED:<ENTITY>:<HMAC-SHA256-8>]`. Lets
 *    downstream code correlate redacted values without seeing them.
 *    REQUIRES `AGENT_MESH_REDACTION_PEPPER` env var; fail-closed if missing.
 *  - `block`: throw on any detected PII. For inbound prompts only — use
 *    when the application MUST reject any prompt that contains PII.
 */
export type RedactionMode = 'replace' | 'hash' | 'block';

export interface DetectionEvent {
  readonly entityType: string;
  readonly count: number;
}

export interface RedactionResult {
  readonly text: string;
  readonly detections: readonly DetectionEvent[];
}

const PEPPER_ENV = 'AGENT_MESH_REDACTION_PEPPER';

const hashWithPepper = (entity: string, value: string): string => {
  const pepper = process.env[PEPPER_ENV];
  if (typeof pepper !== 'string' || pepper.length < 16) {
    throw new ConfigurationError(
      `Redaction mode 'hash' requires the ${PEPPER_ENV} env var (>= 16 chars). Fail-closed.`,
    );
  }
  const tag = createHmac('sha256', pepper).update(`${entity}:${value}`).digest('hex').slice(0, 8);
  return `[REDACTED:${entity}:${tag}]`;
};

/**
 * Apply the configured PII rules to `text` and return the redacted text +
 * a detection count per entity type.
 */
export const redact = (
  text: string,
  rules: readonly PIIRule[] = DEFAULT_PII_RULES,
  mode: RedactionMode = 'replace',
): RedactionResult => {
  const counts = new Map<string, number>();
  let out = text;

  for (const rule of rules) {
    out = out.replace(rule.pattern, (match) => {
      // Optional secondary validation — lets shape-then-checksum rules
      // (credit card Luhn) ignore matches that don't pass the second test.
      if (rule.validate !== undefined && !rule.validate(match)) {
        return match;
      }
      counts.set(rule.entityType, (counts.get(rule.entityType) ?? 0) + 1);
      if (mode === 'block') {
        throw new GuardrailViolationError(`PII detected: ${rule.entityType}`, {
          entityType: rule.entityType,
        });
      }
      if (mode === 'hash') {
        return hashWithPepper(rule.entityType, match);
      }
      return `[REDACTED:${rule.entityType}]`;
    });
  }

  return {
    text: out,
    detections: Array.from(counts.entries()).map(([entityType, count]) => ({ entityType, count })),
  };
};
