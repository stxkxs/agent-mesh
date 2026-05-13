import { Command } from 'commander';

import { registerDoctor } from './commands/doctor.js';
import { registerInit } from './commands/init.js';
import { registerPrompt } from './commands/prompt.js';
import { registerSkill } from './commands/skill.js';
import { registerWorkspace } from './commands/workspace.js';

export { defineConfig, loadConfig, requireConfig } from './config.js';
export type { AgentMeshConfig, WorkspaceConfig } from './config.js';

export const main = async (argv: readonly string[]): Promise<void> => {
  const program = new Command();
  program
    .name('agent-mesh')
    .description('agent-mesh — operator CLI for LLM agent platforms on AKS')
    .version('0.0.0');

  registerInit(program);
  registerDoctor(program);
  registerWorkspace(program);
  registerSkill(program);
  registerPrompt(program);

  await program.parseAsync(['node', 'agent-mesh', ...argv]);
};
