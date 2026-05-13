# @agent-mesh/core

Foundational types and helpers used by every other package in agent-mesh.

| Surface                    | What it gives you                                                                                                                                                                                                                                        |
| -------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `@agent-mesh/core/ids`     | Branded string types (`WorkspaceId`, `ProjectId`, `TenantId`, `AgentId`, `SkillId`, `PromptId`, `CorrelationId`, `RequestId`) plus their format-validating constructors. Prevents positional-argument mixups at compile time.                            |
| `@agent-mesh/core/errors`  | `AgentMeshError` base + 7 subclasses (`DataResidencyError`, `BudgetBreachError`, `PromptInjectionError`, `GuardrailViolationError`, `SchemaValidationError`, `ConfigurationError`, `RateLimitedError`, `ProviderError`) + `isAgentMeshError` type guard. |
| `@agent-mesh/core/schemas` | Canonical Zod schemas: `ProviderIdSchema`, `ModelIdSchema`, `TokenUsageSchema`, `CallEventSchema`, `CompliancePresetSchema`, `DataResidencySchema`.                                                                                                      |
| `@agent-mesh/core/hash`    | `sha256`, `sha256Bytes`, `shortHash` — content-addressing primitives for prompt and skill versioning.                                                                                                                                                    |

Zero runtime dependencies beyond `zod`. Used by `@agent-mesh/sdk`, `@agent-mesh/runtime-*`, and `@agent-mesh/cli`.
