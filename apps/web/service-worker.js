/* VERSION and ASSETS are injected by Vite. Only same-origin public app files are cached. */
const SHELL = `openice-shell-${VERSION}`;
const DATA = "openice-data-v1";
const DATA_FRESH_MS = 5 * 60 * 1000;
const pending = new Map();

self.addEventListener("install", (event) => {
  event.waitUntil(caches.open(SHELL).then((cache) => cache.addAll(ASSETS)).then(() => self.skipWaiting()));
});
self.addEventListener("activate", (event) => {
  event.waitUntil((async () => {
    // Keep the preceding shell for tabs that still have its content-hashed imports.
    const shells = (await caches.keys()).filter((key) => key.startsWith("openice-shell-") && key !== SHELL);
    await Promise.all(shells.slice(0, -1).map((key) => caches.delete(key)));
    await self.clients.claim();
  })());
});

async function dataResponse(request) {
  const cache = await caches.open(DATA);
  const saved = await cache.match(request);
  const savedAt = Number(saved?.headers.get("X-OpenIce-Cached-At") ?? 0);
  if (saved && Date.now() - savedAt < DATA_FRESH_MS) return saved;
  try {
    // The HTTP cache can validate ETags with a tiny 304 response when unchanged.
    const response = await fetch(request, { cache: "no-cache", signal: AbortSignal.timeout(10_000) });
    if (!response.ok || !response.headers.get("Content-Type")?.includes("application/json")) {
      if (saved) return saved;
      return response;
    }
    const headers = new Headers(response.headers);
    headers.set("X-OpenIce-Cached-At", String(Date.now()));
    const stored = new Response(await response.clone().blob(), { status: response.status, headers });
    await cache.put(request, stored).catch(() => {}); // Storage limits must not hide a fresh response.
    return response;
  } catch (error) {
    if (saved) return saved;
    throw error;
  }
}

async function route(request) {
  const url = new URL(request.url);
  if (url.pathname.startsWith("/data/") && url.pathname.endsWith(".json")) {
    // Coalesce concurrent React requests for the same feed, without sharing a consumed body.
    let response = pending.get(request.url);
    if (!response) {
      response = dataResponse(request).finally(() => pending.delete(request.url));
      pending.set(request.url, response);
    }
    return (await response).clone();
  }
  const cache = await caches.open(SHELL);
  if (request.mode === "navigate") {
    const shell = /^\/rangersa?\/?$/.test(url.pathname) ? "/rangers.html" : "/index.html";
    return (await cache.match(shell)) ?? fetch(request);
  }
  return (await cache.match(request)) ?? (await caches.match(request)) ?? fetch(request);
}

self.addEventListener("fetch", (event) => {
  const url = new URL(event.request.url);
  if (event.request.method !== "GET" || url.origin !== self.location.origin || url.pathname.startsWith("/data/drive-times/")) return;
  if (event.request.mode === "navigate" || ASSETS.includes(url.pathname) || (url.pathname.startsWith("/data/") && url.pathname.endsWith(".json"))) {
    event.respondWith(route(event.request));
  }
});
