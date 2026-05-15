# @agent-mesh/cli

Operator CLI. After `pnpm install`, `pnpm --filter @agent-mesh/cli build`, run:

```bash
pnpm --filter @agent-mesh/cli exec agent-mesh --help
# OR after publishing:
npx @agent-mesh/cli --help
```

## Commands

| Command                            | What it does                                                                           |
| ---------------------------------- | -------------------------------------------------------------------------------------- |
| `agent-mesh init`                  | Writes a starter `agent-mesh.config.ts` in the current directory.                      |
| `agent-mesh doctor`                | Verifies your local toolchain (Node ≥ 24.14, terraform, helm, az CLI, Azure login).    |
| `agent-mesh workspace list`        | Lists configured workspaces from `agent-mesh.config`.                                  |
| `agent-mesh workspace show <name>` | Prints details for a single workspace.                                                 |
| `agent-mesh skill list`            | Lists skill directories under the configured skills root.                              |
| `agent-mesh skill pack <path>`     | Packs a skill into a deterministic .tar.gz (via `@agent-mesh/runtime-skills-builder`). |
| `agent-mesh prompt list`           | Lists versioned prompt files (`<name>.v<X>.<ext>`) with content SHA-256.               |
| `agent-mesh prompt hash <path>`    | Prints the SHA-256 of a single prompt file.                                            |

## Config

`agent-mesh.config.ts` at the project root, loaded via `jiti`:

```ts
import { defineConfig } from '@agent-mesh/cli/config';

export default defineConfig({
  defaultWorkspace: 'prod',
  workspaces: {
    prod: {
      account: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      resourceGroup: 'rg-agent-mesh-prod',
      region: 'eastus2',
    },
    sandbox: {
      account: 'aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee',
      resourceGroup: 'rg-agent-mesh-sandbox',
      region: 'eastus2',
    },
  },
  skillsRoot: 'skills',
  promptsRoot: 'prompts',
  evalsRoot: 'evals',
  prompts: { root: 'prompts' },
});
```

## Coming in M6

- `agent-mesh eval list` / `agent-mesh eval cases <suite>` — eval-suite introspection
- `agent-mesh budget show` — fetch current Consumption Budget state
- `agent-mesh audit query <sql>` — passthrough to Synapse Serverless SQL endpoint
