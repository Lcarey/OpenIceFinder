import { describe, expect, it } from "vitest";
import { refreshYouthHockey, resolveVenue, resolveIceSheet, type LocatedVenue, type RawYouthGame, type YouthSource } from "./core.js";
import { elite9Team, parseElite9Games } from "./elite9.js";
import { validateScheduleSeason, collectGameSheetPages, discoverExposureSchedule, FED_CONFIG, GameSheetCollector, parseGameSheetGames, type GameSheetRow } from "./gamesheet.js";
const now = new Date("2026-10-01T12:00:00Z");
const venue: LocatedVenue = { id: "edge", name: "The Edge Sports Center", address: "191 Hartwell Rd, Bedford, MA 01730", town: "Bedford", lat: 42.48, lng: -71.28, aliases: ["Edge", "Edge-Upper"], evidenceUrl: "https://example.org" };
const row: RawYouthGame = { sourceGameId: "1", birthYear: 2016, division: "2016 White", home: { id: "h", name: "Wizards 16 - Elite", eligible: true, division: "2016 Blue" }, away: { id: "a", name: "Opponent 16 - AAA", eligible: false, division: "2016 White" }, start: "2026-10-03T14:00:00Z", location: "Edge-Upper", sourceUrl: "https://example.org/schedule" };
const source = (rows = [row]): YouthSource => ({ id: "e9", name: "E9", league: "Elite 9", url: row.sourceUrl, collect: async () => rows });
const refresh = (sources = [source()], seconds = 1799.99) => refreshYouthHockey({ now, sources, venues: [venue], drive: async () => ({ seconds, meters: 10000 }) });

describe("normalization and snapshots", () => {
  it("resolves aliases and canonical sheets without guessing unknown venues", () => {
    expect(resolveVenue("Edge - Upper", [venue])?.id).toBe("edge");
    expect(resolveIceSheet("Edge-Upper")).toBe("Upper");
    expect(resolveIceSheet("The Edge Sports Center")).toBe("");
    expect(resolveVenue("Bedford", [venue])).toBeUndefined();
    expect(resolveVenue("TBD", [venue])).toBeUndefined();
  });
  it("applies unrounded <1800 seconds and excludes missing routes/venues", async () => {
    expect((await refresh()).games).toHaveLength(1);
    expect((await refresh(undefined, 1800)).games).toHaveLength(0);
    expect((await refresh([source([{ ...row, location: "Unknown" }])])).sources[0]?.excludedVenues).toEqual(["Unknown"]);
    expect((await refreshYouthHockey({ now, sources: [source()], venues: [venue], drive: async () => undefined })).games).toHaveLength(0);
    expect(JSON.stringify(await refresh())).not.toMatch(/"lat"|"lng"|Webster/);
  });
  it("deduplicates home/away and source copies but preserves doubleheaders", async () => {
    const copy = { ...row, sourceGameId: "2", home: row.away, away: row.home, location: "The Edge Sports Center Upper" };
    const later = { ...row, sourceGameId: "3", start: "2026-10-03T18:00:00Z" };
    const feed = await refresh([source([row, copy, later]), { ...source([copy]), id: "tournament" }]);
    expect(feed.games).toHaveLength(2);
  });
  it("replaces a successful snapshot after rescheduling and cancellation", async () => {
    const previous = await refresh();
    const common = { now, previous, venues: [venue], drive: async () => ({ seconds: 900, meters: 10000 }) };
    const moved = await refreshYouthHockey({ ...common, sources: [source([{ ...row, start: "2026-10-04T16:00:00Z" }])] });
    expect(moved.games).toHaveLength(1);
    expect(moved.games[0]?.start).toBe("2026-10-04T16:00:00Z");
    expect((await refreshYouthHockey({ ...common, sources: [source([])] })).games).toHaveLength(0);
  });
  it("preserves only a failed source for 48 hours and continues healthy sources", async () => {
    const previous = await refresh([source([{ ...row, start: "2026-10-05T14:00:00Z" }])]);
    const fail = { ...source(), collect: async () => { throw Error("unavailable"); } };
    const common = { previous, venues: [venue], drive: async () => ({ seconds: 900, meters: 10000 }), sources: [fail, { ...source([{ ...row, start: "2026-10-06T14:00:00Z" }]), id: "healthy" }] };
    const stale = await refreshYouthHockey({ ...common, now: new Date(now.getTime() + 48 * 3600000) });
    expect(stale.sources.map(s => s.status)).toEqual(["stale", "ok"]);
    expect(stale.games).toHaveLength(2);
    const expired = await refreshYouthHockey({ ...common, now: new Date(now.getTime() + 48 * 3600000 + 1) });
    expect(expired.sources[0]?.status).toBe("unavailable");
    expect(expired.games.map(g => g.sourceId)).toEqual(["healthy"]);
  });
});

describe("eligible rosters and public source parsing", () => {
  it.each(["Elite", "White", "Blue", "Red"])("includes explicitly Elite E9 rosters in %s divisions", division => {
    expect(elite9Team({ TeamID: "1", TeamName: "Boston Jr. Rangers 16 - Elite", DivisionName: `2016 ${division}` }, 2016).eligible).toBe(true);
    expect(elite9Team({ TeamID: "2", TeamName: "Rangers 16 - Select", DivisionName: `2016 ${division}` }, 2016).eligible).toBe(false);
    expect(elite9Team({ TeamID: "3", TeamName: "Rangers 15 - Elite", DivisionName: "2015 Elite" }, 2016).eligible).toBe(false);
  });
  it("requires a confirmed time, excludes completed games, and parses Eastern DST", () => {
    const team = { TeamID: "1", TeamName: "Wizards 16 - Elite", DivisionName: "2016 Blue" };
    const game = { CurrTeamID: "1", OpponentTeamID: "2", OpponentName3: "vs Opponent", DivisionName: "2016 Blue", GameDate: "2026-11-01", StartTime: "9:00 AM", GameStatus: "Upcoming", LocationName: "Edge-Upper" };
    const result = parseElite9Games([game, { ...game, StartTime: "TBD" }, { ...game, GameStatus: "Final" }], [team]);
    expect(result).toHaveLength(1);
    expect(new Date(result[0]!.start).toISOString()).toBe("2026-11-01T14:00:00.000Z");
    expect(result[0]?.away.eligible).toBe(false);
  });
  const fed: GameSheetRow = { gameId: 5, status: "scheduled", timeStampZulu: "2026-10-03T17:25:00Z", location: "BSI East", home: { id: 1, title: "Eagles", division: { id: 80179, title: "2015 Elite" } }, visitor: { id: 2, title: "Other", division: { id: 0, title: "Exhibition" } } };
  it("uses verified FED division IDs and permits one qualified team", () => {
    const games = parseGameSheetGames([fed, { ...fed, status: "cancelled" }, { ...fed, gameType: "practice" }, { ...fed, timeStampZulu: "2026-10-03" }, { ...fed, location: "" }], { season: FED_CONFIG.season, fedYear: 2015 });
    expect(games).toHaveLength(1);
    expect(games[0]?.home.eligible).toBe(true);
    expect(games[0]?.away.eligible).toBe(false);
    expect(parseGameSheetGames([fed], { season: FED_CONFIG.season, fedYear: 2016 })).toHaveLength(0);
  });
  it("requires explicit supplemental roster evidence and exact names", () => {
    const rosters = [{ name: "Eagles", birthYear: 2015 as const, evidenceUrl: "https://official.example/elite" }];
    expect(parseGameSheetGames([fed], { season: "100", rosters })).toHaveLength(1);
    expect(parseGameSheetGames([fed], { season: "100", rosters: [] })).toHaveLength(0);
  });
  it("rejects previous-season FED and unpublished tournament schedules", async () => {
    expect(() => validateScheduleSeason("Eastern Hockey Federation - 2025-2026", "2026-2027")).toThrow("previous-season");
    await expect(new GameSheetCollector().fed(2015, new Date("2027-09-01T12:00:00Z"))).rejects.toThrow("season configuration");
    expect(discoverExposureSchedule('<a href="https://gamesheetstats.com/seasons/11556/schedule">2025 Schedule</a>', 2026)).toBeUndefined();
    expect(discoverExposureSchedule('<a href="https://gamesheetstats.com/seasons/12345/games">2026 Schedule</a>', 2026)).toContain("12345");
  });
});


describe("GameSheet pagination", () => {
  it("collects all capped pages even when they are smaller than the requested limit", async () => {
    const offsets: number[] = [];
    const games = await collectGameSheetPages(async offset => {
      offsets.push(offset);
      return { data: Array.from({ length: Math.min(2, 5 - offset) }, (_, i) => ({ gameId: offset + i })), meta: { filtered: 5 } };
    });
    expect(offsets).toEqual([0, 2, 4]);
    expect(games).toHaveLength(5);
  });
  it("rejects truncated, repeated, or malformed pages rather than publish partial games", async () => {
    await expect(collectGameSheetPages(async () => ({ data: [], meta: { filtered: 3 } }))).rejects.toThrow("complete schedule");
    await expect(collectGameSheetPages(async () => ({ data: [{ gameId: 1 }] }))).rejects.toThrow("repeated");
    await expect(collectGameSheetPages(async () => ({}))).rejects.toThrow("unexpected");
  });
});
