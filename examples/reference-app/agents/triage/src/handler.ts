/**
 * Triage agent — reference implementation.
 *
 * Flow per invocation:
 *   1. Build an AzureOpenAIAdapter wired to Workload Identity (no API key)
 *   2. processInput — layers 1 (Zod), 3 (optional classifier), 5 (PII redact)
 *   3. runAgent — drive the model through tool dispatch + Zod-validated
 *      structured output
 *   4. processOutput — layer 4 re-validation + outbound PII redaction
 *   5. Return triage decision + redaction counters
 *
 * Triggered by Service Bus messages produced upstream (e.g. an email
 * ingestion Logic App that drops triage events). The agent-mesh
 * Helm chart's Deployment wraps this handler in a Service Bus consumer
 * loop and a DLQ handler.
 */

import { agentId, projectId, tenantId, workspaceId } from '@agent-mesh/core/ids';
import { defineAgent, defineTool, runAgent, type ToolBinding } from '@agent-mesh/runtime-agent';
import { processInput, processOutput } from '@agent-mesh/runtime-guardrails';
import { AzureOpenAIAdapter } from '@agent-mesh/sdk';
import { DefaultAzureCredential } from '@azure/identity';
import { z } from 'zod';

// ─── Schemas ─────────────────────────────────────────────────────────────────

const TriageInputSchema = z.object({
  correlationId: z.string().min(8),
  sender: z.object({ email: z.string() }),
  body: z.string().min(1).max(50_000),
});

export const TriageOutputSchema = z.object({
  priority: z.union([z.literal('low'), z.literal('medium'), z.literal('high')]),
  topic: z.string().regex(/^[a-z][a-z0-9-]*$/),
  owner: z.union([
    z.literal('billing'),
    z.literal('support'),
    z.literal('engineering'),
    z.literal('security'),
    z.literal('product'),
  ]),
  summary: z.string().min(1).max(200),
});
export type TriageOutput = z.infer<typeof TriageOutputSchema>;

// ─── Tools ───────────────────────────────────────────────────────────────────

const fetchCrmContact = defineTool({
  name: 'fetchCrmContact',
  description: 'Look up a CRM record by sender email. Returns account tier + plan + signup date.',
  input: z.object({ email: z.string() }),
  egress: z.object({
    found: z.boolean(),
    tier: z.union([
      z.literal('free'),
      z.literal('pro'),
      z.literal('enterprise'),
      z.literal('unknown'),
    ]),
    plan: z.string(),
    signupDate: z.string(),
  }),
  // In production this calls the real CRM. For the reference deployment,
  // a deterministic stub keyed by email-domain keeps evals reproducible.
  execute: async ({ email }) => {
    const domain = email.split('@')[1] ?? 'unknown';
    const tier: 'enterprise' | 'pro' | 'free' | 'unknown' = domain.endsWith('.gov')
      ? 'enterprise'
      : domain.endsWith('.com')
        ? 'pro'
        : domain === 'unknown'
          ? 'unknown'
          : 'free';
    return {
      found: tier !== 'unknown',
      tier,
      plan: tier === 'enterprise' ? 'ENTERPRISE_2024' : tier === 'pro' ? 'PRO_MONTHLY' : 'FREE',
      signupDate: '2024-09-15',
    };
  },
});

const classifyTopic = defineTool({
  name: 'classifyTopic',
  description: 'Extract a normalized topic tag from message text.',
  input: z.object({ text: z.string() }),
  egress: z.object({
    topic: z.string(),
    confidence: z.number().min(0).max(1),
  }),
  execute: async ({ text }) => {
    // Lightweight keyword classifier — production swaps in Cognitive
    // Services Custom Classifier or a Haiku call. The rules are tuned
    // against the triage-quality eval suite (see evals/).
    const lc = text.toLowerCase();
    const rules: { kw: RegExp; topic: string; conf: number }[] = [
      { kw: /\b(outage|down|500|503|broken|degraded)\b/, topic: 'outage', conf: 0.85 },
      { kw: /\b(charge|invoice|refund|billing|subscription)\b/, topic: 'billing', conf: 0.8 },
      { kw: /\b(breach|leak|exposed|csrf|xss|injection|vulnerab)\b/, topic: 'security', conf: 0.9 },
      {
        kw: /\b(feature request|wish|could you add|please add)\b/,
        topic: 'feature-request',
        conf: 0.7,
      },
      { kw: /\b(login|password|access|account)\b/, topic: 'account', conf: 0.6 },
    ];
    for (const r of rules) {
      if (r.kw.test(lc)) return { topic: r.topic, confidence: r.conf };
    }
    return { topic: 'other', confidence: 0.3 };
  },
});

// ─── Agent definition ───────────────────────────────────────────────────────

// The ToolBinding<I, O> functions are contravariant on I, so concrete
// tools don't widen to ToolBinding<unknown, unknown>. The runtime treats
// them generically; cast at the array boundary.
const tools: readonly ToolBinding<unknown, unknown>[] = [
  fetchCrmContact,
  classifyTopic,
] as readonly ToolBinding<unknown, unknown>[];

export const triage = defineAgent<TriageOutput>({
  id: agentId('triage'),
  workspace: workspaceId(process.env['AGENT_MESH_WORKSPACE'] ?? 'agent-mesh-reference'),
  project: projectId(process.env['AGENT_MESH_PROJECT'] ?? 'alpha'),
  tenant: tenantId(process.env['AGENT_MESH_TENANT'] ?? 'platform'),
  provider: 'azure-openai',
  model: process.env['AZURE_OPENAI_DEPLOYMENT'] ?? 'gpt-4o',
  tools,
  output: TriageOutputSchema,
  maxIterations: 5,
});

// ─── Client (built once per cold start) ─────────────────────────────────────

let adapter: AzureOpenAIAdapter | undefined;
const getAdapter = (): AzureOpenAIAdapter => {
  if (adapter === undefined) {
    const endpoint = process.env['AZURE_OPENAI_ENDPOINT'];
    if (endpoint === undefined || endpoint === '') {
      throw new Error('AZURE_OPENAI_ENDPOINT env var is required');
    }
    adapter = new AzureOpenAIAdapter({
      endpoint,
      credential: new DefaultAzureCredential(),
      workspace: triage.workspace,
      project: triage.project,
      tenant: triage.tenant ?? tenantId('platform'),
    });
  }
  return adapter;
};

// ─── Handler ────────────────────────────────────────────────────────────────

export interface TriageEvent {
  readonly correlationId: string;
  readonly sender: { readonly email: string };
  readonly body: string;
}

export interface TriageResponse {
  readonly statusCode: number;
  readonly correlationId: string;
  readonly triage: TriageOutput;
  readonly iterations: number;
  readonly costUsd: number;
  readonly inboundRedactions: { entityType: string; count: number }[];
  readonly outboundRedactions: { entityType: string; count: number }[];
}

export const handler = async (
  event: TriageEvent,
  systemPrompt: string,
): Promise<TriageResponse> => {
  // Layer 1 + 3 + inbound 5
  const input = await processInput<z.infer<typeof TriageInputSchema>>(event, event.body, {
    inputSchema: TriageInputSchema,
    piiMode: 'replace',
    spotlightInput: true,
  });

  const run = await runAgent(triage, input.inputForModel, {
    adapter: getAdapter(),
    systemPrompt,
    correlationId: input.validated.correlationId,
  });

  // Layer 4 + outbound 5
  const out = processOutput<TriageOutput>(run.output, {
    outputSchema: TriageOutputSchema,
    piiMode: 'replace',
  });

  return {
    statusCode: 200,
    correlationId: run.correlationId,
    triage: out.validated,
    iterations: run.iterations,
    costUsd: run.totalCostUsd,
    inboundRedactions: [...input.inboundRedactions],
    outboundRedactions: [...out.outboundRedactions],
  };
};
