import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { mkdtemp, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

import { z } from 'zod';

// ─── Manifest schema ────────────────────────────────────────────────────────

export const SkillManifestSchema = z.object({
  name: z.string().regex(/^[a-z][a-z0-9-]{1,62}[a-z0-9]$/),
  version: z
    .string()
    .regex(/^(0|[1-9]\d*)\.(0|[1-9]\d*)\.(0|[1-9]\d*)(?:-[\w.-]+)?(?:\+[\w.-]+)?$/),
  description: z.string().min(1).max(500),
  entry: z.string().min(1),
  runtime: z
    .union([
      z.literal('node24'),
      z.literal('node26'),
      z.literal('python312'),
      z.literal('python313'),
    ])
    .default('node24'),
  dependencies: z.record(z.string(), z.string()).optional(),
  capabilities: z.array(z.string()).default([]),
});

export type SkillManifest = z.infer<typeof SkillManifestSchema>;

export const parseSkillManifest = (raw: unknown): SkillManifest => SkillManifestSchema.parse(raw);

// ─── Fingerprint ────────────────────────────────────────────────────────────

export const fingerprintSkill = (input: {
  manifest: SkillManifest;
  entryContent: string;
  lockfileContent?: string;
}): string => {
  const h = createHash('sha256');
  h.update(JSON.stringify(input.manifest));
  h.update('\x00');
  h.update(input.entryContent);
  if (input.lockfileContent !== undefined) {
    h.update('\x00');
    h.update(input.lockfileContent);
  }
  return h.digest('hex');
};

// ─── packBundle ─────────────────────────────────────────────────────────────

export interface PackedBundle {
  readonly bundlePath: string;
  readonly manifest: SkillManifest;
  readonly fingerprint: string;
  readonly sizeBytes: number;
  /** Canonical Blob path: `<name>/<version>-<fp12>.tar.gz`. */
  readonly suggestedBlobPath: string;
}

const IGNORE_PATTERNS = [
  'node_modules',
  '.git',
  'dist',
  '.turbo',
  '*.tsbuildinfo',
  '.DS_Store',
  'coverage',
];

const runTar = async (cwd: string, outFile: string): Promise<void> => {
  const excludes = IGNORE_PATTERNS.flatMap((p) => ['--exclude', p]);
  await new Promise<void>((resolveP, rejectP) => {
    const child = spawn('tar', ['-czf', outFile, ...excludes, '-C', cwd, '.'], { stdio: 'pipe' });
    let stderr = '';
    child.stderr.on('data', (chunk: Buffer) => {
      stderr += chunk.toString('utf-8');
    });
    child.on('close', (code) => {
      if (code === 0) resolveP();
      else rejectP(new Error(`tar exited ${code ?? 'null'}: ${stderr}`));
    });
    child.on('error', (e) => rejectP(e));
  });
};

const parseSimpleYaml = (text: string): Record<string, unknown> => {
  const out: Record<string, unknown> = {};
  for (const line of text.split('\n')) {
    const trimmed = line.trim();
    if (trimmed === '' || trimmed.startsWith('#')) continue;
    const colon = trimmed.indexOf(':');
    if (colon === -1) continue;
    const key = trimmed.slice(0, colon).trim();
    let value: string = trimmed.slice(colon + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    if (value === 'true') out[key] = true;
    else if (value === 'false') out[key] = false;
    else if (value.match(/^-?\d+$/) !== null) out[key] = Number(value);
    else if (value === '') continue;
    else if (value.startsWith('[') && value.endsWith(']')) {
      out[key] = value
        .slice(1, -1)
        .split(',')
        .map((s) => s.trim().replace(/^["']|["']$/g, ''))
        .filter((s) => s.length > 0);
    } else {
      out[key] = value;
    }
  }
  return out;
};

const loadManifest = (dir: string): SkillManifest => {
  const yamlPath = join(dir, 'skill.yaml');
  const jsonPath = join(dir, 'skill.json');
  let raw: unknown;
  if (existsSync(yamlPath)) {
    raw = parseSimpleYaml(readFileSync(yamlPath, 'utf-8'));
  } else if (existsSync(jsonPath)) {
    raw = JSON.parse(readFileSync(jsonPath, 'utf-8'));
  } else {
    throw new Error(`Skill directory ${dir} contains neither skill.yaml nor skill.json`);
  }
  return parseSkillManifest(raw);
};

/**
 * Pack a skill directory into a deterministic .tar.gz with manifest
 * validation + content-addressed fingerprint.
 *
 *   1. Validate `skill.yaml` / `skill.json` against SkillManifestSchema
 *   2. tar+gzip the directory (excluding node_modules, dist, .git, etc.)
 *   3. Hash manifest + tar bytes → SHA-256 fingerprint
 *   4. Suggest a Blob path `<name>/<version>-<fp12>.tar.gz`
 */
export const packBundle = async (skillDir: string): Promise<PackedBundle> => {
  const dir = resolve(skillDir);
  if (!existsSync(dir) || !statSync(dir).isDirectory()) {
    throw new Error(`Skill directory not found: ${dir}`);
  }
  const manifest = loadManifest(dir);

  const workDir = await mkdtemp(join(tmpdir(), 'agent-mesh-skill-'));
  const bundlePath = join(workDir, `${manifest.name}-${manifest.version}.tar.gz`);
  await runTar(dir, bundlePath);

  const tarBytes = await readFile(bundlePath);
  const fingerprint = createHash('sha256')
    .update(JSON.stringify(manifest))
    .update('\x00')
    .update(tarBytes)
    .digest('hex');

  return {
    bundlePath,
    manifest,
    fingerprint,
    sizeBytes: tarBytes.byteLength,
    suggestedBlobPath: `${manifest.name}/${manifest.version}-${fingerprint.slice(0, 12)}.tar.gz`,
  };
};
