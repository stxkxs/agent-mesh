# @agent-mesh/pricing

Per-model, per-million-token price tables for **Azure OpenAI** and **Anthropic**, with a single `computeCostUsd()` entry point that the SDK calls on every model invocation to attach `costUsd` to a `CallEvent`.

This package is the source of truth for cost telemetry. The number written into `agent_mesh.cost_usd` on every Datadog log line and the number `agent-mesh/runtime-evals` rolls up into per-suite cost are both computed here.

## Install

```bash
pnpm add @agent-mesh/pricing
```

## Usage

```ts
import { computeCostUsd } from '@agent-mesh/pricing';

const usd = computeCostUsd('anthropic', 'claude-sonnet-4-6', {
  inputTokens: 1_200,
  outputTokens: 380,
  cacheCreationInputTokens: 0,
  cacheReadInputTokens: 800,
});
```

`computeCostUsd` throws `ConfigurationError` when the `provider`/`model` pair is not in the table — missing prices are treated as a configuration bug, not as silently-zero costs. Wire your loader / config layer so that an unknown model fails fast at startup rather than producing wrong telemetry forever.

Direct, provider-scoped lookups are also exported when you want the raw rate without applying it to a usage record:

```ts
import { lookupAzureOpenAIPrice } from '@agent-mesh/pricing/azure-openai';
import { lookupAnthropicPrice } from '@agent-mesh/pricing/anthropic';
```

## Cache-token semantics

Prompt-caching tokens are billed separately from regular input tokens. `computeCostUsd` follows the same split:

| Field                      | Rate               |
| -------------------------- | ------------------ |
| `inputTokens`              | `price.input`      |
| `outputTokens`             | `price.output`     |
| `cacheCreationInputTokens` | `price.cacheWrite` |
| `cacheReadInputTokens`     | `price.cacheRead`  |

`inputTokens` represents the _non-cache_ portion. Do not add `cacheReadInputTokens` to `inputTokens` before passing them in — they're orthogonal and double-counting will inflate the bill estimate.

## Updating prices

Prices are checked-in static tables, intentionally hand-maintained. The dance is:

1. Vendor announces a price change (or a new model lands).
2. Edit the relevant table (`src/azure-openai.ts` or `src/anthropic.ts`) and bump the package version via Changesets.
3. CI runs the regression: tests assert that every model in `ModelId` has a price entry and that no entry has a zero rate (a zero rate is almost always a typo).

There is **no live API call** to vendor pricing endpoints at runtime. Hot-reloading prices from a network source would mean a degraded network can silently change cost telemetry — we'd rather break the build than rewrite history.

## Why this package exists separately from `@agent-mesh/sdk`

Cost is data, not transport. Keeping the table out of the SDK means:

- `@agent-mesh/runtime-evals` and `@agent-mesh/runtime-batch` can import the table without pulling in the OpenTelemetry tracer or the provider HTTP clients.
- A pricing-only PR doesn't trigger SDK consumers to re-test their adapter integration.
- The table can be swapped in tests via `vi.mock('@agent-mesh/pricing')` without re-mocking the SDK.

## License

Apache-2.0.
