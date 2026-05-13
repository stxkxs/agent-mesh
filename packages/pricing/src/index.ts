import { ConfigurationError } from '@agent-mesh/core/errors';

import { lookupAnthropicPrice } from './anthropic.js';
import { lookupAzureOpenAIPrice } from './azure-openai.js';

import type { TokenUsage, ProviderId, ModelId } from '@agent-mesh/core/schemas';

export * from './azure-openai.js';
export * from './anthropic.js';

/**
 * Compute the USD cost of a single model call given its provider, model,
 * and token usage. Throws `ConfigurationError` for unknown provider/model
 * pairs — callers should treat missing prices as a configuration bug, not
 * a runtime "default to zero" condition.
 *
 * Cache pricing semantics:
 *   - `cacheCreationInputTokens` is the number of *new* cache writes; charged
 *     at the provider's cache-write rate.
 *   - `cacheReadInputTokens` is the number of tokens that hit a warm cache;
 *     charged at the provider's cache-read rate.
 *   - `inputTokens` is the *non-cache* input. Don't double-count.
 */
export const computeCostUsd = (
  provider: ProviderId,
  model: ModelId,
  tokens: TokenUsage,
): number => {
  const price = (() => {
    switch (provider) {
      case 'azure-openai':
        return lookupAzureOpenAIPrice(model);
      case 'anthropic':
        return lookupAnthropicPrice(model);
    }
  })();
  if (price === null) {
    throw new ConfigurationError(`No pricing entry for ${provider}/${model}`, { provider, model });
  }
  const perMillion = 1_000_000;
  return (
    (tokens.inputTokens * price.input +
      tokens.outputTokens * price.output +
      tokens.cacheCreationInputTokens * price.cacheWrite +
      tokens.cacheReadInputTokens * price.cacheRead) /
    perMillion
  );
};
