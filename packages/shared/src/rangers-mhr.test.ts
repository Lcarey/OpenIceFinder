import { describe, expect, it } from "vitest";
import { formatMhrRank, matchRangersMhrTeam, rangersMhrUrl } from "./rangers-mhr.js";

describe("matchRangersMhrTeam", () => {
  it("maps 2016 White Elite 9 names onto 10U MHR pages", () => {
    expect(matchRangersMhrTeam("Jr. Rangers 16 - Elite")?.id).toBe(1116);
    expect(matchRangersMhrTeam("Winter Club 16 - Elite")?.id).toBe(32702);
    expect(matchRangersMhrTeam("Avalanche 16 - Elite 2")?.id).toBe(1336);
    expect(matchRangersMhrTeam("Jr. Bruins 16 - Elite")?.id).toBe(1471);
    expect(matchRangersMhrTeam("Icemen 16 - Elite")?.id).toBe(6474);
    expect(matchRangersMhrTeam("Railers 16 - S 1")?.id).toBe(23032);
  });

  it("skips unknown clubs", () => {
    expect(matchRangersMhrTeam("Cape Cod TA Seahawks")).toBeUndefined();
  });
});

describe("formatMhrRank", () => {
  it("uses an em dash until MHR publishes a rank", () => {
    expect(formatMhrRank()).toBe("—");
    expect(formatMhrRank(0)).toBe("—");
    expect(formatMhrRank(48)).toBe("48");
  });
});

describe("rangersMhrUrl", () => {
  it("points at the 2026 team page", () => {
    expect(rangersMhrUrl(1116)).toBe("https://myhockeyrankings.com/team-info/1116/2026");
  });
});
