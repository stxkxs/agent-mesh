# ADR-0001 — Terraform over Bicep

**Status:** accepted · 2026-05-12

## Context

Azure has two first-class IaC options: **Bicep** (Microsoft-first-party, ARM-native, transparent JSON projection) and **Terraform** with the `hashicorp/azurerm` + `azure/azapi` providers (community-large, multi-cloud-portable, declarative HCL).

Bicep wins on freshness — Microsoft's new resource types land in `bicep-types-az` on day-of-GA. Terraform's `azurerm` provider sometimes lags by weeks; `azapi` plugs the gap by exposing the raw ARM REST surface.

Terraform wins on three pragmatic axes: (1) larger community and CI/CD tooling ecosystem (tflint, tfsec, Checkov, Terragrunt, Atlantis, Spacelift), (2) state management is explicit and replayable, (3) it's already what most enterprise platform teams adopting agent-mesh will be running for non-Azure infra.

## Decision

agent-mesh ships **Terraform modules**. We pin `hashicorp/azurerm ~> 5.0` and `azure/azapi ~> 2.0`. Resources that AzureRM doesn't model are reached through azapi against the documented ARM REST surface.

We do not ship parallel Bicep modules. Bicep users can port; we don't maintain.

## Consequences

**Positive**

- Org standardization wins. Most platform teams already write Terraform for everything else; agent-mesh slots into existing CI/state management without a new tool.
- Mature ecosystem of static analysis: `tflint` + `tfsec` + `Checkov` give us the cdk-nag equivalent for free.
- `azapi` escape hatch covers any resource AzureRM is late on.

**Negative**

- Slight lag vs. Bicep on brand-new Azure resource types. Mitigated by `azapi`.
- Larger contributor expectation: Terraform users expect modules to be parameter-rich, output-rich, and version-pinned. We hold ourselves to that.

**Neutral**

- State management is now an operator concern. We document the Azure Storage backend pattern but don't bundle a state bucket — that's typically org-managed.
