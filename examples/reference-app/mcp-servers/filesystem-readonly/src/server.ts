/**
 * filesystem-readonly MCP server (sample).
 *
 * Exposes a tiny subset of an MCP server's surface — `list(path)` and
 * `read(path)` over HTTP — sandboxed to a single root mounted at MCP_ROOT.
 *
 * Production MCP servers ship over the real MCP transport (JSON-RPC over
 * stdio / SSE). This reference uses plain HTTP so the Application Gateway
 * + WAF v2 from terraform/modules/mcp can front it without protocol
 * translation. The agent runtime treats the HTTP endpoint as a tool's
 * `execute`.
 */

import { readFile, readdir, stat } from 'node:fs/promises';
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http';
import { isAbsolute, join, normalize, resolve } from 'node:path';

const ROOT = resolve(process.env['MCP_ROOT'] ?? '/var/mcp/root');
const PORT = Number(process.env['PORT'] ?? '8080');
const MAX_BYTES = Number(process.env['MAX_BYTES'] ?? String(1024 * 1024)); // 1 MiB

/** Resolve a user-supplied path safely within ROOT. Throws if the resolved
 *  path tries to escape (../, absolute path, symlink-pointing-outside). */
const resolveSafe = async (input: string): Promise<string> => {
  if (typeof input !== 'string' || input.length === 0) {
    throw new Error('path must be a non-empty string');
  }
  if (isAbsolute(input)) {
    throw new Error('absolute paths are not allowed');
  }
  const joined = join(ROOT, normalize(input));
  const resolved = resolve(joined);
  if (!resolved.startsWith(ROOT)) {
    throw new Error('path escapes the configured ROOT');
  }
  // Defense in depth — stat will follow symlinks; we reject if it points outside.
  const s = await stat(resolved);
  if (s.isSymbolicLink()) {
    throw new Error('symbolic links not allowed');
  }
  return resolved;
};

const sendJson = (res: ServerResponse, status: number, body: unknown): void => {
  res.writeHead(status, { 'content-type': 'application/json' });
  res.end(JSON.stringify(body));
};

const sendError = (res: ServerResponse, status: number, message: string): void => {
  sendJson(res, status, { error: message });
};

const readBody = async (req: IncomingMessage): Promise<unknown> => {
  const chunks: Buffer[] = [];
  for await (const chunk of req) {
    chunks.push(chunk as Buffer);
    if (chunks.reduce((s, c) => s + c.length, 0) > 64 * 1024) {
      throw new Error('request body too large');
    }
  }
  if (chunks.length === 0) return null;
  return JSON.parse(Buffer.concat(chunks).toString('utf8')) as unknown;
};

const server = createServer((req, res) => {
  void (async () => {
    if (req.method === 'GET' && req.url === '/healthz') {
      sendJson(res, 200, { ok: true });
      return;
    }

    if (req.method !== 'POST') {
      sendError(res, 405, 'POST only');
      return;
    }

    let body: unknown;
    try {
      body = await readBody(req);
    } catch (e) {
      sendError(res, 400, e instanceof Error ? e.message : String(e));
      return;
    }

    try {
      if (req.url === '/list') {
        const path = (body as { path?: string } | null)?.path ?? '.';
        const resolved = await resolveSafe(path);
        const entries = await readdir(resolved, { withFileTypes: true });
        sendJson(res, 200, {
          path,
          entries: entries.map((e) => ({
            name: e.name,
            type: e.isDirectory() ? 'dir' : e.isFile() ? 'file' : 'other',
          })),
        });
        return;
      }

      if (req.url === '/read') {
        const path = (body as { path?: string } | null)?.path ?? '';
        const resolved = await resolveSafe(path);
        const s = await stat(resolved);
        if (!s.isFile()) {
          sendError(res, 400, 'path is not a file');
          return;
        }
        if (s.size > MAX_BYTES) {
          sendError(res, 413, `file too large (${s.size} > ${MAX_BYTES})`);
          return;
        }
        const content = await readFile(resolved, 'utf8');
        sendJson(res, 200, { path, content, size: s.size });
        return;
      }

      sendError(res, 404, 'unknown route');
    } catch (e) {
      sendError(res, 400, e instanceof Error ? e.message : String(e));
    }
  })();
});

server.listen(PORT, () => {
  console.warn(
    JSON.stringify({
      level: 'info',
      service: 'mcp-filesystem-readonly',
      message: 'listening',
      port: PORT,
      root: ROOT,
    }),
  );
});
