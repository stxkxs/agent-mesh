import { writeFileSync, existsSync } from 'node:fs';
import { resolve } from 'node:path';

import pc from 'picocolors';

import type { Command } from 'commander';

const TEMPLATE = `import { defineConfig } from '@agent-mesh/cli/config';

export default defineConfig({
  defaultWorkspace: 'sandbox',
  workspaces: {
    sandbox: {
      account: '<your-subscription-id>',
      resourceGroup: 'rg-agent-mesh-sandbox',
      region: 'eastus2',
    },
  },
  skillsRoot: 'skills',
  promptsRoot: 'prompts',
  evalsRoot: 'evals',
  prompts: { root: 'prompts' },
});
`;

export const registerInit = (program: Command): void => {
  program
    .command('init')
    .description('Create an agent-mesh.config.ts in the current directory')
    .action(() => {
      const path = resolve(process.cwd(), 'agent-mesh.config.ts');
      if (existsSync(path)) {
        console.warn(pc.yellow(`Already exists: ${path}`));
        process.exitCode = 1;
        return;
      }
      writeFileSync(path, TEMPLATE);
      console.warn(pc.green(`✓ Created ${path}`));
      console.warn(
        pc.dim(
          'Edit the workspace account + resourceGroup + region, then run `agent-mesh doctor`.',
        ),
      );
    });
};
