# @agent-mesh/runtime-skills-builder

Skill bundle packer. Produces a deterministic `.tar.gz` from a skill directory + a SHA-256 fingerprint that's stable across machines as long as the inputs are stable.

```ts
import { packBundle } from '@agent-mesh/runtime-skills-builder';

const out = await packBundle('./skills/pdf-summarizer');
console.log(out.manifest.name, out.fingerprint, out.suggestedBlobPath);
// pdf-summarizer 9c3e1b7…d4f2 pdf-summarizer/0.1.0-9c3e1b7…d4f2.tar.gz
```

## Manifest

`skill.yaml` (or `skill.json`) at the root of the skill directory. Validated against `SkillManifestSchema`:

```yaml
name: pdf-summarizer # kebab-case, 3-64 chars
version: 0.1.0 # semver
description: Summarize PDF documents.
entry: src/handler.ts
runtime: node24 # node24 | node26 | python312 | python313
capabilities:
  - files:read
```

Names must match `^[a-z][a-z0-9-]{1,62}[a-z0-9]$`. Versions are strict semver. The default runtime is `node24` (Node 24 LTS); flip to `node26` when Microsoft's AKS Extension catalog promotes it.

## Fingerprinting

`fingerprintSkill({ manifest, entryContent, lockfileContent? })` returns a deterministic SHA-256 over manifest + entry source + (optional) lockfile. Use as the immutable bundle ID — the suggested Blob path embeds the first 12 chars.

## Pack output

| Field               | Meaning                                                                           |
| ------------------- | --------------------------------------------------------------------------------- |
| `bundlePath`        | Absolute path to the .tar.gz on local disk                                        |
| `manifest`          | Parsed + validated manifest                                                       |
| `fingerprint`       | SHA-256 of `JSON.stringify(manifest) + 0x00 + tar bytes`                          |
| `sizeBytes`         | Size on disk                                                                      |
| `suggestedBlobPath` | `<name>/<version>-<fp12>.tar.gz` — canonical layout for the Blob skills container |
