import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..");
const dataDir = path.join(repoRoot, "data");

/** Serve the locally refreshed `data/` directory at `/data/*` during dev and preview. */
function localDataPlugin(): Plugin {
  const handler = (req: { url?: string }, res: any, next: () => void) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (!url.startsWith("/data/")) return next();
    const rel = url.slice("/data/".length).replace(/\.\./g, "");
    const file = path.join(dataDir, rel);
    if (!existsSync(file) || !statSync(file).isFile()) {
      res.statusCode = 404;
      res.end("not found");
      return;
    }
    res.setHeader("Content-Type", "application/json; charset=utf-8");
    res.setHeader("Cache-Control", "no-store");
    res.end(readFileSync(file));
  };
  return {
    name: "openice-local-data",
    configureServer(server) {
      server.middlewares.use(handler);
    },
    configurePreviewServer(server) {
      server.middlewares.use(handler);
    },
  };
}

export default defineConfig({
  plugins: [react(), localDataPlugin()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: { sourcemap: true },
});
