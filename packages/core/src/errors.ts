/**
 * Error hierarchy used across agent-mesh. Every error carries a stable
 * `code` (machine-readable, stable across versions) and an optional
 * structured `details` bag for telemetry. Downstream consumers narrow
 * by class (`instanceof PromptInjectionError`) for behavior or by `code`
 * for log/metric attribution.
 */

export interface AgentMeshErrorOptions {
  readonly code: string;
  readonly message: string;
  readonly details?: Readonly<Record<string, unknown>>;
  readonly cause?: unknown;
}

export class AgentMeshError extends Error {
  public readonly code: string;
  public readonly details: Readonly<Record<string, unknown>>;

  public constructor(options: AgentMeshErrorOptions) {
    super(options.message, options.cause === undefined ? undefined : { cause: options.cause });
    this.name = this.constructor.name;
    this.code = options.code;
    this.details = options.details ?? {};
  }
}

const opts = (
  code: string,
  message: string,
  details?: Readonly<Record<string, unknown>>,
): AgentMeshErrorOptions =>
  details === undefined ? { code, message } : { code, message, details };

export class DataResidencyError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('data_residency', message, details));
  }
}

export class BudgetBreachError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('budget_breach', message, details));
  }
}

export class PromptInjectionError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('prompt_injection', message, details));
  }
}

export class GuardrailViolationError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('guardrail_violation', message, details));
  }
}

export class SchemaValidationError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('schema_validation', message, details));
  }
}

export class ConfigurationError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('configuration', message, details));
  }
}

export class RateLimitedError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('rate_limited', message, details));
  }
}

export class ProviderError extends AgentMeshError {
  public constructor(message: string, details?: Readonly<Record<string, unknown>>) {
    super(opts('provider', message, details));
  }
}

/**
 * Discriminator for narrowing `unknown` caught values to AgentMeshError
 * without an `instanceof` chain. Cheaper than reflection and works
 * across realms (e.g., when an error crosses a Worker boundary and
 * loses its prototype).
 */
export const isAgentMeshError = (e: unknown): e is AgentMeshError => e instanceof AgentMeshError;
