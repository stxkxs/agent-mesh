import { describe, expect, it } from 'vitest';

import { AgentMeshConfigSchema, defineConfig } from '../config.js';

describe('AgentMeshConfig', () => {
  it('accepts a valid config', () => {
    const cfg = defineConfig({
      defaultWorkspace: 'prod',
      workspaces: {
        prod: {
          account: '11111111-1111-1111-1111-111111111111',
          resourceGroup: 'rg-agent-mesh-prod',
          region: 'eastus2',
        },
      },
      skillsRoot: 'skills',
      promptsRoot: 'prompts',
      evalsRoot: 'evals',
      prompts: { root: 'prompts' },
    });
    expect(cfg.defaultWorkspace).toBe('prod');
    expect(cfg.workspaces.prod?.region).toBe('eastus2');
  });

  it('rejects missing workspaces', () => {
    expect(() => AgentMeshConfigSchema.parse({ defaultWorkspace: 'prod' })).toThrow();
  });

  it('applies defaults for optional fields', () => {
    const cfg = AgentMeshConfigSchema.parse({
      defaultWorkspace: 'prod',
      workspaces: {
        prod: { account: 'x', resourceGroup: 'y', region: 'z' },
      },
    });
    expect(cfg.skillsRoot).toBe('skills');
    expect(cfg.prompts.root).toBe('prompts');
  });
});
