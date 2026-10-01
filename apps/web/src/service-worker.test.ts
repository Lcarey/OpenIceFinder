// @vitest-environment node
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { describe, expect, it, vi } from "vitest";

function worker() {
  const saved = new Map<string, Response>();
  const key = (r: Request | string) => typeof r === "string" ? r : r.url;
  const cache = {
    match: async (r: Request | string) => saved.get(key(r))?.clone(),
    put: vi.fn(async (r: Request | string, response: Response) => { saved.set(key(r), response.clone()); }),
    addAll: vi.fn(async () => {}),
  };
  let now = 1_000_000;
  const fetch = vi.fn(async () => new Response('{"revision":1}', { headers: { "Content-Type": "application/json" } }));
  const events: Record<string, (e: unknown) => void> = {};
  const context = vm.createContext({ VERSION: "test", ASSETS: ["/index.html", "/rangers.html"],
    Request, Response, Headers, URL, AbortSignal, Date: { now: () => now }, fetch,
    caches: { open: async () => cache, match: cache.match },
    self: { location: { origin: "https://test.example" }, addEventListener: (name: string, callback: (e: unknown) => void) => { events[name] = callback; } },
  });
  vm.runInContext(readFileSync(new URL("../service-worker.js", import.meta.url), "utf8"), context);
  const route = vm.runInContext("route", context) as (r: Request) => Promise<Response>;
  return { route, fetch, cache, saved, events, advance: () => { now += 5 * 60 * 1000 + 1; } };
}

describe("phone data cache", () => {
  it("downloads a feed once, shares concurrent requests, then validates it after five minutes", async () => {
    const w = worker(), req = new Request("https://test.example/data/rangers.json");
    const pair = await Promise.all([w.route(req), w.route(req)]);
    expect(await pair[0]!.json()).toEqual({ revision: 1 });
    expect(await pair[1]!.json()).toEqual({ revision: 1 });
    await w.route(req);
    expect(w.fetch).toHaveBeenCalledTimes(1);
    w.advance();
    w.fetch.mockResolvedValue(new Response('{"revision":2}', { headers: { "Content-Type": "application/json" } }));
    expect(await (await w.route(req)).json()).toEqual({ revision: 2 });
    expect(w.fetch).toHaveBeenCalledTimes(2);
  });
  it("keeps saved schedules offline and never overwrites them with an error/HTML response", async () => {
    const w = worker(), req = new Request("https://test.example/data/youth-hockey.json");
    await w.route(req); w.advance();
    w.fetch.mockRejectedValueOnce(new Error("offline"));
    expect(await (await w.route(req)).json()).toEqual({ revision: 1 });
    w.fetch.mockResolvedValue(new Response("<html>error</html>", { status: 503 }));
    expect(await (await w.route(req)).json()).toEqual({ revision: 1 });
    expect(w.cache.put).toHaveBeenCalledTimes(1);
  });
  it("returns fresh online data even when the browser storage quota is full", async () => {
    const w = worker();
    w.cache.put.mockRejectedValue(new Error("quota"));
    expect(await (await w.route(new Request("https://test.example/data/index.json"))).json()).toEqual({ revision: 1 });
  });
  it("serves both cached entry pages, including the Rangers alias", async () => {
    const w = worker();
    w.saved.set("/rangers.html", new Response("Rangers shell"));
    w.saved.set("/index.html", new Response("Main shell"));
    for (const pathname of ["/rangers", "/rangersa/"]) {
      expect(await (await w.route({ url: `https://test.example${pathname}`, mode: "navigate" } as Request)).text()).toBe("Rangers shell");
    }
    expect(await (await w.route({ url: "https://test.example/", mode: "navigate" } as Request)).text()).toBe("Main shell");
    expect(w.fetch).not.toHaveBeenCalled();
  });
});
