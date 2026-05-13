import CircuitBreaker from 'opossum';

/**
 * MCP circuit breaker. One instance per MCP backend. Defaults:
 *  - `errorThresholdPercentage: 50` — open after 50% of recent calls fail
 *  - `timeout: 30000` — fail-fast after 30s
 *  - `resetTimeout: 60000` — half-open after 60s of being open
 *  - `volumeThreshold: 5` — require at least 5 calls before evaluating
 *
 * Override per-backend via `MCPCircuitOptions`.
 */
export interface MCPCircuitOptions {
  readonly name: string;
  readonly timeoutMs?: number;
  readonly errorThresholdPercentage?: number;
  readonly resetTimeoutMs?: number;
  readonly volumeThreshold?: number;
}

export const createMcpBreaker = <T, A extends unknown[]>(
  action: (...args: A) => Promise<T>,
  opts: MCPCircuitOptions,
): CircuitBreaker<A, T> => {
  const breaker = new CircuitBreaker<A, T>(action, {
    name: opts.name,
    timeout: opts.timeoutMs ?? 30000,
    errorThresholdPercentage: opts.errorThresholdPercentage ?? 50,
    resetTimeout: opts.resetTimeoutMs ?? 60000,
    volumeThreshold: opts.volumeThreshold ?? 5,
    rollingCountTimeout: 30000,
    rollingCountBuckets: 10,
  });

  // Emit lifecycle events as structured log lines — Datadog log pipelines
  // promote `agent_mesh.*` fields to metrics automatically.
  const emit = (ev: string) => () => {
    console.warn(
      JSON.stringify({
        level: 'info',
        service: 'agent-mesh',
        message: `agent_mesh.mcp.circuit.${ev}`,
        'agent_mesh.mcp.backend': opts.name,
        'agent_mesh.mcp.circuit_state': breaker.opened
          ? 'open'
          : breaker.halfOpen
            ? 'half_open'
            : 'closed',
      }),
    );
  };
  breaker.on('open', emit('open'));
  breaker.on('halfOpen', emit('halfOpen'));
  breaker.on('close', emit('close'));
  breaker.on('reject', emit('reject'));
  breaker.on('timeout', emit('timeout'));
  breaker.on('failure', emit('failure'));

  return breaker;
};
