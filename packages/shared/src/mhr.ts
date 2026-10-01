import type { RangersFeed, RangersStandingRow } from "./types.js";
import type { YouthHockeyFeed, YouthTeam } from "./youth-hockey.js";

export const MHR_SEASON = 2026;
export interface MhrEntry {
  id: number;
  name: string;
  birthYear: number;
  rating?: number;
  /** Only a rank explicitly published by MHR; never inferred from row order. */
  rank?: number;
  url: string;
}
export interface MhrSource {
  birthYear: number;
  url: string;
  checkedAt: string;
  fetchedAt?: string;
  error?: string;
}
export interface MhrSnapshot {
  version: 1;
  season: number;
  sources: MhrSource[];
  teams: MhrEntry[];
}

// Normalize known league naming differences, preserving squad (Elite/Select/1/2).
export function mhrTeamKey(name: string): string {
  return name.toLowerCase().replace(/\./g, "")
    .replace(/\bjunior\b/g, "jr").replace(/\bnh\b/g, "new hampshire").replace(/\bvt\b/g, "vermont")
    .replace(/\bec wizards\b/g, "east coast wizards").replace(/\bassabet patriots\b/g, "assabet valley patriots")
    .replace(/\b(?:worcester )?jr railers\b/g, "railers").replace(/\b(?:boston )?jr falcons\b/g, "falcons")
    .replace(/\bgreater boston\b/g, "boston").replace(/\b(?:springfield )?jr thunderbirds\b/g, "thunderbirds")
    .replace(/\b(?:cape cod ta )?seahawks\b/g, "seahawks").replace(/\bcasco bay mariners\b/g, "casco bay")
    .replace(/\bri saints\b/g, "rhode island saints")
    .replace(/\blovell winter club\b/g, "winter club").replace(/\bgiants\s*-\s*west\b/g, "95 giants")
    .replace(/\btopgun\b/g, "top gun").replace(/\bihc\b/g, "middlesex islanders east")
    .replace(/\bmid[ -]fairfield(?: hockey club)?\b/g, "mid fairfield")
    .replace(/\b(?:2015|2016|15|16|10u|11u|aaa|squirt major|pee wee minor)\b/g, " ")
    .replace(/\be\s*(?=\d|$)/g, "elite ").replace(/\bs\s*(?=\d|$)/g, "select ")
    .replace(/[^a-z0-9]+/g, " ").trim().replace(/\s+/g, " ");
}

export function matchMhrTeam(snapshot: MhrSnapshot, name: string, birthYear: number, fedElite = false): MhrEntry | undefined {
  if (snapshot.season !== MHR_SEASON) return undefined;
  let key = mhrTeamKey(name);
  // FED's verified Elite division uses coach surnames instead of squad labels.
  if (fedElite) {
    key = key.replace(/ (?:sabo|spina|kelly|bellefeuille|vanacore|morrell)$/, "").trim();
    if (!/\belite\b/.test(key)) key += " elite";
  }
  const candidates = snapshot.teams.filter((team) => team.birthYear === birthYear);
  const exact = candidates.filter((team) => mhrTeamKey(team.name) === key);
  if (exact.length === 1) return exact[0];
  // Some clubs have only one AAA squad and omit "Elite" on MHR. Never strip
  // Select, squad numbers, or use substring/fuzzy matching to choose a roster.
  if (/ elite$/.test(key)) {
    const single = candidates.filter((team) => mhrTeamKey(team.name) === key.replace(/ elite$/, ""));
    if (single.length === 1) return single[0];
  }
  return undefined;
}

export function enrichRangersMhr(feed: RangersFeed, snapshot: MhrSnapshot): RangersFeed {
  const row = (r: RangersStandingRow): RangersStandingRow => ({ ...r, mhr: matchMhrTeam(snapshot, r.name, 2016) });
  return { ...feed, mhrSources: snapshot.sources.filter((s) => s.birthYear === 2016), team: row(feed.team), standings: feed.standings.map(row), upcoming: feed.upcoming.map((card) => ({ ...card, opponent: row(card.opponent) })) };
}

export function enrichYouthMhr(feed: YouthHockeyFeed, snapshot: MhrSnapshot): YouthHockeyFeed {
  return { ...feed, mhrSources: snapshot.sources, games: feed.games.map((game) => {
    const team = (t: YouthTeam): YouthTeam => ({ ...t, mhr: matchMhrTeam(snapshot, t.name, game.birthYear, game.league === "FED Elite" && t.eligible) });
    return { ...game, home: team(game.home), away: team(game.away) };
  }) };
}
