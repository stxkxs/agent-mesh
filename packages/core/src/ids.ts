/**
 * Branded ID types — string newtypes that prevent positional-argument
 * mixups at compile time. A `WorkspaceId` is structurally a `string` at
 * runtime but cannot be assigned to a `ProjectId` slot without an explicit
 * cast.
 *
 * Construct via the small constructor helpers (`workspaceId('foo')`) which
 * apply the format-validation regex on the way in.
 */

declare const __brand: unique symbol;
export type Brand<T, B> = T & { readonly [__brand]: B };

export type WorkspaceId = Brand<string, 'WorkspaceId'>;
export type ProjectId = Brand<string, 'ProjectId'>;
export type TenantId = Brand<string, 'TenantId'>;
export type AgentId = Brand<string, 'AgentId'>;
export type SkillId = Brand<string, 'SkillId'>;
export type PromptId = Brand<string, 'PromptId'>;
export type CorrelationId = Brand<string, 'CorrelationId'>;
export type RequestId = Brand<string, 'RequestId'>;

const NAME_RE = /^[a-z][a-z0-9-]{1,62}[a-z0-9]$/;
const CORRELATION_RE = /^[A-Za-z0-9-_]{8,128}$/;

const validate = (kind: string, value: string, re: RegExp): void => {
  if (!re.test(value)) {
    throw new TypeError(`Invalid ${kind}: ${value} — must match ${re.source}`);
  }
};

export const workspaceId = (value: string): WorkspaceId => {
  validate('WorkspaceId', value, NAME_RE);
  return value as WorkspaceId;
};

export const projectId = (value: string): ProjectId => {
  validate('ProjectId', value, NAME_RE);
  return value as ProjectId;
};

export const tenantId = (value: string): TenantId => {
  validate('TenantId', value, NAME_RE);
  return value as TenantId;
};

export const agentId = (value: string): AgentId => {
  validate('AgentId', value, NAME_RE);
  return value as AgentId;
};

export const skillId = (value: string): SkillId => {
  validate('SkillId', value, NAME_RE);
  return value as SkillId;
};

export const promptId = (value: string): PromptId => {
  validate('PromptId', value, NAME_RE);
  return value as PromptId;
};

export const correlationId = (value: string): CorrelationId => {
  validate('CorrelationId', value, CORRELATION_RE);
  return value as CorrelationId;
};

export const requestId = (value: string): RequestId => {
  validate('RequestId', value, CORRELATION_RE);
  return value as RequestId;
};
