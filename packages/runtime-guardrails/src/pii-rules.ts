/**
 * PII detection rule set. Each rule has a regex + an entity label + an
 * optional `confidence` to attach to detection events. We deliberately
 * keep this regex-driven (no Comprehend / Cognitive Services call in the
 * hot path) so the redactor adds < 1ms per kB at the application boundary.
 *
 * Operators can extend the default set via `processInput({ customPatterns })`.
 */

export interface PIIRule {
  readonly entityType: string;
  readonly pattern: RegExp;
  readonly confidence?: number;
}

export const DEFAULT_PII_RULES: readonly PIIRule[] = [
  // US SSN
  { entityType: 'US_SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.95 },
  // Credit card (13-16 digits, with optional space/dash separators)
  { entityType: 'CREDIT_CARD', pattern: /\b(?:\d[ -]?){13,16}\b/g, confidence: 0.85 },
  // Email
  {
    entityType: 'EMAIL',
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}\b/g,
    confidence: 0.99,
  },
  // AWS Access Key (well-formed AKIA/ASIA prefix + 16 alphanum)
  { entityType: 'AWS_ACCESS_KEY', pattern: /\b(?:AKIA|ASIA)[A-Z0-9]{16}\b/g, confidence: 0.99 },
  // US phone number (basic — does not enforce country code length)
  {
    entityType: 'PHONE_US',
    pattern: /\b(?:\+1[ -]?)?\(?[2-9]\d{2}\)?[ -]?[2-9]\d{2}[ -]?\d{4}\b/g,
    confidence: 0.7,
  },
  // IPv4
  { entityType: 'IP_V4', pattern: /\b(?:\d{1,3}\.){3}\d{1,3}\b/g, confidence: 0.6 },
];
