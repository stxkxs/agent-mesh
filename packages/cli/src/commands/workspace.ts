import pc from 'picocolors';

import { loadConfig } from '../config.js';

import type { Command } from 'commander';

export const registerWorkspace = (program: Command): void => {
  const ws = program.command('workspace').description('Workspace operations');

  ws.command('list')
    .description('List configured workspaces')
    .action(async () => {
      const cfg = await loadConfig();
      if (cfg === null) {
        console.warn(pc.dim('No agent-mesh.config.{ts,mjs,js} found.'));
        return;
      }
      console.warn(pc.bold('\nWorkspaces:\n'));
      for (const [name, w] of Object.entries(cfg.workspaces)) {
        const marker = name === cfg.defaultWorkspace ? pc.green(' (default)') : '';
        console.warn(
          `  ${pc.cyan(name.padEnd(24))} ${pc.dim(w.region.padEnd(14))} ${pc.dim(w.resourceGroup)}${marker}`,
        );
      }
      console.warn('');
    });

  ws.command('show <name>')
    .description('Show details of a single workspace')
    .action(async (name: string) => {
      const cfg = await loadConfig();
      if (cfg === null) {
        console.warn(pc.dim('No agent-mesh.config found.'));
        process.exitCode = 1;
        return;
      }
      const w = cfg.workspaces[name];
      if (w === undefined) {
        console.warn(pc.red(`No workspace "${name}" in config.`));
        process.exitCode = 1;
        return;
      }
      console.warn(`  account:        ${pc.cyan(w.account)}`);
      console.warn(`  resource group: ${pc.cyan(w.resourceGroup)}`);
      console.warn(`  region:         ${pc.cyan(w.region)}`);
    });
};
