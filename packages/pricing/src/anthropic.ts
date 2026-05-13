import type { ModelId } from '@agent-mesh/core/schemas';

/**
 * Anthropic pricing — per-million-token rates in USD. Cache reads charge
 * at 10% of input, cache writes at 25% above input (5-minute ephemeral
 * cache pricing). 1-hour cache writes charge differently — we don't model
 * the 1-hour tier here yet.
 */
export interface AnthropicPrice {
  /** USD per 1M input tokens. */
  readonly input: number;
  /** USD per 1M output tokens. */
  readonly output: number;
  /** USD per 1M cache-read tokens (read = 10% of input). */
  readonly cacheRead: number;
  /** USD per 1M cache-write tokens (write = 1.25× input for 5-min ephemeral). */
  readonly cacheWrite: number;
}

export const ANTHROPIC_PRICING: Readonly<Record<string, AnthropicPrice>> = {
  'claude-opus-4-7': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-opus-4-6': { input: 15.0, output: 75.0, cacheRead: 1.5, cacheWrite: 18.75 },
  'claude-sonnet-4-6': { input: 3.0, output: 15.0, cacheRead: 0.3, cacheWrite: 3.75 },
  'claude-haiku-4-5': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
  'claude-haiku-4-5-20251001': { input: 0.8, output: 4.0, cacheRead: 0.08, cacheWrite: 1.0 },
};

export const lookupAnthropicPrice = (model: ModelId): AnthropicPrice | null =>
  ANTHROPIC_PRICING[model] ?? null;
