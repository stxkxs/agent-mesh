import type { ModelId } from '@agent-mesh/core/schemas';

/**
 * Azure OpenAI pricing — per-million-token rates in USD. Sourced from the
 * Azure OpenAI public price list; Renovate runs a weekly job that opens
 * a PR against this file when upstream changes.
 *
 * Cache pricing is exposed as discounts off `input` (Azure OpenAI prompt
 * caching reads charge at 50% of normal input). Cache writes are charged
 * at the same rate as input.
 */
export interface AzureOpenAIPrice {
  /** USD per 1M input tokens. */
  readonly input: number;
  /** USD per 1M output tokens. */
  readonly output: number;
  /** USD per 1M cache-read tokens (read = 50% off input by Azure's policy). */
  readonly cacheRead: number;
  /** USD per 1M cache-write tokens (write = same as input). */
  readonly cacheWrite: number;
}

/**
 * Table indexed by Azure OpenAI *deployment name* convention, which by
 * default mirrors the underlying model id. Callers MAY override at the
 * adapter layer if their deployment uses a custom name — see
 * `AzureOpenAIAdapter.modelAliases`.
 */
export const AZURE_OPENAI_PRICING: Readonly<Record<string, AzureOpenAIPrice>> = {
  'gpt-4o': { input: 2.5, output: 10.0, cacheRead: 1.25, cacheWrite: 2.5 },
  'gpt-4o-mini': { input: 0.15, output: 0.6, cacheRead: 0.075, cacheWrite: 0.15 },
  'gpt-4.1': { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 2.0 },
  'gpt-4.1-mini': { input: 0.4, output: 1.6, cacheRead: 0.1, cacheWrite: 0.4 },
  'gpt-4.1-nano': { input: 0.1, output: 0.4, cacheRead: 0.025, cacheWrite: 0.1 },
  o3: { input: 2.0, output: 8.0, cacheRead: 0.5, cacheWrite: 2.0 },
  'o3-mini': { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.1 },
  'o4-mini': { input: 1.1, output: 4.4, cacheRead: 0.55, cacheWrite: 1.1 },
};

/**
 * Resolve a price entry for an Azure OpenAI deployment name. Returns the
 * matched entry, or `null` if unknown — callers MUST handle the null path
 * (typically: fall back to a configured-default-zero or fail-loud).
 */
export const lookupAzureOpenAIPrice = (model: ModelId): AzureOpenAIPrice | null =>
  AZURE_OPENAI_PRICING[model] ?? null;
