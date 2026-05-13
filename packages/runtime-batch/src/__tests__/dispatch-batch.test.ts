import { describe, expect, it, vi } from 'vitest';

import { dispatchBatch } from '../index.js';

// Build a stub Cosmos + Service Bus client surface that dispatchBatch
// uses. The real client gets shimmed via the @azure/cosmos and
// @azure/service-bus module mocks below.

vi.mock('@azure/identity', () => ({
  DefaultAzureCredential: class {},
}));

const cosmosState: {
  reads: { docId: string; partition: string }[];
  creates: { id: string }[];
  /** When set, the next create call throws this error before incrementing creates. */
  nextCreateError?: { code: number } | undefined;
  /** When set, `read` returns 200 for these doc ids; otherwise throws not-found. */
  existingIds: Set<string>;
} = { reads: [], creates: [], existingIds: new Set() };

vi.mock('@azure/cosmos', () => ({
  CosmosClient: class {
    database() {
      return {
        container: () => ({
          item: (id: string, partition: string) => ({
            read: async () => {
              cosmosState.reads.push({ docId: id, partition });
              if (cosmosState.existingIds.has(id)) {
                return { statusCode: 200 };
              }
              const err: Error & { code?: number } = new Error('NotFound');
              err.code = 404;
              throw err;
            },
          }),
          items: {
            create: async (doc: { id: string }) => {
              if (cosmosState.nextCreateError !== undefined) {
                const err = cosmosState.nextCreateError;
                cosmosState.nextCreateError = undefined;
                const e: Error & { code?: number } = new Error('Conflict');
                e.code = err.code;
                throw e;
              }
              cosmosState.creates.push({ id: doc.id });
              cosmosState.existingIds.add(doc.id);
              return { statusCode: 201 };
            },
          },
        }),
      };
    }
  },
}));

const sbState: {
  sent: { messageId: string | undefined }[];
} = { sent: [] };

vi.mock('@azure/service-bus', () => ({
  ServiceBusClient: class {
    createSender() {
      return {
        sendMessages: async (m: { messageId?: string }) => {
          sbState.sent.push({ messageId: m.messageId });
        },
        close: async () => {
          /* no-op */
        },
      };
    }
    async close() {
      /* no-op */
    }
  },
}));

const baseOpts = {
  servicebusNamespace: 'sb-test.servicebus.windows.net',
  queue: 'invocations',
  cosmosEndpoint: 'https://cosmos-test.documents.azure.com:443/',
  cosmosDatabase: 'idempotency',
  cosmosContainer: 'invocations',
  agentId: 'triage',
};

const resetState = (): void => {
  cosmosState.reads = [];
  cosmosState.creates = [];
  cosmosState.nextCreateError = undefined;
  cosmosState.existingIds = new Set();
  sbState.sent = [];
};

describe('dispatchBatch', () => {
  it('publishes fresh inputs and counts them', async () => {
    resetState();
    const result = await dispatchBatch(
      [
        { ticketId: 'T-100', body: 'a' },
        { ticketId: 'T-101', body: 'b' },
      ],
      baseOpts,
    );

    expect(result.published).toBe(2);
    expect(result.skipped).toBe(0);
    expect(result.correlationIds).toHaveLength(2);
    expect(sbState.sent).toHaveLength(2);
    expect(cosmosState.creates).toHaveLength(2);
  });

  it('skips inputs that already have a doc (cache-hit read=200)', async () => {
    resetState();
    // Pre-populate the existing-id set with the hash of T-100.
    // sha256Json({ticketId: 'T-100', body: 'a'}) is deterministic.
    const { sha256Json } = await import('../index.js');
    const seenHash = sha256Json({ ticketId: 'T-100', body: 'a' });
    cosmosState.existingIds.add(`triage:${seenHash}`);

    const result = await dispatchBatch(
      [
        { ticketId: 'T-100', body: 'a' }, // already seen → skipped
        { ticketId: 'T-101', body: 'b' }, // fresh → published
      ],
      baseOpts,
    );

    expect(result.published).toBe(1);
    expect(result.skipped).toBe(1);
    expect(sbState.sent).toHaveLength(1);
  });

  it('catches 409 on create as a race-loss and counts as skipped (not aborted)', async () => {
    resetState();
    cosmosState.nextCreateError = { code: 409 };

    const result = await dispatchBatch(
      [
        { ticketId: 'T-100', body: 'a' }, // create races → 409 → skipped
        { ticketId: 'T-101', body: 'b' }, // fresh → published
      ],
      baseOpts,
    );

    expect(result.published).toBe(1);
    expect(result.skipped).toBe(1);
    expect(sbState.sent).toHaveLength(1);
  });

  it('propagates non-409 errors instead of swallowing them', async () => {
    resetState();
    cosmosState.nextCreateError = { code: 500 };

    await expect(dispatchBatch([{ ticketId: 'T-100', body: 'a' }], baseOpts)).rejects.toThrow(
      /Conflict/,
    );
  });

  it('deduplicates identical inputs within a single batch', async () => {
    resetState();
    const result = await dispatchBatch(
      [
        { ticketId: 'T-100', body: 'a' },
        { ticketId: 'T-100', body: 'a' }, // identical hash → second is skipped via read-200
        { ticketId: 'T-101', body: 'b' },
      ],
      baseOpts,
    );

    expect(result.published).toBe(2);
    expect(result.skipped).toBe(1);
  });
});
