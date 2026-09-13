import type { IceEvent } from "@openice/shared";
import { describe, expect, it } from "vitest";
import { formatTime, formatTimeRange, groupByDay, minutesIntoDay, shiftDateKey, shiftMonth, weekStartKey } from "./format";

describe("format helpers", () => {
  it("formats rink-local times", () => {
    expect(formatTime("2026-09-15T14:00:00-04:00")).toBe("2 pm");
    expect(formatTimeRange("2026-09-15T14:00:00-04:00", "2026-09-15T15:50:00-04:00")).toBe("2 pm – 3:50 pm");
  });

  it("does week and month math on date keys", () => {
    expect(weekStartKey("2026-09-15")).toBe("2026-09-13");
    expect(shiftDateKey("2026-09-30", 1)).toBe("2026-10-01");
    expect(shiftMonth("2026-12-14", 1)).toBe("2027-01-01");
  });

  it("groups events by local day", () => {
    const mk = (start: string): IceEvent => ({ id: start, rinkId: "r", title: "t", category: "stick_puck", classifiedBy: "rule", start, end: start });
    const groups = groupByDay([mk("2026-09-15T23:30:00-04:00"), mk("2026-09-15T08:00:00-04:00"), mk("2026-09-16T01:00:00-04:00")]);
    expect(groups.map((g) => [g.dateKey, g.events.length])).toEqual([
      ["2026-09-15", 2],
      ["2026-09-16", 1],
    ]);
  });

  it("computes minutes into the local day", () => {
    expect(minutesIntoDay("2026-09-15T14:30:00-04:00")).toBe(870);
    expect(minutesIntoDay("2026-09-16T00:10:00-04:00")).toBe(10);
  });
});
