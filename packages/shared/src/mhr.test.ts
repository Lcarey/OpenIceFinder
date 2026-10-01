import { describe, expect, it } from "vitest";
import { matchMhrTeam, type MhrSnapshot } from "./mhr.js";

const snapshot: MhrSnapshot = { version: 1, season: 2026, sources: [], teams: [
  { id: 1, name: "Worcester Jr Railers (Elite) 10U AAA", birthYear: 2016, rating: 88.9, url: "" },
  { id: 2, name: "Worcester Jr Railers (Select #1) 10U AAA", birthYear: 2016, url: "" },
  { id: 3, name: "Boston Junior Rangers 10U AAA", birthYear: 2016, url: "" },
  { id: 4, name: "Boston Junior Rangers 11U AAA", birthYear: 2015, rating: 84.24, rank: 84, url: "" },
  { id: 5, name: "Boston Jr Eagles (Elite) 10U AAA", birthYear: 2016, rating: 95.9, url: "" },
  { id: 6, name: "New Hampshire Avalanche (Elite #1) 10U AAA", birthYear: 2016, rating: 91.6, url: "" },
  { id: 7, name: "New Hampshire Avalanche (Elite #2) 10U AAA", birthYear: 2016, url: "" },
] };
describe("MHR roster matching", () => {
  it("keeps birth years and Elite/Select/numbered squads distinct", () => {
    expect(matchMhrTeam(snapshot, "Junior Railers 16 - Elite", 2016)?.id).toBe(1);
    expect(matchMhrTeam(snapshot, "Junior Railers 16 - Select 1", 2016)?.id).toBe(2);
    expect(matchMhrTeam(snapshot, "Boston Jr. Rangers 16 - Elite", 2016)?.id).toBe(3);
    expect(matchMhrTeam(snapshot, "Boston Jr. Rangers 15 - Elite", 2015)?.id).toBe(4);
    expect(matchMhrTeam(snapshot, "NH Avalanche 16 - Elite 2", 2016)?.id).toBe(7);
    expect(matchMhrTeam(snapshot, "NH Avalanche 16 - Elite", 2016)).toBeUndefined();
    expect(matchMhrTeam(snapshot, "Boston Jr. Rangers 16 - Select", 2016)).toBeUndefined();
  });
  it("only resolves a coach-labeled FED team when its Elite division is verified", () => {
    expect(matchMhrTeam(snapshot, "Boston Jr. Eagles - Spina", 2016, true)?.id).toBe(5);
    expect(matchMhrTeam(snapshot, "Boston Jr. Eagles - Spina", 2016)).toBeUndefined();
    expect(matchMhrTeam({ ...snapshot, season: 2025 }, "Boston Jr. Eagles - Spina", 2016, true)).toBeUndefined();
  });
});
