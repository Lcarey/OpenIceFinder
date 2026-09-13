import type { Rink } from "@openice/shared";
import { describe, expect, it } from "vitest";
import { Classifier } from "./classify.js";
import { refreshAll, refreshWindow } from "./refresh.js";

const rinkA: Rink = {
  id: "a",
  name: "Rink A",
  town: "Arlington",
  address: "",
  lat: 0,
  lng: 0,
  driveMinutes: 3,
  driveMiles: 1,
  source: { kind: "link-only" },
};
const rinkB: Rink = { ...rinkA, id: "b", name: "Rink B", driveMinutes: 10, source: { kind: "ical", url: "https://x" } };

describe("refreshWindow", () => {
  it("starts at local midnight in Boston", () => {
    const { rangeStart, rangeEnd } = refreshWindow(new Date("2026-09-13T15:14:00Z"), 7);
    expect(rangeStart.toISOString()).toBe("2026-09-13T04:00:00.000Z");
    expect(rangeEnd.toISOString()).toBe("2026-09-20T04:00:00.000Z");
  });
});

describe("refreshAll", () => {
  it("tolerates a failing rink and classifies the rest", async () => {
    const classifier = new Classifier({ version: 1, entries: [] }, { model: "test" });
    const now = new Date("2026-09-13T15:00:00Z");
    const result = await refreshAll({
      rinks: [rinkB, rinkA],
      classifier,
      openai: async () => {
        throw new Error("no model");
      },
      openaiModel: "test",
      now,
      fetchEvents: async (rink) => {
        if (rink.id === "a") throw new Error("site down");
        return [
          { title: "Adult Stick & Puck", start: "2026-09-14T12:00:00-04:00", end: "2026-09-14T13:00:00-04:00" },
          { title: "Adult Stick & Puck", start: "2026-09-14T12:00:00-04:00", end: "2026-09-14T13:00:00-04:00" },
          { title: "penguins", start: "2026-09-14T14:00:00-04:00", end: "2026-09-14T15:00:00-04:00" },
        ];
      },
    });

    const feedA = result.feeds.find((f) => f.rink.id === "a")!;
    expect(feedA.events).toEqual([]);
    expect(feedA.errors[0]).toContain("site down");

    const feedB = result.feeds.find((f) => f.rink.id === "b")!;
    expect(feedB.events.map((e) => [e.title, e.category, e.classifiedBy])).toEqual([
      ["Adult Stick & Puck", "stick_puck_adult", "rule"],
      ["penguins", "private_rental", "default"],
    ]);
    expect(feedB.events[0]!.id).toMatch(/^b-/);

    expect(result.index.rinks.map((r) => r.rink.id)).toEqual(["a", "b"]);
    const indexB = result.index.rinks[1]!;
    expect(indexB.openIceCount).toBe(1);
    expect(indexB.nextOpenIce?.title).toBe("Adult Stick & Puck");
    expect(indexB.ok).toBe(true);
    expect(result.index.rinks[0]!.ok).toBe(false);
  });
});
