import { describe, expect, it } from "vitest";
import { selectYouthGames, youthCalendarUrl, youthDirectionsUrl, youthDriveLabel, type YouthGame, type YouthHockeyFeed } from "./youth-hockey.js";
const now = new Date("2026-10-30T14:00:00Z");
const game: YouthGame = { id: "g", sourceId: "fed", league: "FED Elite", birthYear: 2015, division: "2015 Elite", home: { id: "h", name: "Eagles & Co", eligible: true, division: "2015 Elite" }, away: { id: "a", name: "Kings / Elite", eligible: false, division: "2015 AAA" }, start: "2026-11-01T14:00:00Z", venue: { id: "v", name: "Arena", address: "1 Rink St, Boston, MA 02101", town: "Boston" }, iceSheet: "East", driveSeconds: 1799.9, driveMeters: 9000, sourceUrl: "https://example.org/schedule?a=1&b=2", verifiedAt: now.toISOString() };
const feed = (games: YouthGame[]): YouthHockeyFeed => ({ version: 1, generatedAt: now.toISOString(), rangeStart: now.toISOString(), rangeEnd: "2027-01-28T14:00:00Z", sources: [], games });
describe("youth calendar", () => {
  it("encodes matchup, venue, source, privacy, timezone and fallback across DST", () => {
    const url = new URL(youthCalendarUrl(game));
    expect(url.origin).toBe("https://calendar.google.com");
    const p = url.searchParams;
    expect(p.get("text")).toBe("Watch hockey: Kings / Elite vs Eagles & Co — 2015");
    expect(p.get("dates")).toBe("20261101T140000Z/20261101T153000Z");
    expect(p.get("stz")).toBe("America/New_York");
    expect(p.get("etz")).toBe("America/New_York");
    expect(p.get("location")).toBe("Arena, East, 1 Rink St, Boston, MA 02101");
    expect(p.get("details")).toContain("estimated at 90 minutes");
    expect(p.get("details")).toContain(game.sourceUrl);
    expect(p.get("details")).toContain("do not automatically update");
    expect(p.get("details")).toContain("Schedule last verified:");
    expect(url.href).not.toMatch(/Webster|origin=/);
    expect(new URL(youthDirectionsUrl(game)).searchParams.has("origin")).toBe(false);
  });
  it("uses a published end time and safely falls back for invalid ends", () => {
    const published = new URL(youthCalendarUrl({ ...game, end: "2026-11-01T10:10:00-05:00" })).searchParams;
    expect(published.get("dates")).toBe("20261101T140000Z/20261101T151000Z");
    expect(published.get("details")).not.toContain("estimated at 90 minutes");
    for (const end of ["invalid", "2026-11-01T13:00:00Z"]) expect(new URL(youthCalendarUrl({ ...game, end })).searchParams.get("dates")).toContain("/20261101T153000Z");
  });
});
describe("youth filters", () => {
  it("uses Eastern calendar days over the fall DST weekend", () => {
    const rows = [game, { ...game, id: "late", start: "2026-11-02T04:30:00Z" }, { ...game, id: "monday", start: "2026-11-02T05:00:00Z" }];
    expect(selectYouthGames(feed(rows), { window: "weekend" }, now).map(g => g.id)).toEqual(["g", "late"]);
    expect(selectYouthGames(feed(rows), { window: "today" }, now)).toHaveLength(0);
  });
  it("enforces exact drive cutoff, freshness, birth year, league and one eligible team", () => {
    const rows = [game, { ...game, id: "cutoff", driveSeconds: 1800 }, { ...game, id: "old", verifiedAt: "2026-10-28T13:59:59Z" }, { ...game, id: "bad", home: { ...game.home, eligible: false } }];
    expect(selectYouthGames(feed(rows), { window: "month", year: 2015, league: "FED Elite" }, now).map(g => g.id)).toEqual(["g"]);
    expect(selectYouthGames(feed(rows), { window: "month", year: 2016 }, now)).toHaveLength(0);
    expect(youthDriveLabel(1799.9)).toBe("<30 min");
  });
});
