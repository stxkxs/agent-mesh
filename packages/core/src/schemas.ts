import { z } from 'zod';

/**
 * Canonical Zod schemas used across agent-mesh runtime libraries. Imported
 * by the SDK (to validate adapter output), the runtime-agent loop (to
 * shape CallEvent emission), and the audit pipeline (to enforce a stable
 * schema-version on every record).
 */

// ─── Provider + model identifiers ──────────────────────────────────────────

export const ProviderIdSchema = z.union([z.literal('azure-openai'), z.literal('anthropic')]);
export type ProviderId = z.infer<typeof ProviderIdSchema>;

/**
 * Model identifiers — kept open-ended (`z.string()` with a minimum length)
 * because both Azure OpenAI deployment names and Anthropic model strings
 * change frequently. We don't gate on a closed enum here.
 */
export const ModelIdSchema = z.string().min(1).max(128);
export type ModelId = z.infer<typeof ModelIdSchema>;

// ─── Token usage + cost ────────────────────────────────────────────────────

export const TokenUsageSchema = z.object({
  inputTokens: z.number().int().nonnegative(),
  outputTokens: z.number().int().nonnegative(),
  cacheCreationInputTokens: z.number().int().nonnegative().default(0),
  cacheReadInputTokens: z.number().int().nonnegative().default(0),
});
export type TokenUsage = z.infer<typeof TokenUsageSchema>;

// ─── Call event — the audit record for a single model invocation ───────────

export const CallEventSchema = z.object({
  schema: z.literal('agent-mesh.call-event/v1'),
  workspace: z.string(),
  project: z.string(),
  tenant: z.string(),
  agent: z.string().optional(),
  provider: ProviderIdSchema,
  model: ModelIdSchema,
  operation: z.union([
    z.literal('messages'),
    z.literal('batch'),
    z.literal('files'),
    z.literal('skills'),
    z.literal('mcp'),
  ]),
  startedAt: z.iso.datetime(),
  durationMs: z.number().int().nonnegative(),
  tokensIn: z.number().int().nonnegative(),
  tokensOut: z.number().int().nonnegative(),
  tokensCacheCreate: z.number().int().nonnegative(),
  tokensCacheRead: z.number().int().nonnegative(),
  costUsd: z.number().nonnegative(),
  status: z.union([z.literal('ok'), z.literal('error'), z.literal('throttled')]),
  errorClass: z
    .union([
      z.literal('RateLimit'),
      z.literal('Overloaded'),
      z.literal('BadRequest'),
      z.literal('Server'),
      z.literal('Network'),
      z.literal('AuthFailure'),
    ])
    .optional(),
  correlationId: z.string(),
  requestId: z.string(),
  cacheHit: z.boolean(),
  extensions: z.record(z.string(), z.unknown()).default({}),
});
export type CallEvent = z.infer<typeof CallEventSchema>;

// ─── Compliance preset ─────────────────────────────────────────────────────

export const CompliancePresetSchema = z.union([
  z.literal('standard'),
  z.literal('iso27001-aligned'),
  z.literal('hipaa-aware'),
]);
export type CompliancePreset = z.infer<typeof CompliancePresetSchema>;

// ─── Data residency ────────────────────────────────────────────────────────

/**
 * `dataResidency` is required at the Workspace level — there is no default.
 * Forces callers to declare where the model traffic terminates, so the
 * SUBPROCESSOR-NOTE banner can be rendered honestly per workspace.
 */
export const DataResidencySchema = z.union([
  z.string().regex(/^aws-[a-z0-9-]+$/),
  z.string().regex(/^azure-[a-z0-9-]+$/),
  z.literal('us-anthropic'),
  z.literal('unknown'),
]);
export type DataResidency = z.infer<typeof DataResidencySchema>;
