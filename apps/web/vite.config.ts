import { createHash } from "node:crypto";
import { existsSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import react from "@vitejs/plugin-react";
import { defineConfig, type Plugin } from "vite";

const webDir = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(webDir, "..", "..");
const dataDir = path.join(repoRoot, "data");

/** Serve `rangers.html` at `/rangers` so the tab title and link preview match production. */
function rangersHtmlPlugin(): Plugin {
  const rewrite = (req: { url?: string }, _res: unknown, next: () => void) => {
    const raw = req.url ?? "";
    const q = raw.indexOf("?");
    const path = q >= 0 ? raw.slice(0, q) : raw;
    const qs = q >= 0 ? raw.slice(q) : "";
    if (path === "/rangers" || path === "/rangers/" || path === "/rangersa" || path === "/rangersa/") req.url = `/rangers.html${qs}`;
    next();
  };
  return {
    name: "openice-rangers-html",
    configureServer(server) {
      server.middlewares.use(rewrite);
    },
    configurePreviewServer(server) {
      server.middlewares.use(rewrite);
    },
  };
}

/** Serve the locally refreshed `data/` directory at `/data/*` during dev and preview. */
function localDataPlugin(): Plugin {
  const handler = (req: { url?: string }, res: any, next: () => void) => {
    const url = (req.url ?? "").split("?")[0] ?? "";
    if (!url.startsWith("/data/")) return next();
    const rel = url.slice("/data/".length).replace(/\.\./g, "");
    if (rel.startsWith("drive-times/")) { res.statusCode = 403; res.end("forbidden"); return; }
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

/** Precache every app page/chunk; schedule JSON is saved only when visited. */
function offlinePlugin(): Plugin {
  return {
    name: "openice-offline",
    apply: "build",
    generateBundle(_options, bundle) {
      const files = Object.keys(bundle).filter((file) => /\.(?:js|css|html)$/.test(file));
      const version = createHash("sha256").update(files.map((file) => {
        const item = bundle[file]!;
        return item.type === "chunk" ? item.code : String(item.source);
      }).join("\n")).update(readFileSync(path.join(webDir, "service-worker.js")))
        .update(readFileSync(path.join(webDir, "index.html")))
        .update(readFileSync(path.join(webDir, "rangers.html")))
        .update(readFileSync(path.join(webDir, "public/rangers-logo.png")))
        .update(readFileSync(path.join(webDir, "public/favicon.svg")))
        .digest("hex").slice(0, 16);
      // Vite emits HTML after this hook, so include both entry pages explicitly.
      const assets = [...new Set([...files.map((file) => `/${file}`), "/index.html", "/rangers.html", "/favicon.svg", "/rangers-logo.png"])];
      const source = `const VERSION = ${JSON.stringify(version)};\nconst ASSETS = ${JSON.stringify(assets)};\n${readFileSync(path.join(webDir, "service-worker.js"), "utf8")}`;
      this.emitFile({ type: "asset", fileName: "sw.js", source });
    },
  };
}

export default defineConfig({
  plugins: [react(), rangersHtmlPlugin(), localDataPlugin(), offlinePlugin()],
  server: { port: 5174, strictPort: true },
  preview: { port: 4174, strictPort: true },
  build: {
    sourcemap: true,
    rollupOptions: {
      input: {
        main: path.join(webDir, "index.html"),
        rangers: path.join(webDir, "rangers.html"),
      },
    },
  },
});
