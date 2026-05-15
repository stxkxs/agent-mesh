# Contributing to agent-mesh

Welcome. This document covers the local dev loop and the conventions we hold each other to.

## Prereqs

- Node 24 LTS or newer (`.nvmrc` pins to 26 — Node 26 reaches LTS in October 2026; 24 works fine until then)
- pnpm 11.x via Corepack: `corepack enable && corepack prepare pnpm@latest --activate`
- Terraform 1.10+
- Helm 3.16+
- An Azure subscription you can deploy into (the `examples/minimal` is sandbox-safe; tear it down after)

## First-time setup

```bash
git clone https://github.com/stxkxs/agent-mesh.git
cd agent-mesh
pnpm install
pnpm turbo run build test lint typecheck
```

## Daily loop

```bash
# Edit a TS package
pnpm --filter @agent-mesh/sdk test --watch

# Edit a Terraform module
terraform -chdir=terraform/examples/minimal init -backend=false
terraform -chdir=terraform/examples/minimal validate

# Edit a Helm chart
helm lint charts/otel-collector
helm template charts/otel-collector --debug
```

## Commit messages

We use [Conventional Commits](https://www.conventionalcommits.org/) enforced by commitlint. Scopes are restricted to the bounded-context names (`workspace`, `credentials`, `audit`, `sdk`, `core`, etc.) — see `commitlint.config.mjs`.

```
feat(sdk): add fallback chain support to ProviderAdapter
fix(workspace): purge_protection_enabled now honors compliance preset
docs(adr): record decision on Cosmos vs PostgreSQL Flexible
```

For substantial commits, use the structured-body format from this repo's existing commits — section headers with box-drawing characters, file-level detail where it matters.

## Adding a Terraform module

Place under `terraform/modules/<context>/`. Required files: `versions.tf`, `variables.tf`, `main.tf`, `outputs.tf`, `README.md`. Validate locally before committing:

```bash
terraform -chdir=terraform/modules/<context> init -backend=false
terraform -chdir=terraform/modules/<context> validate
tflint --chdir=terraform/modules/<context>
tfsec terraform/modules/<context>
```

## Adding a TS package

Place under `packages/<name>/`. Required files: `package.json`, `tsconfig.json` (extending `@agent-mesh/config/tsconfig/lib`), `eslint.config.mjs`, `vitest.config.ts`, `README.md`. Mirror the package shape of `@agent-mesh/core` or `@agent-mesh/sdk`.

## Tests

The Testing Trophy is the bar:

- **Static** (largest layer) — `tsc -b --strict`, ESLint flat, `terraform fmt -check`, `tflint`, `tfsec`, `helm lint`. All in CI.
- **Unit** — Vitest, mocked clients. Cover error classification, schema validation, pricing math, prompt hashing.
- **Integration** — Terraform `plan` snapshot tests (M2+), real Azure deploys for `examples/minimal` (nightly).
- **E2E** — One canary in M6 that deploys + exercises + tears down the reference app.

`pnpm turbo run build test typecheck lint` from a clean checkout passes in under 60s warm.

## Releasing

We use Changesets. After substantial changes:

```bash
pnpm changeset
# Follow the prompts to declare the version bump
```

A bot opens a "Version Packages" PR; merging publishes to npm with provenance.
