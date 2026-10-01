import { describe, expect, it, vi } from "vitest";
import { MhrAccessBlockedError, paceMhrRequests } from "./mhr-request-policy.js";
import { refreshMhrSnapshot } from "./mhr-cache.js";
import type { MhrSnapshot } from "@openice/shared";

describe("polite MYHockey request policy", () => {
  it("makes one request per list and waits between lists, with a variable bounded gap", async () => {
    const fetch = vi.fn(async () => "table");
    let release!: () => void;
    const wait = vi.fn(() => new Promise<void>((resolve) => { release = resolve; }));
    const random = vi.fn().mockReturnValueOnce(0).mockReturnValueOnce(0.99999);
    const paced = paceMhrRequests(fetch, { wait, random });
    await paced("10U");
    expect(wait).not.toHaveBeenCalled();
    const second = paced("11U");
    expect(wait).toHaveBeenLastCalledWith(30_000);
    expect(fetch).toHaveBeenCalledTimes(1);
    release();
    await second;
    const third = paced("12U");
    expect(wait).toHaveBeenLastCalledWith(90_000);
    expect(fetch).toHaveBeenCalledTimes(2);
    release();
    await third;
    expect(fetch.mock.calls).toHaveLength(3);
  });

  it("stops all remaining age requests after a block and preserves both cached age lists", async () => {
    const previous: MhrSnapshot = {
      version: 1, season: 2026,
      teams: [2016, 2015].map((birthYear) => ({ id: birthYear, birthYear, name: "Saved AAA", rating: 91, url: "https://myhockeyrankings.com" })),
      sources: [2016, 2015].map((birthYear) => ({ birthYear, url: "https://myhockeyrankings.com", checkedAt: "2026-09-30T00:00:00Z", fetchedAt: "2026-09-30T00:00:00Z" })),
    };
    const fetch = vi.fn(async () => { throw new MhrAccessBlockedError("HTTP 429"); });
    const wait = vi.fn();
    const result = await refreshMhrSnapshot({ previous, fetchTable: paceMhrRequests(fetch, { wait }) });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(wait).not.toHaveBeenCalled();
    expect(result.teams).toEqual(previous.teams);
    expect(result.sources[0]?.error).toBe("HTTP 429");
    expect(result.sources[1]?.error).toContain("Skipped after MYHockey blocked this run");
    expect(result.sources.map((s) => s.fetchedAt)).toEqual(previous.sources.map((s) => s.fetchedAt));
  });

  it("does not retry a normal failure but still paces the next age list", async () => {
    const fetch = vi.fn().mockRejectedValueOnce(new Error("Timeout")).mockResolvedValueOnce("table");
    const wait = vi.fn(async () => {});
    const paced = paceMhrRequests(fetch, { wait });
    await expect(paced("10U")).rejects.toThrow("Timeout");
    expect(await paced("11U")).toBe("table");
    expect(fetch).toHaveBeenCalledTimes(2);
    expect(wait).toHaveBeenCalledTimes(1);
  });
});
