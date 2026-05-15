# filesystem-readonly MCP server

Reference MCP backend. Exposes `list(path)` + `read(path)` over HTTP, sandboxed to a single root mounted at `MCP_ROOT` (default `/var/mcp/root`). Useful for letting an agent inspect a curated set of files (documentation, runbooks, code samples) without giving it broader filesystem access.

## What it demonstrates

- **Distroless Node 24 image** (gcr.io/distroless/nodejs24-debian12:nonroot) — ~80 MB final image, no shell, runs as non-root
- **Path traversal defense** — rejects absolute paths, `..` segments, and symlinks at every request
- **Size cap** — `MAX_BYTES` env var (default 1 MiB) prevents large-file reads from blowing the agent's context window
- **Plain HTTP** — fronted by the workspace's Application Gateway + WAF v2 from `terraform/modules/mcp`, no protocol translation needed

## Build + push

```bash
cd examples/reference-app/mcp-servers/filesystem-readonly
docker build -t myregistry.azurecr.io/mcp-filesystem-readonly:v0.1.0 .
docker push myregistry.azurecr.io/mcp-filesystem-readonly:v0.1.0
```

## Deploy with the agent-mesh chart

```bash
helm install filesystem ./charts/mcp-server \
  --namespace mcp \
  --create-namespace \
  --set workspace=agent-mesh-reference \
  --set project=alpha \
  --set name=filesystem-readonly \
  --set image.repository=myregistry.azurecr.io/mcp-filesystem-readonly \
  --set image.tag=v0.1.0
```

Then register with the Application Gateway via `terraform/modules/mcp`'s `backend_fqdns` (the reference deployment already does this).

## HTTP surface

| Method | Path       | Body                            | Response                        |
| ------ | ---------- | ------------------------------- | ------------------------------- |
| GET    | `/healthz` | —                               | `200 { ok: true }`              |
| POST   | `/list`    | `{ "path": "subdir" }`          | `{ entries: [{ name, type }] }` |
| POST   | `/read`    | `{ "path": "subdir/file.txt" }` | `{ content, size }`             |

## What it does NOT do

- **No write surface.** Read-only by name. If you need writes, build a separate MCP server with a different identity + RBAC.
- **No symlink traversal.** Symlinks are rejected, even ones that point inside ROOT — symlink behavior is too easy to get wrong.
- **No request streaming.** Reads buffer in memory; capped by `MAX_BYTES`.
