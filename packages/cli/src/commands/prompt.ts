import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import pc from 'picocolors';

import { loadConfig } from '../config.js';

import type { Command } from 'commander';

const PROMPT_NAME_RE = /^(?<name>[a-z][a-z0-9-]*)\.v(?<version>\d+(?:\.\d+){0,2})\.(mdx|md|txt)$/;

const scanPrompts = (
  root: string,
): {
  name: string;
  version: string;
  path: string;
  sha256: string;
}[] => {
  const dir = resolve(root);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: { name: string; version: string; path: string; sha256: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isFile()) continue;
    const match = entry.name.match(PROMPT_NAME_RE);
    if (match === null) continue;
    const path = resolve(dir, entry.name);
    const content = readFileSync(path, 'utf8');
    const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
    out.push({
      name: match.groups?.['name'] ?? '',
      version: match.groups?.['version'] ?? '',
      path,
      sha256,
    });
  }
  return out;
};

export const registerPrompt = (program: Command): void => {
  const prompt = program.command('prompt').description('Manage versioned prompts');

  prompt
    .command('list')
    .description('List prompts under the configured prompts root')
    .action(async () => {
      const cfg = await loadConfig();
      const root = cfg?.prompts.root ?? 'prompts';
      const prompts = scanPrompts(root);
      if (prompts.length === 0) {
        console.warn(
          pc.dim(
            `No prompts under ${pc.cyan(root)}/. Expected names like \`triage-system.v1.mdx\`.`,
          ),
        );
        return;
      }
      console.warn(pc.bold('\nPrompts:\n'));
      for (const p of prompts) {
        console.warn(
          `  ${pc.cyan(p.name.padEnd(28))} v${pc.dim(p.version.padEnd(8))} ${pc.dim(p.sha256.slice(0, 12))}  ${pc.dim(p.path)}`,
        );
      }
      console.warn('');
    });

  prompt
    .command('hash <path>')
    .description('Print the SHA-256 of a prompt file (the immutable version id)')
    .action((path: string) => {
      const content = readFileSync(resolve(path), 'utf8');
      const sha256 = createHash('sha256').update(content, 'utf8').digest('hex');
      console.warn(sha256);
    });
};
