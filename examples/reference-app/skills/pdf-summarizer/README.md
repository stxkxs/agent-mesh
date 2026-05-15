# pdf-summarizer

Reference skill for the agent-mesh skill bundle pattern. Demonstrates:

- `skill.yaml` manifest validated by `@agent-mesh/runtime-skills-builder`
- Workload Identity for Blob access (no SAS, no connection strings)
- Zod schemas for input + output (skill contract is type-safe end-to-end)

## Build + pack

```bash
agent-mesh skill pack examples/reference-app/skills/pdf-summarizer
# → ✔ pdf-summarizer@0.1.0
#   fingerprint:   <SHA-256>
#   bundle:        /tmp/agent-mesh-skill-…/pdf-summarizer-0.1.0.tar.gz
#   blob path:     pdf-summarizer/0.1.0-<fp12>.tar.gz
```

## Promote across environments

1. Upload the bundle to the workspace's `skills` blob container at the suggested blob path
2. Update App Configuration key `agent-mesh/skills/pdf-summarizer/current` to point at the new blob path
3. Agent runtime cold starts see the new version on next pod restart (or sentinel-based polling, operator's choice)

## Replace the stub

The reference handler returns a synthetic summary so the eval suite stays deterministic. Production replaces `summarize` with:

- `@azure/ai-document-intelligence` for layout + OCR extraction
- A Claude / Azure OpenAI call (via `@agent-mesh/sdk`) to produce the actual summary
