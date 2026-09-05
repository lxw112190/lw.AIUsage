import { defineConfig, type Plugin, type ViteDevServer } from "vite";
import vue from "@vitejs/plugin-vue";
import { promises as fs } from "node:fs";
import { watch as watchFiles } from "node:fs";
import os from "node:os";
import path from "node:path";
import type { IncomingMessage, ServerResponse } from "node:http";

const json = (response: ServerResponse, body: unknown, status = 200): void => { response.statusCode = status; response.setHeader("content-type", "application/json"); response.end(JSON.stringify(body)); };
const isInsideHome = (target: string): boolean => { const home = path.resolve(os.homedir()); const resolved = path.resolve(target); return resolved === home || resolved.startsWith(`${home}${path.sep}`); };
async function bodyOf(request: IncomingMessage): Promise<Record<string, unknown>> { let body = ""; for await (const chunk of request) body += String(chunk); const parsed: unknown = JSON.parse(body || "{}"); return typeof parsed === "object" && parsed !== null ? parsed as Record<string, unknown> : {}; }
const devNativePlugin = (): Plugin => ({
  name: "lw-aiusage-dev-native",
  configureServer(server: ViteDevServer) {
    server.middlewares.use("/__aiusage_dev__/watch", (request, response) => {
      if (request.method !== "GET") { json(response, { ok: false, error: "watch endpoint requires GET" }, 405); return; }
      const url = new URL(request.url ?? "", "http://127.0.0.1"); const target = path.resolve(url.searchParams.get("path") ?? "");
      if (!target || !isInsideHome(target)) { json(response, { ok: false, error: "path outside home is not allowed" }, 403); return; }
      response.statusCode = 200; response.setHeader("content-type", "text/event-stream"); response.setHeader("cache-control", "no-cache"); response.setHeader("connection", "keep-alive"); response.write(": connected\n\n");
      let watcher: ReturnType<typeof watchFiles>;
      try { watcher = watchFiles(target, { recursive: true }, (_event, filename) => { response.write(`data: ${JSON.stringify({ path: path.join(target, String(filename)) })}\n\n`); }); } catch (error) { response.end(); return; }
      const heartbeat = setInterval(() => response.write(": ping\n\n"), 25_000);
      request.on("close", () => { clearInterval(heartbeat); watcher.close(); });
    });
    server.middlewares.use("/__aiusage_dev__", async (request, response) => {
      if (request.method !== "POST") { json(response, { ok: false, error: "read-only POST endpoint" }, 405); return; }
      try {
        const input = await bodyOf(request); const op = typeof input.op === "string" ? input.op : ""; const target = typeof input.path === "string" ? path.resolve(input.path) : "";
        if (op === "home") { json(response, { ok: true, home: os.homedir() }); return; }
        if (!target || !isInsideHome(target)) { json(response, { ok: false, error: "path outside home is not allowed" }, 403); return; }
        if (op === "exists") { try { await fs.access(target); json(response, { ok: true }); } catch { json(response, { ok: false }); } return; }
        if (op === "stat") { const stat = await fs.stat(target); json(response, { ok: true, stat: { size: stat.size, modifiedAt: stat.mtimeMs, isFile: stat.isFile() } }); return; }
        if (op === "list") { const entries = await fs.readdir(target, { withFileTypes: true }); const result = await Promise.all(entries.map(async (entry) => { const entryPath = path.join(target, entry.name); const stat = await fs.stat(entryPath); return { path: entryPath, name: entry.name, isFile: entry.isFile(), isDirectory: entry.isDirectory(), size: stat.size, modifiedAt: stat.mtimeMs }; })); json(response, { ok: true, entries: result }); return; }
        if (op === "readRange") { const start = typeof input.start === "number" ? Math.max(0, input.start) : 0; const end = typeof input.end === "number" ? input.end : undefined; const handle = await fs.open(target, "r"); try { const stat = await handle.stat(); const length = Math.max(0, Math.min(end ?? stat.size, stat.size) - start); const buffer = Buffer.alloc(length); await handle.read(buffer, 0, length, start); json(response, { ok: true, data: buffer.toString("base64") }); } finally { await handle.close(); } return; }
        json(response, { ok: false, error: "unknown operation" }, 400);
      } catch (error) { json(response, { ok: false, error: error instanceof Error ? error.message : "bridge error" }, 500); }
    });
  },
});

export default defineConfig({ plugins: [vue(), devNativePlugin()], resolve: { alias: { "@lw-aiusage/core": path.resolve(__dirname, "../../packages/core/src"), "@lw-aiusage/platform": path.resolve(__dirname, "../../packages/platform/src"), "@lw-aiusage/storage": path.resolve(__dirname, "../../packages/storage/src"), "@lw-aiusage/collectors": path.resolve(__dirname, "../../packages/collectors/src"), "@lw-aiusage/application": path.resolve(__dirname, "../../packages/application/src") } } });
