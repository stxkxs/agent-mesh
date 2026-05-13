import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { resolve } from 'node:path';

import pc from 'picocolors';

import { loadConfig } from '../config.js';

import type { Command } from 'commander';

const scanSkills = (root: string): { name: string; version: string; dir: string }[] => {
  const dir = resolve(root);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) return [];
  const out: { name: string; version: string; dir: string }[] = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    if (!entry.isDirectory()) continue;
    const skillDir = resolve(dir, entry.name);
    const yaml = resolve(skillDir, 'skill.yaml');
    const json = resolve(skillDir, 'skill.json');
    if (!existsSync(yaml) && !existsSync(json)) continue;
    const path = existsSync(yaml) ? yaml : json;
    let content: string;
    try {
      content = readFileSync(path, 'utf8');
    } catch {
      continue;
    }
    const nameMatch = content.match(/^\s*"?name"?\s*:\s*"?([^"\n]+)"?/m);
    const versionMatch = content.match(/^\s*"?version"?\s*:\s*"?([^"\n,]+)"?/m);
    if (nameMatch !== null && versionMatch !== null) {
      out.push({
        name: nameMatch[1]?.trim() ?? entry.name,
        version: versionMatch[1]?.trim() ?? '0.0.0',
        dir: skillDir,
      });
    }
  }
  return out;
};

export const registerSkill = (program: Command): void => {
  const skill = program.command('skill').description('Manage versioned skill bundles');

  skill
    .command('list')
    .description('List skills under the configured skills root')
    .action(async () => {
      const cfg = await loadConfig();
      const root = cfg?.skillsRoot ?? 'skills';
      const skills = scanSkills(root);
      if (skills.length === 0) {
        console.warn(pc.dim(`No skills under ${pc.cyan(root)}/.`));
        return;
      }
      console.warn(pc.bold('\nSkills:\n'));
      for (const s of skills) {
        console.warn(
          `  ${pc.cyan(s.name.padEnd(28))} ${pc.dim(s.version.padEnd(12))} ${pc.dim(s.dir)}`,
        );
      }
      console.warn('');
    });

  skill
    .command('pack <path>')
    .description('Pack a skill directory into a deterministic .tar.gz')
    .action(async (path: string) => {
      const { packBundle } = await import('@agent-mesh/runtime-skills-builder');
      const out = await packBundle(path);
      console.warn(pc.bold(`\n✔ ${out.manifest.name}@${out.manifest.version}\n`));
      console.warn(`  fingerprint:   ${pc.dim(out.fingerprint)}`);
      console.warn(`  bundle:        ${pc.dim(out.bundlePath)}`);
      console.warn(`  size:          ${pc.dim(`${out.sizeBytes} bytes`)}`);
      console.warn(`  blob path:     ${pc.dim(out.suggestedBlobPath)}\n`);
    });
};
