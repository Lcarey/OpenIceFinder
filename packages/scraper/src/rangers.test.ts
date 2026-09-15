import { describe, expect, it } from "vitest";
import {
  buildBelief,
  buildRangersFeed,
  formatRecord,
  flattenSchedule,
  cookieHeaderFromSetCookie,
  gamesForTeam,
  gameDateKey,
  isHomeGame,
  isRangers2016,
  opponentDisplayName,
  playedFromRow,
  refreshRangers,
  reuseHiddenUpcoming,
  scoresForCurrent,
  selectUpcoming,
  type VaGameRow,
  type VaScheduleResponse,
  type VaStandingsResponse,
  type VaTeamRow,
} from "./rangers.js";

function team(partial: VaTeamRow): VaTeamRow {
  return partial;
}

function game(partial: VaGameRow): VaGameRow {
  return partial;
}

const rangers: VaTeamRow = team({
  TeamID: "797",
  TeamName: "Boston Jr. Rangers 16 - Elite",
  Team: "Jr. Rangers 16 - Elite",
  Team3: "Jr. Rangers 16 - E",
  DivisionName: "2016 White",
  Games: 1,
  Wins: 0,
  Losses: 1,
  Ties: 0,
  Points: 0,
  PointsFor: 0,
  PointsAgainst: 7,
  PointsDiff: -7,
  Streak: "L 1",
  LastXGames: "0-1-0",
});

const winter: VaTeamRow = team({
  TeamID: "902",
  TeamName: "Winter Club 16 - Elite",
  Team: "Winter Club 16 - Elite",
  DivisionName: "2016 White",
  Games: 2,
  Wins: 1,
  Losses: 1,
  Ties: 0,
  Points: 2,
  PointsFor: 13,
  PointsAgainst: 3,
  PointsDiff: 10,
  Streak: "L 1",
  LastXGames: "1-1-0",
});

const avalanche: VaTeamRow = team({
  TeamID: "814",
  TeamName: "NH Avalanche 16 - Elite 2",
  Team: "Avalanche 16 - Elite 2",
  DivisionName: "2016 White",
  Games: 1,
  Wins: 1,
  Losses: 0,
  Ties: 0,
  Points: 2,
  PointsFor: 7,
  PointsAgainst: 0,
  PointsDiff: 7,
  Streak: "W 1",
  LastXGames: "1-0-0",
});

const bruins: VaTeamRow = team({
  TeamID: "924",
  TeamName: "Boston Jr. Bruins 16 - Elite",
  Team: "Jr. Bruins 16 - Elite",
  DivisionName: "2016 White",
  Games: 1,
  Wins: 1,
  Losses: 0,
  Ties: 0,
  Points: 2,
  PointsFor: 4,
  PointsAgainst: 1,
  PointsDiff: 3,
  Streak: "W 1",
  LastXGames: "1-0-0",
});

const standings: VaStandingsResponse = {
  result: "success",
  Teams: {
    "2016 White": { "1": [winter, avalanche, bruins, rangers] },
    U18: { "1": [team({ TeamID: "790", TeamName: "Boston Jr. Rangers U18 - Elite", DivisionName: "U18" })] },
  },
};

function sched(id: string, games: VaGameRow[]): VaScheduleResponse {
  return { result: "success", Games: { "2016 White": { [id]: games } } };
}

const rangersGames: VaGameRow[] = [
  game({
    GameDate: "2026-09-13",
    StartTime: "2:30 PM",
    LocationName: "Ice Den",
    MainLocationName: "Hooksett",
    OpponentName3: '<span class="wordat">at </span>Avalanche 16 - E 2',
    OpponentTeamID: "814",
    CurrTeamID: "797",
    WinLoss: "L",
    GameScore: "0-7",
    GameStatus: "Completed",
  }),
  game({
    GameDate: "2026-09-27",
    StartTime: "11:10 AM",
    LocationName: "Pilgrim C",
    MainLocationName: "Hingham",
    OpponentName3: '<span class="wordat">at </span>Winter Club 16 - E',
    OpponentTeamID: "902",
    CurrTeamID: "797",
    WinLoss: "",
    GameScore: "",
    GameStatus: "Upcoming",
  }),
  game({
    GameDate: "2026-10-04",
    StartTime: "10:00 AM",
    LocationName: "Ice Den",
    MainLocationName: "Hooksett",
    OpponentName3: '<span class="wordat">at </span>Avalanche 16 - E 2',
    OpponentTeamID: "814",
    CurrTeamID: "797",
    WinLoss: "",
    GameScore: "",
    GameStatus: "Upcoming",
  }),
  game({
    GameDate: "2026-10-18",
    StartTime: "6:20 PM",
    LocationName: "Tewksbury 2",
    MainLocationName: "Tewksbury",
    OpponentName3: '<span class="wordvs">vs </span>Jr. Bruins 16 - E',
    OpponentTeamID: "924",
    CurrTeamID: "797",
    WinLoss: "",
    GameScore: "",
    GameStatus: "Upcoming",
  }),
  game({
    GameDate: "2026-10-25",
    StartTime: "10:20 AM",
    LocationName: "East Boston",
    MainLocationName: "East Boston",
    OpponentName3: '<span class="wordat">at </span>Icemen 16 - E',
    OpponentTeamID: "975",
    CurrTeamID: "797",
    WinLoss: "",
    GameScore: "",
    GameStatus: "Upcoming",
  }),
  game({
    GameDate: "2026-10-31",
    StartTime: "4:10 PM",
    LocationName: "Tewksbury 2",
    MainLocationName: "Tewksbury",
    OpponentName3: '<span class="wordvs">vs </span>Railers 16 - S 1',
    OpponentTeamID: "852",
    CurrTeamID: "797",
    WinLoss: "",
    GameScore: "",
    GameStatus: "Upcoming",
  }),
];

const winterGames: VaGameRow[] = [
  game({
    GameDate: "2026-09-12",
    StartTime: "5:00 PM",
    LocationName: "Pilgrim C",
    MainLocationName: "Hingham",
    OpponentName3: '<span class="wordvs">vs </span>Railers 16 - S 1',
    OpponentTeamID: "852",
    WinLoss: "W",
    GameScore: "0-11",
    GameStatus: "Completed",
  }),
  game({
    GameDate: "2026-09-13",
    StartTime: "1:00 PM",
    LocationName: "East Boston",
    MainLocationName: "East Boston",
    OpponentName3: '<span class="wordat">at </span>Icemen 16 - E',
    OpponentTeamID: "975",
    WinLoss: "L",
    GameScore: "2-3",
    GameStatus: "Completed",
  }),
  game({
    GameDate: "2026-09-19",
    StartTime: "5:30 PM",
    LocationName: "Ice Den",
    MainLocationName: "Hooksett",
    OpponentName3: '<span class="wordat">at </span>Avalanche 16 - E 2',
    OpponentTeamID: "814",
    WinLoss: "",
    GameScore: "",
    GameStatus: "Upcoming",
  }),
];

const avalancheGames: VaGameRow[] = [
  game({
    GameDate: "2026-09-13",
    StartTime: "2:30 PM",
    LocationName: "Ice Den",
    MainLocationName: "Hooksett",
    OpponentName3: '<span class="wordvs">vs </span>Jr. Rangers 16 - E',
    OpponentTeamID: "797",
    WinLoss: "W",
    GameScore: "0-7",
    GameStatus: "Completed",
  }),
];

const bruinsGames: VaGameRow[] = [
  game({
    GameDate: "2026-09-12",
    StartTime: "7:00 PM",
    LocationName: "Brighton",
    MainLocationName: "Brighton",
    OpponentName3: '<span class="wordvs">vs </span>Icemen 16 - E',
    OpponentTeamID: "975",
    WinLoss: "W",
    GameScore: "1-4",
    GameStatus: "Completed",
  }),
];

describe("rangers parsers", () => {
  it("picks the 2016 Jr. Rangers, not U18", () => {
    expect(isRangers2016(rangers)).toBe(true);
    expect(isRangers2016({ TeamName: "Boston Jr. Rangers U18 - Elite", DivisionName: "U18" })).toBe(false);
  });

  it("reads home/away from the Elite 9 at/vs markup", () => {
    expect(isHomeGame('<span class="wordat">at </span>Avalanche')).toBe(false);
    expect(isHomeGame('<span class="wordvs">vs </span>Jr. Bruins')).toBe(true);
    expect(opponentDisplayName('<span class="wordat">at </span>Avalanche 16 - E 2')).toBe("Avalanche 16 - E 2");
  });

  it("treats GameScore as visitor-home", () => {
    expect(scoresForCurrent(true, "0-11")).toEqual({ ourScore: 11, theirScore: 0 });
    expect(scoresForCurrent(false, "2-3")).toEqual({ ourScore: 2, theirScore: 3 });
    expect(scoresForCurrent(false, "0-7")).toEqual({ ourScore: 0, theirScore: 7 });
    expect(scoresForCurrent(true, "1-4")).toEqual({ ourScore: 4, theirScore: 1 });
  });

  it("parses a completed road loss", () => {
    const played = playedFromRow(rangersGames[0]!);
    expect(played).toMatchObject({ result: "L", ourScore: 0, theirScore: 7, isHome: false, opponentId: "814", opponentName: "Avalanche 16 - E 2" });
  });

  it("reads GameDateF when GameDate is missing", () => {
    expect(gameDateKey({ GameDate: "2026-09-27" })).toBe("2026-09-27");
    expect(gameDateKey({ GameDateF: "Sun 9/27" })).toBe("2026-09-27");
    expect(gameDateKey({ GameDateF: "Sat 1/02" })).toBe("2027-01-02");
  });

  it("flattens schedule rows even when Games is a bare list", () => {
    expect(flattenSchedule({ "2016 White": { "797": rangersGames } })).toHaveLength(6);
    expect(flattenSchedule(rangersGames)).toHaveLength(6);
  });

  it("picks one team's rows out of a league-wide schedule", () => {
    const rows = flattenSchedule({
      "2016 White": { "797": rangersGames, "902": winterGames },
    });
    expect(gamesForTeam(rows, "797")).toHaveLength(6);
    expect(gamesForTeam(rows, "902")).toHaveLength(3);
  });

  it("keeps ALB cookie pairs from Set-Cookie", () => {
    expect(cookieHeaderFromSetCookie(["AWSALB=abc; Path=/; HttpOnly", "AWSALBCORS=abc; Path=/; SameSite=None"])).toBe("AWSALB=abc; AWSALBCORS=abc");
  });
});

describe("rangers scouting feed", () => {
  const now = new Date("2026-09-14T16:00:00Z");
  const feed = buildRangersFeed({
    standings,
    ourSchedule: sched("797", rangersGames),
    opponentSchedules: {
      "902": sched("902", winterGames),
      "814": sched("814", avalancheGames),
      "924": sched("924", bruinsGames),
    },
    fetchedAt: now.toISOString(),
    now,
  });

  it("sets our record and next five opponents", () => {
    expect(feed.team.name).toContain("Jr. Rangers");
    expect(formatRecord(feed.team.record)).toBe("0-1-0");
    expect(feed.upcoming.map((c) => c.opponent.teamId)).toEqual(["902", "814", "924", "975", "852"]);
    expect(feed.upcoming.map((c) => c.game.isHome)).toEqual([false, false, true, false, true]);
  });

  it("lists who each opponent has beaten and lost to", () => {
    const [club, avs, b] = feed.upcoming;
    expect(club!.beaten).toEqual([expect.objectContaining({ opponentName: "Railers 16 - S 1", ourScore: 11, theirScore: 0 })]);
    expect(club!.lostTo).toEqual([expect.objectContaining({ opponentName: "Icemen 16 - E", ourScore: 2, theirScore: 3 })]);
    expect(avs!.beaten[0]).toMatchObject({ opponentName: "Jr. Rangers 16 - E", ourScore: 7, theirScore: 0 });
    expect(avs!.lostTo).toEqual([]);
    expect(b!.beaten[0]).toMatchObject({ opponentName: "Icemen 16 - E", ourScore: 4, theirScore: 1 });
  });

  it("flags Winter Club as gettable, Avalanche as a tall order, Bruins as uphill", () => {
    expect(feed.upcoming[0]!.belief.level).toBe("steal");
    expect(feed.upcoming[0]!.belief.blurb).toMatch(/one-goal/);
    expect(feed.upcoming[0]!.belief.blurb).not.toMatch(/Before they see us/);
    expect(feed.upcoming[0]!.belief.gradedAt).toBe(now.toISOString());
    expect(feed.upcoming[0]!.belief.sampleGp).toBe(1);
    expect(feed.upcoming[0]!.warmup[0]?.opponentName).toMatch(/Avalanche/);
    expect(feed.upcoming[1]!.belief.level).toBe("long_shot");
    expect(feed.upcoming[1]!.belief.blurb).toMatch(/Rematch/);
    expect(feed.upcoming[1]!.belief.blurb).not.toMatch(/flattened Jr\. Rangers/);
    expect(feed.upcoming[2]!.belief.level).toBe("uphill");
    expect(feed.upcoming[2]!.belief.blurb).toMatch(/Home ice/);
  });

  it("skips past games when selecting upcoming", () => {
    expect(selectUpcoming(rangersGames, now, 5).map((g) => g.date)).toEqual([
      "2026-09-27",
      "2026-10-04",
      "2026-10-18",
      "2026-10-25",
      "2026-10-31",
    ]);
  });

  it("selects upcoming games that only have GameDateF", () => {
    const rows = [
      game({ GameDateF: "Sun 9/13", WinLoss: "L", GameScore: "0-7", GameStatus: "Completed", OpponentTeamID: "814" }),
      game({ GameDateF: "Sun 9/27", StartTime: "11:10 AM", GameStatus: "Upcoming", OpponentTeamID: "902", OpponentName3: "Winter Club" }),
    ];
    expect(selectUpcoming(rows, now, 3).map((g) => g.date)).toEqual(["2026-09-27"]);
  });
});

describe("buildBelief", () => {
  it("rewards a one-goal loss on the opponent's tape", () => {
    const belief = buildBelief({
      us: { gp: 1, wins: 0, losses: 1, ties: 0, points: 0, gf: 0, ga: 7, gd: -7, streak: "L 1", lastFive: "0-1-0" },
      them: { gp: 2, wins: 1, losses: 1, ties: 0, points: 2, gf: 13, ga: 3, gd: 10, streak: "L 1", lastFive: "1-1-0" },
      beaten: [{ date: "2026-09-12", opponentId: "x", opponentName: "Railers", result: "W", ourScore: 11, theirScore: 0, isHome: true, location: "", rink: "" }],
      lostTo: [{ date: "2026-09-13", opponentId: "y", opponentName: "Icemen", result: "L", ourScore: 2, theirScore: 3, isHome: false, location: "", rink: "" }],
      game: { isHome: false, rink: "Hingham" },
      opponentName: "Winter Club",
      now: new Date("2026-09-14T16:00:00Z"),
    });
    expect(belief.level).toBe("steal");
    expect(belief.label).toBe("Gettable");
    expect(belief.blurb).not.toMatch(/Before they see us/);
    expect(belief.sampleGp).toBe(1);
  });
});

describe("refreshRangers", () => {
  it("loads the public league-wide schedule and slices our next five", async () => {
    const calls: Array<{ path: string; teamId?: string }> = [];
    const feed = await refreshRangers({
      now: new Date("2026-09-14T16:00:00Z"),
      post: async <T>(path: string, body: unknown) => {
        const teamId = (body as { TeamID?: string }).TeamID;
        calls.push({ path, teamId });
        if (path === "/index/getwidgetformat") return { result: "success", token: "t" } as T;
        if (path === "/standings/get") return standings as T;
        if (path === "/schedules/get") {
          return {
            result: "success",
            Games: {
              "2016 White": {
                "797": rangersGames,
                "902": winterGames,
                "814": avalancheGames,
                "924": bruinsGames,
                "975": [
                  game({
                    GameDate: "2026-09-13",
                    OpponentName3: '<span class="wordvs">vs </span>Winter Club 16 - E',
                    OpponentTeamID: "902",
                    CurrTeamID: "975",
                    WinLoss: "W",
                    GameScore: "2-3",
                    GameStatus: "Completed",
                  }),
                ],
                "852": [
                  game({
                    GameDate: "2026-09-12",
                    OpponentName3: '<span class="wordat">at </span>Winter Club 16 - E',
                    OpponentTeamID: "902",
                    CurrTeamID: "852",
                    WinLoss: "L",
                    GameScore: "0-11",
                    GameStatus: "Completed",
                  }),
                ],
              },
            },
          } as T;
        }
        throw new Error(`unexpected ${path} ${teamId}`);
      },
    });
    expect(calls[0]).toEqual({ path: "/standings/get", teamId: "" });
    expect(calls.map((c) => c.path)).toContain("/index/getwidgetformat");
    expect(calls.filter((c) => c.path === "/schedules/get")).toHaveLength(1);
    expect(feed.upcoming).toHaveLength(5);
    expect(feed.upcoming.map((c) => c.opponent.teamId)).toEqual(["902", "814", "924", "975", "852"]);
    expect(feed.errors).toEqual([]);
  });
});

describe("reuseHiddenUpcoming", () => {
  it("keeps still-future scout cards when this scrape found none", () => {
    const now = new Date("2026-09-14T16:00:00Z");
    const previous = {
      upcoming: [
        { game: { date: "2026-09-13" } },
        { game: { date: "2026-09-27" } },
        { game: { date: "2026-10-04" } },
      ],
    } as unknown as import("@openice/shared").RangersFeed;
    const current = { upcoming: [] } as unknown as import("@openice/shared").RangersFeed;
    expect(reuseHiddenUpcoming(current, previous, now).upcoming.map((c) => c.game.date)).toEqual(["2026-09-27", "2026-10-04"]);
    expect(reuseHiddenUpcoming({ ...current, upcoming: previous.upcoming }, previous, now).upcoming).toBe(previous.upcoming);
  });
});
