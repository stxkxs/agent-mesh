import { execSync } from 'node:child_process';

import pc from 'picocolors';

import type { Command } from 'commander';

const check = (label: string, fn: () => string | null): boolean => {
  try {
    const detail = fn();
    if (detail === null) {
      console.warn(`  ${pc.green('✓')} ${label}`);
      return true;
    }
    console.warn(`  ${pc.yellow('!')} ${label}: ${pc.dim(detail)}`);
    return false;
  } catch (e) {
    console.warn(
      `  ${pc.red('✗')} ${label}: ${pc.red(e instanceof Error ? e.message : String(e))}`,
    );
    return false;
  }
};

const tryCmd = (cmd: string): string => execSync(cmd, { encoding: 'utf-8' }).trim();

export const registerDoctor = (program: Command): void => {
  program
    .command('doctor')
    .description('Verify your local toolchain can run agent-mesh deployments')
    .action(() => {
      console.warn(pc.bold('\nagent-mesh doctor\n'));

      const passed = [
        check('node >= 24.14', () => {
          const ver = process.versions.node;
          const major = Number(ver.split('.')[0] ?? '0');
          return major >= 24 ? null : `current: ${ver}`;
        }),
        check('terraform 1.10+ on PATH', () => {
          const out = tryCmd('terraform -version');
          return out.includes('v1.1') || out.includes('v1.2') ? null : (out.split('\n')[0] ?? null);
        }),
        check('helm 3.16+ on PATH', () => {
          const out = tryCmd('helm version --short');
          return out.includes('v3.') ? null : out;
        }),
        check('az CLI on PATH', () => {
          const out = tryCmd('az version --query "\\"azure-cli\\""');
          return out.length > 0 ? null : 'install azure-cli';
        }),
        check('Azure logged in', () => {
          const out = tryCmd('az account show --query name -o tsv');
          return out.length > 0 ? null : 'run `az login`';
        }),
      ];

      const ok = passed.every(Boolean);
      console.warn('');
      if (ok) {
        console.warn(pc.green('All checks passed.'));
      } else {
        console.warn(pc.yellow('Some checks failed. Install or configure the items above.'));
        process.exitCode = 1;
      }
    });
};
