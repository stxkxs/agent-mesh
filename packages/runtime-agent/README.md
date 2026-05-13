# @agent-mesh/runtime-agent

The agent loop. `defineAgent` + `defineTool` produce typed definitions; `runAgent` drives a `ProviderAdapter` through tool dispatch + Zod-validated structured output. Versioned prompts resolve via `PromptResolver` (App Configuration pointer → Blob fetch + per-process cache). MCP backends sit behind an opossum circuit breaker via `createMcpBreaker`.

```ts
import { defineAgent, defineTool, runAgent, PromptResolver } from '@agent-mesh/runtime-agent';
import { AzureOpenAIAdapter } from '@agent-mesh/sdk';
import { DefaultAzureCredential } from '@azure/identity';
import { agentId, workspaceId, projectId, promptId } from '@agent-mesh/core/ids';
import { z } from 'zod';

const TriageOutput = z.object({
  priority: z.enum(['low', 'medium', 'high']),
  owner: z.enum(['billing', 'support', 'engineering', 'security']),
  summary: z.string().min(1).max(200),
});

const fetchCrmContact = defineTool({
  name: 'fetchCrmContact',
  description: 'Look up a CRM record by email.',
  input: z.object({ email: z.string() }),
  egress: z.object({ tier: z.string(), plan: z.string() }),
  execute: async ({ email }) => {
    // … real CRM lookup
    return { tier: 'enterprise', plan: 'ENTERPRISE_2024' };
  },
});

const triage = defineAgent({
  id: agentId('triage'),
  workspace: workspaceId('platform-prod'),
  project: projectId('alpha'),
  provider: 'azure-openai',
  model: 'gpt-4o',
  tools: [fetchCrmContact],
  output: TriageOutput,
  prompts: [promptId('triage-system')],
  maxIterations: 5,
});

const adapter = new AzureOpenAIAdapter({
  endpoint: process.env.AZURE_OPENAI_ENDPOINT!,
  credential: new DefaultAzureCredential(),
  workspace: triage.workspace,
  project: triage.project,
  tenant: 'platform' as never,
});

const resolver = new PromptResolver({
  appConfigEndpoint: process.env.APP_CONFIG_ENDPOINT!,
  blobServiceUrl: process.env.BLOB_SERVICE_URL!,
});
const system = (await resolver.resolve(promptId('triage-system'))).content;

const result = await runAgent(triage, 'production is down', {
  adapter,
  systemPrompt: system,
});
console.log(result.output.priority, result.output.summary);
```

## What the loop guarantees

1. **Layer 2 of the guardrail stack** — every tool result is parsed against its `egress` schema before being re-fed to the model. Malformed tool output never reaches the model; the tool gets a `tool_result` with `is_error: true` instead.
2. **Layer 4 of the guardrail stack** — final output is parsed against `agent.output`. Off-schema final answers throw `SchemaValidationError`; callers can branch on `e.code === 'schema_validation'`.
3. **Free-text refusal** — if the model produces no tool calls at all (just text), the runtime throws `GuardrailViolationError`. The model MUST respond via the structured-output tool.
4. **Hard iteration cap** — if `maxIterations` (default 6) elapses without a final answer, throw rather than loop forever.

## Prompt versioning

Prompts live as content-addressed Blob assets. The pointer key `agent-mesh/prompts/<promptId>/current` in App Configuration carries the URL + SHA-256. Promotion across environments = pointer swap, no Blob rewrite.

The resolver caches per-process. A pointer change requires an agent restart (or wiring an App Configuration sentinel + polling — left as an operator decision).

## Circuit breaker

`createMcpBreaker(action, { name })` wraps a tool's `execute` with opossum: 50% error threshold, 30s call timeout, 60s reset, 5-call volume threshold. State transitions emit structured log lines that Datadog promotes to `agent_mesh.mcp.circuit.*` metrics.
