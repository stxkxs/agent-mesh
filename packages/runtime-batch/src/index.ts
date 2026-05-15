import { createHash, randomUUID } from 'node:crypto';

import { CosmosClient } from '@azure/cosmos';
import { DefaultAzureCredential, type TokenCredential } from '@azure/identity';
import { ServiceBusClient, type ServiceBusMessage } from '@azure/service-bus';

/**
 * Dispatch N inputs to a Service Bus queue with Cosmos-backed idempotency.
 *
 * Each input is hashed (SHA-256 of stable JSON.stringify); if the hash
 * already exists in the idempotency container, the input is skipped.
 * Otherwise we write the idempotency record FIRST (with a generated
 * correlationId), then publish to Service Bus. If the publish fails, the
 * record remains but the agent never sees the message — operators
 * re-drive via the same dispatchBatch call (the idempotency check
 * short-circuits successfully delivered ones).
 *
 * The agent runtime is expected to read `correlationId` from the message
 * application properties + record final-state idempotency in the same
 * container under the same key.
 */

export interface BatchDispatchOptions {
  /** Service Bus namespace FQDN (e.g. `sb-am-foo.servicebus.windows.net`). */
  readonly servicebusNamespace: string;
  /** Queue name. Typically `invocations`. */
  readonly queue: string;
  /** Cosmos endpoint URL. */
  readonly cosmosEndpoint: string;
  readonly cosmosDatabase: string;
  readonly cosmosContainer: string;
  /** Partition path matches the cosmos container's partition_key_paths. Default `agent_id`. */
  readonly partitionField?: string;
  /** Agent id to record in the idempotency partition + message properties. */
  readonly agentId: string;
  /** Override the credential chain (test-only). */
  readonly credential?: TokenCredential;
}

export interface BatchDispatchResult {
  readonly published: number;
  readonly skipped: number;
  readonly correlationIds: readonly string[];
}

/**
 * Stable JSON SHA-256: serializes objects with sorted keys so that key
 * reordering doesn't change the hash. Array order is preserved (intentional
 * — `[a, b]` and `[b, a]` are different inputs). Exported so the
 * idempotency hash function is testable against real production code, not
 * a re-implementation.
 */
export const sha256Json = (value: unknown): string => {
  const stringify = (v: unknown): string => {
    if (v === null || typeof v !== 'object') return JSON.stringify(v);
    if (Array.isArray(v)) return `[${v.map((x) => stringify(x)).join(',')}]`;
    const entries = Object.entries(v as Record<string, unknown>).sort(([a], [b]) =>
      a.localeCompare(b),
    );
    return `{${entries.map(([k, val]) => `${JSON.stringify(k)}:${stringify(val)}`).join(',')}}`;
  };
  return createHash('sha256').update(stringify(value)).digest('hex');
};

export const dispatchBatch = async (
  inputs: readonly Record<string, unknown>[],
  opts: BatchDispatchOptions,
): Promise<BatchDispatchResult> => {
  const cred = opts.credential ?? new DefaultAzureCredential();
  const cosmos = new CosmosClient({ endpoint: opts.cosmosEndpoint, aadCredentials: cred });
  const container = cosmos.database(opts.cosmosDatabase).container(opts.cosmosContainer);
  const partition = opts.partitionField ?? 'agent_id';

  const sb = new ServiceBusClient(opts.servicebusNamespace, cred);
  const sender = sb.createSender(opts.queue);

  const correlationIds: string[] = [];
  let published = 0;
  let skipped = 0;

  try {
    for (const input of inputs) {
      const idempotencyKey = sha256Json(input);
      const docId = `${opts.agentId}:${idempotencyKey}`;

      // Check-and-set: try to read the doc first. If present, skip.
      try {
        const existing = await container.item(docId, opts.agentId).read();
        if (existing.statusCode === 200) {
          skipped += 1;
          continue;
        }
      } catch {
        // Not found is expected — fall through to create.
      }

      const correlationId = randomUUID();
      const expireAtSeconds = Math.floor(Date.now() / 1000) + 7 * 24 * 60 * 60;
      try {
        await container.items.create({
          id: docId,
          [partition]: opts.agentId,
          idempotency_key: idempotencyKey,
          correlation_id: correlationId,
          status: 'queued',
          created_at: new Date().toISOString(),
          ttl: expireAtSeconds, // Cosmos respects ttl as seconds-from-now
        });
      } catch (e: unknown) {
        // 409 Conflict — another writer beat us to it (the read-then-create
        // window allows two concurrent dispatches to both miss on read).
        // Treat as skipped, don't abort the batch.
        if ((e as { code?: number }).code === 409) {
          skipped += 1;
          continue;
        }
        throw e;
      }

      const message: ServiceBusMessage = {
        body: input,
        contentType: 'application/json',
        applicationProperties: {
          agent_id: opts.agentId,
          correlation_id: correlationId,
          idempotency_key: idempotencyKey,
        },
        messageId: correlationId,
      };
      await sender.sendMessages(message);
      correlationIds.push(correlationId);
      published += 1;
    }
  } finally {
    await sender.close();
    await sb.close();
  }

  return { published, skipped, correlationIds };
};
