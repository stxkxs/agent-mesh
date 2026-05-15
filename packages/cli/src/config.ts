import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

import { createJiti } from 'jiti';
import { z } from 'zod';

export const WorkspaceConfigSchema = z.object({
  account: z.string(),
  resourceGroup: z.string(),
  region: z.string(),
});

export const AgentMeshConfigSchema = z.object({
  defaultWorkspace: z.string(),
  workspaces: z.record(z.string(), WorkspaceConfigSchema),
  skillsRoot: z.string().default('skills'),
  promptsRoot: z.string().default('prompts'),
  evalsRoot: z.string().default('evals'),
  prompts: z
    .object({
      root: z.string().default('prompts'),
    })
    .default({ root: 'prompts' }),
});

export type AgentMeshConfig = z.infer<typeof AgentMeshConfigSchema>;
export type WorkspaceConfig = z.infer<typeof WorkspaceConfigSchema>;

export const defineConfig = (config: AgentMeshConfig): AgentMeshConfig =>
  AgentMeshConfigSchema.parse(config);

const CONFIG_NAMES = ['agent-mesh.config.ts', 'agent-mesh.config.mjs', 'agent-mesh.config.js'];

export const loadConfig = async (cwd: string = process.cwd()): Promise<AgentMeshConfig | null> => {
  for (const name of CONFIG_NAMES) {
    const path = resolve(cwd, name);
    if (existsSync(path)) {
      const jiti = createJiti(import.meta.url);
      const mod = (await jiti.import(path, { default: true })) as unknown;
      const exported =
        mod !== null && typeof mod === 'object' && 'default' in mod
          ? (mod as { default: unknown }).default
          : mod;
      return AgentMeshConfigSchema.parse(exported);
    }
  }
  return null;
};

export const requireConfig = async (cwd?: string): Promise<AgentMeshConfig> => {
  const cfg = await loadConfig(cwd);
  if (cfg === null) {
    throw new Error(
      `No agent-mesh.config.{ts,mjs,js} found. Run 'agent-mesh init' or create one in your project root.`,
    );
  }
  return cfg;
};
