/**
 * PII detection rule set. Each rule has a regex + an entity label + an
 * optional `confidence` to attach to detection events. Optional `validate`
 * post-checks each regex match — e.g. the Luhn check on credit-card runs
 * for free off the regex hit and cuts false positives on order IDs,
 * tracking numbers, etc.
 *
 * Operators can extend the default set via `processInput({ customPatterns })`.
 */

export interface PIIRule {
  readonly entityType: string;
  readonly pattern: RegExp;
  readonly confidence?: number;
  /**
   * Optional secondary check. If provided, runs after the regex hit and
   * the match is treated as PII only when `validate(match) === true`.
   * Use for digit-set rules where shape alone is ambiguous.
   */
  readonly validate?: (match: string) => boolean;
}

/**
 * Luhn checksum — Visa/MC/Amex/Discover all use it. False positives drop
 * roughly 10x vs. shape-only on real-world ID-like inputs (tracking numbers,
 * order references, internal IDs).
 */
const passesLuhn = (digits: string): boolean => {
  const stripped = digits.replace(/[^0-9]/g, '');
  if (stripped.length < 13 || stripped.length > 19) return false;
  let sum = 0;
  let alt = false;
  for (let i = stripped.length - 1; i >= 0; i -= 1) {
    let n = Number(stripped[i]);
    if (alt) {
      n *= 2;
      if (n > 9) n -= 9;
    }
    sum += n;
    alt = !alt;
  }
  return sum % 10 === 0;
};

export const DEFAULT_PII_RULES: readonly PIIRule[] = [
  // US SSN
  { entityType: 'US_SSN', pattern: /\b\d{3}-\d{2}-\d{4}\b/g, confidence: 0.95 },
  // Credit card — shape match (13-16 digits with optional separators)
  // post-validated with Luhn to cut false positives on order IDs, tracking
  // numbers, internal references with similar digit density.
  {
    entityType: 'CREDIT_CARD',
    pattern: /\b(?:\d[ -]?){13,16}\b/g,
    confidence: 0.95,
    validate: passesLuhn,
  },
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
