import type { ZodType } from 'zod';

/**
 * A `ToolBinding` is a tool definition + its server-side implementation +
 * its ingress and egress Zod schemas. The model sees only the name +
 * description + JSON-schema-projected input schema; the egress schema is
 * applied locally to whatever the tool returns before it's re-fed to the
 * model (layer 2 of the 5-layer guardrail stack).
 */
export interface ToolBinding<I, O> {
  readonly name: string;
  readonly description: string;
  readonly input: ZodType<I>;
  readonly egress: ZodType<O>;
  readonly execute: (input: I) => Promise<O>;
}

/**
 * Type-safe constructor for a `ToolBinding`. Infers `I` and `O` from the
 * Zod schemas so the `execute` signature matches automatically.
 */
export const defineTool = <I, O>(spec: ToolBinding<I, O>): ToolBinding<I, O> => spec;
