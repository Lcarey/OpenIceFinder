import { describe, expect, it } from "vitest";
import { parseMhrTable, refreshMhrSnapshot } from "./mhr-cache.js";
import type { MhrSnapshot } from "@openice/shared";

function table(age = 10, rank = false) {
  return `<table><thead><tr>${rank ? "<th>Rank<sup>▲</sup></th>" : ""}<th>Team</th><th>Record</th><th>Rating</th><th>AGD</th></tr></thead><tbody>${Array.from({ length: 12 }, (_, i) => `<tr>${rank ? `<td>${i + 1} NEW</td>` : ""}<td><a href="team_info.php?y=2026&amp;t=${i + 1}">Team ${i} ${age}U AAA</a></td><td>${i === 0 ? "0-2-0" : "5-1-0"}</td><td>${i === 1 ? "0.0" : "92.75"}</td><td>2.5</td></tr>`).join("")}</tbody></table>`;
}
describe("published MHR tables", () => {
  it("reads ratings without inventing a 10U rank and enforces five games", () => {
    const rows = parseMhrTable(table(), 2016);
    expect(rows[0]?.rating).toBeUndefined();
    expect(rows[1]?.rating).toBeUndefined();
    expect(rows[2]).toMatchObject({ rating: 92.75, birthYear: 2016, id: 3 });
    expect(rows[2]?.rank).toBeUndefined();
  });
  it("reads the actual 11U rank, ignoring NEW and sort-arrow decorations", () => {
    expect(parseMhrTable(table(11, true), 2015)[2]).toMatchObject({ rank: 3, rating: 92.75 });
  });
  it("rejects wrong-age, challenge, and empty tables", () => {
    expect(() => parseMhrTable(table(11), 2016)).toThrow();
    expect(() => parseMhrTable("Just a moment", 2016)).toThrow();
    expect(() => parseMhrTable("<table><th>Rating</th></table>", 2016)).toThrow();
  });
  it("keeps the last good age list after a failure, but replaces successful lists (including removed ratings)", async () => {
    const previous: MhrSnapshot = { version: 1, season: 2026, teams: [{ id: 99, name: "Saved 11U AAA", birthYear: 2015, rating: 85, url: "https://myhockeyrankings.com" }], sources: [{ birthYear: 2015, checkedAt: "2026-09-30T00:00:00Z", fetchedAt: "2026-09-30T00:00:00Z", url: "https://myhockeyrankings.com" }] };
    const result = await refreshMhrSnapshot({ previous, now: new Date("2026-10-01T00:00:00Z"), fetchTable: async (url) => { if (url.includes("123")) throw new Error("blocked"); return table(); } });
    expect(result.teams).toContainEqual(previous.teams[0]);
    expect(result.sources[1]).toMatchObject({ error: "blocked", fetchedAt: "2026-09-30T00:00:00Z", checkedAt: "2026-10-01T00:00:00.000Z" });
    expect(result.sources[0]?.error).toBeUndefined();
    expect(result.teams.find((t) => t.id === 1)?.rating).toBeUndefined();
    const wrongSeason = await refreshMhrSnapshot({ previous: { ...previous, season: 2025 }, fetchTable: async () => { throw new Error("blocked"); } });
    expect(wrongSeason.teams).toEqual([]);
  });
});
