import { describe, expect, it } from "vitest";
import { attachMhrToFeed, parseMhrRank } from "./mhr.js";
import type { RangersFeed, RangersStandingRow } from "@openice/shared";

const rangers: RangersStandingRow = {
  teamId: "797",
  name: "Boston Jr. Rangers 16 - Elite",
  shortName: "Jr. Rangers 16 - Elite",
  division: "2016 White",
  rank: 5,
  isUs: true,
  record: { gp: 1, wins: 0, losses: 1, ties: 0, points: 0, gf: 0, ga: 7, gd: -7, streak: "L 1", lastFive: "0-1-0" },
};

describe("parseMhrRank", () => {
  it("reads a USA 10U listing rank from team-page HTML", () => {
    expect(parseMhrRank(`<a>USA 10U - All</a><span>rank 48</span>`)).toBe(48);
    expect(parseMhrRank(`{"name":"USA 10U - All","rank":12}`)).toBe(12);
  });

  it("ignores Cloudflare challenges and unpublished 0.00 ratings", () => {
    expect(parseMhrRank(`<html>Just a moment... cf-mitigated challenge-platform</html>`)).toBeUndefined();
    expect(parseMhrRank(`<div>Rating</div><div>0.0</div><a>USA 10U - All</a>`)).toBeUndefined();
  });
});

describe("attachMhrToFeed", () => {
  it("always attaches the MHR team URL and fills rank when present", () => {
    const feed = {
      team: rangers,
      standings: [rangers],
      upcoming: [{ opponent: rangers, game: { date: "2026-09-27" } }],
    } as unknown as RangersFeed;
    const blank = attachMhrToFeed(feed);
    expect(blank.team.mhrUrl).toBe("https://myhockeyrankings.com/team-info/1116/2026");
    expect(blank.team.mhrRank).toBeUndefined();
    expect(attachMhrToFeed(feed, new Map([[1116, 48]])).team.mhrRank).toBe(48);
  });
});
