import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { Program } from "@openice/shared";
import { describe, expect, it } from "vitest";
import { fetchCrossbarProgram, mergeCrossbarRows, parseCrossbarSchedule, parseCrossbarTeamName, parseCrossbarTeams } from "./crossbar.js";
import { refreshPrograms } from "./index.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

const program: Program = {
  id: "ahc",
  name: "Arlington Hockey Club",
  shortName: "AHC",
  rinkId: "ed-burns-arlington",
  website: "https://www.arlingtonice.com/",
  source: { kind: "crossbar", baseUrl: "https://www.arlingtonice.com", homeLocationPattern: "^(arlington( 1| rink)?|ed burns.*)$" },
};

const pages: Record<string, string> = {
  "https://www.arlingtonice.com/": fixture("crossbar-home.html"),
  "https://www.arlingtonice.com/team/226133/schedule": fixture("crossbar-squirt-aaa.html"),
  "https://www.arlingtonice.com/team/226135/schedule": fixture("crossbar-squirt-a.html"),
};
const fakeFetch = async (url: string) => {
  const page = pages[url];
  if (!page) throw new Error(`HTTP 404 for ${url}`);
  return page;
};

describe("crossbar parsing", () => {
  it("lists teams from the club home page without duplicates and with entities decoded", () => {
    const teams = parseCrossbarTeams(pages["https://www.arlingtonice.com/"]!, program.source.baseUrl);
    expect(teams.map((t) => t.name)).toEqual(["Squirt AAA (1)", "Squirt AA (2)", "Squirt A (3)", "Will O'Neill Skills"]);
    expect(teams[0]!.url).toBe("https://www.arlingtonice.com/team/226133/calendar");
  });

  it("reads the schedule list view rows", () => {
    const html = pages["https://www.arlingtonice.com/team/226133/schedule"]!;
    expect(parseCrossbarTeamName(html)).toBe("Squirt AAA (1)");
    const rows = parseCrossbarSchedule(html, "Squirt AAA (1)");
    expect(rows).toHaveLength(6);
    const game = rows[0]!;
    expect(game.type).toBe("game");
    expect(game.opponent).toBe("@ Natick Squirt 1");
    expect(game.location).toBe("William L. Chase Arena");
    expect(game.note).toMatch(/scrimmage/);
    const shared = rows[1]!;
    expect(shared).toMatchObject({ type: "practice", location: "Arlington 1", others: ["Squirt AA (2)", "Amanda Pelkey Practice"] });
    expect(shared.from).toEqual({ hour: 18, minute: 10 });
    expect(shared.to).toEqual({ hour: 19, minute: 0 });
    expect(rows[2]!.type).toBe("meeting");
  });
});

describe("crossbar merging", () => {
  it("collapses the same slot published by several teams into one event listing everyone on the ice", async () => {
    const teams = parseCrossbarTeams(pages["https://www.arlingtonice.com/"]!, program.source.baseUrl);
    const rows = [
      ...parseCrossbarSchedule(pages["https://www.arlingtonice.com/team/226133/schedule"]!, "Squirt AAA (1)"),
      ...parseCrossbarSchedule(pages["https://www.arlingtonice.com/team/226135/schedule"]!, "Squirt A (3)"),
    ];
    const events = mergeCrossbarRows(rows, program, teams);
    const sep10 = events.filter((e) => e.start.startsWith("2026-09-10"));
    expect(sep10).toHaveLength(1);
    expect(sep10[0]).toMatchObject({
      start: "2026-09-10T18:10:00-04:00",
      end: "2026-09-10T19:00:00-04:00",
      atHomeRink: true,
      teams: ["Squirt A (3)", "Squirt AAA (1)"],
      teamIds: ["226135", "226133"],
    });
    const sep13 = events.filter((e) => e.start.startsWith("2026-09-13") && e.atHomeRink).map((e) => `${e.start.slice(11, 16)} ${e.teams.join(" + ")}`);
    expect(sep13).toEqual(["16:10 Squirt A (3) + Squirt AA (2) + Will O'Neill Skills", "17:20 PeeWee AA (2) + Squirt AAA (1) + Will O'Neill Skills"]);
    expect(events.find((e) => e.type === "game")?.atHomeRink).toBe(false);
  });

  it("fetches every team, tolerates a missing team page, and restricts to the refresh window", async () => {
    const result = await fetchCrossbarProgram(program, {
      rangeStart: new Date("2026-09-13T04:00:00Z"),
      rangeEnd: new Date("2026-09-20T04:00:00Z"),
      log: () => {},
      fetch: fakeFetch,
    });
    expect(result.teams).toHaveLength(4);
    expect(result.errors).toHaveLength(2); // Squirt AA (2) and Skills pages are not in the fixture set
    expect(result.events.every((e) => e.start >= "2026-09-13")).toBe(true);
    expect(result.events.filter((e) => e.atHomeRink).length).toBeGreaterThan(0);
  });

  it("refreshPrograms produces an index entry and survives a failing program", async () => {
    const broken: Program = { ...program, id: "broken", source: { ...program.source, baseUrl: "https://nowhere.example" } };
    const { feeds, index } = await refreshPrograms({
      programs: [program, broken],
      rangeStart: new Date("2026-09-01T04:00:00Z"),
      rangeEnd: new Date("2026-12-01T05:00:00Z"),
      fetch: fakeFetch,
    });
    expect(feeds).toHaveLength(2);
    expect(index[0]).toMatchObject({ ok: true, teamCount: 4 });
    expect(index[0]!.homeEventCount).toBeGreaterThan(0);
    expect(index[1]).toMatchObject({ ok: false, eventCount: 0 });
    expect(index[1]!.errors[0]).toMatch(/404/);
  });

  it("keeps the previous feed when the club site is down", async () => {
    const good = (await refreshPrograms({ programs: [program], rangeStart: new Date("2026-09-01T04:00:00Z"), rangeEnd: new Date("2026-12-01T05:00:00Z"), fetch: fakeFetch })).feeds[0]!;
    const { feeds, index } = await refreshPrograms({
      programs: [program],
      rangeStart: new Date("2026-09-01T04:00:00Z"),
      rangeEnd: new Date("2026-12-01T05:00:00Z"),
      fetch: async (url) => {
        throw new Error(`HTTP 502 for ${url}`);
      },
      previous: async () => good,
    });
    expect(feeds[0]!.events).toEqual(good.events);
    expect(feeds[0]!.fetchedAt).toBe(good.fetchedAt);
    expect(feeds[0]!.errors[0]).toMatch(/502.*showing schedules fetched/);
    expect(index[0]!.ok).toBe(true);
  });
});

describe("carryOverEvents", () => {
  it("keeps a failed team's solo events from the previous run but not slots other teams already reported", async () => {
    const { carryOverEvents } = await import("./index.js");
    const mk = (id: string, start: string, teamIds: string[], location = "Arlington 1"): import("@openice/shared").ProgramEvent => ({
      id,
      type: "practice",
      start,
      end: start.replace("T17:", "T18:"),
      location,
      atHomeRink: true,
      teams: teamIds,
      teamIds,
      url: "",
    });
    const previous = {
      program,
      fetchedAt: "",
      rangeStart: "",
      rangeEnd: "",
      teams: [],
      errors: [],
      events: [
        mk("shared", "2026-09-15T17:00:00-04:00", ["226127", "226129"]),
        mk("solo", "2026-09-16T17:00:00-04:00", ["226127"]),
        mk("old", "2026-09-01T17:00:00-04:00", ["226127"]),
        mk("other", "2026-09-17T17:00:00-04:00", ["226133"]),
      ],
    };
    const current = [mk("shared-from-other-team", "2026-09-15T17:00:00-04:00", ["226129"])];
    const carried = carryOverEvents(current, previous, ["226127"], new Date("2026-09-13T04:00:00Z"), new Date("2026-10-18T04:00:00Z"));
    expect(carried.map((e) => e.id)).toEqual(["solo"]);
    expect(carryOverEvents(current, undefined, ["226127"], new Date(0), new Date(1e13))).toEqual([]);
  });
});
