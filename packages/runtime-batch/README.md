# @agent-mesh/runtime-batch

Service Bus batch dispatch with Cosmos-backed idempotency. Fan out N inputs to the agent runtime queue and dedupe across re-publishes — operator re-runs a stuck batch and only un-delivered inputs are queued again.

```ts
import { dispatchBatch } from '@agent-mesh/runtime-batch';

const result = await dispatchBatch(
  [
    { ticketId: 'T-100', body: 'invoice question' },
    { ticketId: 'T-101', body: 'billing dispute' },
    { ticketId: 'T-100', body: 'invoice question' }, // duplicate — skipped
  ],
  {
    servicebusNamespace: 'sb-am-foo.servicebus.windows.net',
    queue: 'invocations',
    cosmosEndpoint: 'https://cosmos-am-foo.documents.azure.com:443/',
    cosmosDatabase: 'idempotency',
    cosmosContainer: 'invocations',
    agentId: 'triage',
  },
);

console.log(result);
// { published: 2, skipped: 1, correlationIds: ['…', '…'] }
```

## Idempotency model

Each input is hashed via stable JSON serialization (keys sorted, no whitespace) → SHA-256. The doc id in Cosmos is `<agentId>:<hash>`. The Cosmos partition key field defaults to `agent_id` — match the `cosmos_partition_paths` you configured in `terraform/modules/agent-runtime` (default `/agent_id`).

Flow:

1. Read `<agentId>:<hash>` from Cosmos
2. If found → skip (counted in `result.skipped`)
3. If not found → write the doc with `status=queued, correlation_id=<uuid>, ttl=7d`
4. Publish the Service Bus message with `correlation_id` + `idempotency_key` in `applicationProperties`

The agent runtime reads `correlation_id` from the message properties; the SDK threads it through the CallEvent for end-to-end traceability.

## TTL

Idempotency records carry `ttl: 7 days` so the container doesn't grow unboundedly. Two consequences:

- After 7 days, the same input is no longer deduplicated — by design (we don't want to silently swallow a tenant's legitimate re-submission of an old ticket).
- The Cosmos container TTL setting from `terraform/modules/agent-runtime` (`default_ttl = 604800`) provides a safety net even if a caller forgets to set it.

## What this does NOT do

- Failure handling beyond skip-if-exists. If a publish succeeds but the agent never processes the message (lock expiry × N → dead-letter), the idempotency record stays as `status: queued` and a fresh re-dispatch DOES skip it. Operators redrive from the DLQ; they don't re-dispatch.
- Backpressure. The Service Bus `sendMessages` call is unbounded; large batches should chunk in caller code if you need pacing.
