import {
  localToIso,
  parseClock,
  parseDateOnly,
  type RangersBelief,
  type RangersBeliefLevel,
  type RangersFeed,
  type RangersPlayedGame,
  type RangersRecord,
  type RangersResult,
  type RangersScoutCard,
  type RangersStandingRow,
  type RangersUpcomingGame,
} from "@openice/shared";
import type { BtGame } from "./backtest/games.js";
import { identities, type TeamIdentity } from "./backtest/priors.js";
import { fitBeliefModel, type MatchupPrediction } from "./belief-model.js";
import { stripTags } from "./html.js";
import { fetchJson, httpFetch } from "./http.js";
import { attachMhrToFeed, fetchMhrRanks } from "./mhr.js";

export const RANGERS_STANDINGS_URL = "https://www.elite9hockey.com/pages/standings/boys-2026-27/";
export const RANGERS_SCHEDULE_URL = "https://www.elite9hockey.com/pages/schedules/boys-2026-27-schedule/";
export const RANGERS_WIDGETS = "https://widgets.vahockey.com";
export const RANGERS_SEASON = "2027";
export const RANGERS_LEAGUE = "e9bhl";
export const RANGERS_CUSTOMER_ID = "1";
export const RANGERS_UPCOMING_COUNT = 5;

const RANGERS_NAME = /jr\.?\s*rangers/i;
const BIRTH_YEAR_IN_NAME = /\b16\b/;
const DIVISION_2016 = /2016/;

const STANDINGS_COLUMNS = ["Team3", "Games", "Wins", "Losses", "Ties", "Points", "PointsFor", "PointsAgainst", "PointsDiff", "LastXGames", "Streak", "RPI"];
const SCHEDULE_COLUMNS = ["GameDateF", "StartTime", "LocationName", "OpponentName3", "WinLoss", "GameScore", "GameStatus"];

export interface VaTeamRow {
  TeamID?: string;
  TeamName?: string;
  Team?: string;
  Team3?: string;
  DivisionName?: string;
  Logo?: string;
  Wins?: number | string;
  Losses?: number | string;
  Ties?: number | string;
  Games?: number | string;
  Points?: number | string;
  PointsFor?: number | string;
  PointsAgainst?: number | string;
  PointsDiff?: number | string;
  Streak?: string;
  LastXGames?: string;
}

export interface VaGameRow {
  GameDate?: string;
  GameDateF?: string;
  StartTime?: string;
  LocationName?: string;
  MainLocationName?: string;
  OpponentName3?: string;
  OpponentTeamID?: string;
  CurrTeamID?: string;
  CurrTeamShortName?: string;
  DivisionName?: string;
  WinLoss?: string;
  GameScore?: string;
  GameStatus?: string;
}

export interface VaStandingsResponse {
  result?: string;
  Teams?: Record<string, Record<string, VaTeamRow[]>>;
  message?: string;
}

export interface VaScheduleResponse {
  result?: string;
  Games?: Record<string, Record<string, VaGameRow[]>>;
  message?: string;
}

export type RangersPost = <T>(path: string, body: unknown) => Promise<T>;

export interface RefreshRangersOptions {
  now?: Date;
  upcomingCount?: number;
  log?: (message: string) => void;
  post?: RangersPost;
  fetchMhrHtml?: (url: string) => Promise<string>;
  /** Last published feed; its still-future games are kept when this IP only sees part of the Elite 9 board. */
  previous?: RangersFeed;
}

function num(value: number | string | undefined): number {
  const n = typeof value === "number" ? value : Number(value);
  return Number.isFinite(n) ? n : 0;
}

export function emptyRecord(): RangersRecord {
  return { gp: 0, wins: 0, losses: 0, ties: 0, points: 0, gf: 0, ga: 0, gd: 0, streak: "", lastFive: "" };
}

export function formatRecord(record: RangersRecord): string {
  return `${record.wins}-${record.losses}-${record.ties}`;
}

export function isRangers2016(row: VaTeamRow): boolean {
  const name = row.TeamName ?? row.Team ?? "";
  const division = row.DivisionName ?? "";
  return RANGERS_NAME.test(name) && (DIVISION_2016.test(division) || BIRTH_YEAR_IN_NAME.test(name));
}

export function flattenStandings(teams: VaStandingsResponse["Teams"]): VaTeamRow[] {
  if (!teams) return [];
  const out: VaTeamRow[] = [];
  for (const group of Object.values(teams)) {
    for (const rows of Object.values(group)) {
      if (Array.isArray(rows)) out.push(...rows);
    }
  }
  return out;
}

function looksLikeGame(value: unknown): value is VaGameRow {
  if (!value || typeof value !== "object") return false;
  const row = value as VaGameRow;
  return Boolean(row.GameDate || row.GameDateF || row.OpponentName3 || row.OpponentTeamID);
}

export function flattenSchedule(games: VaScheduleResponse["Games"] | unknown): VaGameRow[] {
  const out: VaGameRow[] = [];
  const walk = (node: unknown, teamId?: string) => {
    if (!node) return;
    if (Array.isArray(node)) {
      for (const item of node) walk(item, teamId);
      return;
    }
    if (typeof node === "object") {
      if (looksLikeGame(node)) {
        out.push(teamId && !node.CurrTeamID ? { ...node, CurrTeamID: teamId } : node);
        return;
      }
      for (const [key, value] of Object.entries(node as Record<string, unknown>)) {
        walk(value, /^\d+$/.test(key) ? key : teamId);
      }
    }
  };
  walk(games);
  return out;
}

export function gamesForTeam(games: VaGameRow[], teamId: string): VaGameRow[] {
  const id = String(teamId);
  const tagged = games.filter((g) => String(g.CurrTeamID ?? ""));
  if (tagged.length === 0) return games;
  return games.filter((g) => String(g.CurrTeamID ?? "") === id);
}

function asTeamSchedule(teamId: string, rows: VaGameRow[]): VaScheduleResponse {
  return { result: "success", Games: { team: { [teamId]: rows } } };
}

export function recordFromStanding(row: VaTeamRow): RangersRecord {
  const wins = num(row.Wins);
  const losses = num(row.Losses);
  const ties = num(row.Ties);
  const gf = num(row.PointsFor);
  const ga = num(row.PointsAgainst);
  return {
    gp: num(row.Games) || wins + losses + ties,
    wins,
    losses,
    ties,
    points: num(row.Points),
    gf,
    ga,
    gd: num(row.PointsDiff) || gf - ga,
    streak: (row.Streak ?? "").trim(),
    lastFive: (row.LastXGames ?? "").trim(),
  };
}

export function standingFromRow(row: VaTeamRow, rank: number, isUs: boolean): RangersStandingRow {
  return {
    teamId: String(row.TeamID ?? ""),
    name: (row.TeamName ?? row.Team ?? "Unknown").trim(),
    shortName: (row.Team ?? row.Team3 ?? row.TeamName ?? "Unknown").trim(),
    division: (row.DivisionName ?? "").trim(),
    logo: row.Logo || undefined,
    rank,
    record: recordFromStanding(row),
    isUs,
  };
}

/** True when the current team is home. Elite 9 marks this with `wordvs` / `wordat` spans. */
export function isHomeGame(opponentHtml: string): boolean {
  if (/wordvs/i.test(opponentHtml)) return true;
  if (/wordat/i.test(opponentHtml)) return false;
  const text = stripTags(opponentHtml);
  if (/^\s*at\b/i.test(text)) return false;
  if (/^\s*vs\.?\b/i.test(text)) return true;
  return true;
}

export function opponentDisplayName(opponentHtml: string): string {
  return stripTags(opponentHtml)
    .replace(/^\s*(at|vs\.?)\s+/i, "")
    .replace(/\s+/g, " ")
    .trim();
}

/** Elite 9 GameScore is visitor-home, not always current-team-first. */
export function parseVisitorHomeScore(score: string): { visitor: number; home: number } | null {
  const m = score.trim().match(/^(\d+)\s*[-–]\s*(\d+)$/);
  if (!m) return null;
  return { visitor: Number(m[1]), home: Number(m[2]) };
}

export function scoresForCurrent(isHome: boolean, score: string): { ourScore: number; theirScore: number } | null {
  const parsed = parseVisitorHomeScore(score);
  if (!parsed) return null;
  return isHome ? { ourScore: parsed.home, theirScore: parsed.visitor } : { ourScore: parsed.visitor, theirScore: parsed.home };
}

export function parseResult(winLoss: string): RangersResult | undefined {
  const w = winLoss.trim().toUpperCase();
  if (w === "W") return "W";
  if (w === "L") return "L";
  if (w === "T" || w === "OTT") return "T";
  return undefined;
}

export function isCompletedGame(game: VaGameRow): boolean {
  const status = (game.GameStatus ?? "").toLowerCase();
  if (status.includes("complete") || status.includes("final")) return true;
  return Boolean(parseResult(game.GameStatus ?? "") || parseResult(game.WinLoss ?? ""));
}

export function gameDateKey(game: VaGameRow, seasonEndYear = Number(RANGERS_SEASON)): string {
  const iso = (game.GameDate ?? "").trim();
  if (/^\d{4}-\d{2}-\d{2}/.test(iso)) return iso.slice(0, 10);
  const pretty = (game.GameDateF ?? "").trim();
  const m = pretty.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return "";
  const month = Number(m[1]);
  const day = Number(m[2]);
  if (month < 1 || month > 12 || day < 1 || day > 31) return "";
  const year = month >= 8 ? seasonEndYear - 1 : seasonEndYear;
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

function clock24(start: string): string {
  const c = parseClock(start.trim());
  return c ? `${String(c.hour).padStart(2, "0")}:${String(c.minute).padStart(2, "0")}` : "";
}

/**
 * Completed games from Elite 9 team-rows, deduped (each game appears once per team).
 * Home/away comes from the current team's `wordvs`/`wordat` marker and scores are visitor–home.
 */
export function gamesFromRows(rows: VaGameRow[], seasonEndYear = Number(RANGERS_SEASON)): { games: BtGame[]; skipped: number } {
  const teamDiv = new Map<string, string>();
  for (const r of rows) if (r.CurrTeamID && r.DivisionName) teamDiv.set(String(r.CurrTeamID), r.DivisionName);
  const byId = new Map<string, BtGame>();
  let skipped = 0;
  for (const r of rows) {
    const cur = String(r.CurrTeamID ?? "");
    const opp = String(r.OpponentTeamID ?? "");
    const score = parseVisitorHomeScore(r.GameScore ?? "");
    const date = gameDateKey(r, seasonEndYear);
    if (!cur || !opp || !score || !date || !isCompletedGame(r)) {
      skipped++;
      continue;
    }
    const curHome = isHomeGame(r.OpponentName3 ?? "");
    const homeId = curHome ? cur : opp;
    const awayId = curHome ? opp : cur;
    const time = clock24(r.StartTime ?? "");
    const id = `${date}|${time}|${homeId}|${awayId}`;
    if (byId.has(id)) continue;
    const curName = (r.CurrTeamShortName ?? "").trim();
    const oppName = opponentDisplayName(r.OpponentName3 ?? "");
    byId.set(id, {
      id,
      date,
      time,
      homeId,
      awayId,
      homeName: curHome ? curName : oppName,
      awayName: curHome ? oppName : curName,
      homeGoals: score.home,
      awayGoals: score.visitor,
      homeDiv: teamDiv.get(homeId) ?? "",
      awayDiv: teamDiv.get(awayId) ?? "",
    });
  }
  const games = [...byId.values()].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
  return { games, skipped };
}

/** Every team seen in the rows, played or not, with its division, for matching last season's ratings. */
export function teamIdentitiesFromRows(rows: VaGameRow[]): Map<string, TeamIdentity> {
  const teamDiv = new Map<string, string>();
  for (const r of rows) if (r.CurrTeamID && r.DivisionName) teamDiv.set(String(r.CurrTeamID), r.DivisionName);
  const stubs: BtGame[] = [];
  for (const r of rows) {
    const cur = String(r.CurrTeamID ?? "");
    const opp = String(r.OpponentTeamID ?? "");
    if (!cur || !opp) continue;
    stubs.push({
      id: "",
      date: "",
      time: "",
      homeId: cur,
      awayId: opp,
      homeName: (r.CurrTeamShortName ?? "").trim(),
      awayName: opponentDisplayName(r.OpponentName3 ?? ""),
      homeGoals: 0,
      awayGoals: 0,
      homeDiv: teamDiv.get(cur) ?? "",
      awayDiv: teamDiv.get(opp) ?? "",
    });
  }
  return identities(stubs);
}

export function gameStartIso(game: VaGameRow): string | undefined {
  const date = parseDateOnly(gameDateKey(game));
  if (!date) return undefined;
  const clock = parseClock((game.StartTime ?? "").trim()) ?? { hour: 12, minute: 0 };
  return localToIso({ ...date, ...clock });
}

function locationOf(game: VaGameRow): string {
  return (game.LocationName ?? "").trim();
}

function rinkOf(game: VaGameRow): string {
  return (game.MainLocationName ?? game.LocationName ?? "").trim();
}

export function playedFromRow(game: VaGameRow, fallbackId = ""): RangersPlayedGame | undefined {
  const result = parseResult(game.WinLoss ?? "");
  if (!result) return undefined;
  const isHome = isHomeGame(game.OpponentName3 ?? "");
  const scores = scoresForCurrent(isHome, game.GameScore ?? "") ?? { ourScore: 0, theirScore: 0 };
  const date = gameDateKey(game);
  if (!date) return undefined;
  return {
    date,
    start: gameStartIso(game),
    opponentId: String(game.OpponentTeamID ?? fallbackId),
    opponentName: opponentDisplayName(game.OpponentName3 ?? ""),
    result,
    ourScore: scores.ourScore,
    theirScore: scores.theirScore,
    isHome,
    location: locationOf(game),
    rink: rinkOf(game),
  };
}

export function upcomingFromRow(game: VaGameRow): RangersUpcomingGame | undefined {
  if (isCompletedGame(game)) return undefined;
  const date = gameDateKey(game);
  if (!date) return undefined;
  return {
    date,
    start: gameStartIso(game),
    opponentId: String(game.OpponentTeamID ?? ""),
    opponentName: opponentDisplayName(game.OpponentName3 ?? ""),
    isHome: isHomeGame(game.OpponentName3 ?? ""),
    location: locationOf(game),
    rink: rinkOf(game),
  };
}

function todayKey(now: Date): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: "America/New_York", year: "numeric", month: "2-digit", day: "2-digit" }).formatToParts(now);
  const get = (type: string) => parts.find((p) => p.type === type)?.value ?? "00";
  return `${get("year")}-${get("month")}-${get("day")}`;
}

function upcomingKey(game: Pick<RangersUpcomingGame, "date" | "opponentId" | "opponentName">): string {
  return `${game.date}|${game.opponentId || (game.opponentName ?? "").toLowerCase()}`;
}

/**
 * AWS IPs only see part of the Elite 9 board (completed games plus, on game day, that day's game), while the GitHub
 * runner sees the whole season. Union this scrape's upcoming games with still-future ones from the last good scrape so
 * a partial view never wipes the board. Freshly scraped rows win; games that now have a result are dropped.
 */
export function mergeUpcoming(
  scraped: RangersUpcomingGame[],
  remembered: RangersUpcomingGame[],
  played: RangersPlayedGame[],
  now: Date,
  count: number,
): RangersUpcomingGame[] {
  if (remembered.length === 0) return scraped;
  const today = todayKey(now);
  const seen = new Set([...scraped, ...played].map(upcomingKey));
  const merged = [...scraped];
  for (const game of remembered) {
    if (game.date < today) continue;
    const key = upcomingKey(game);
    if (seen.has(key)) continue;
    seen.add(key);
    merged.push(game);
  }
  return merged.sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? "")).slice(0, count);
}

/** Feed-level fallback for callers that could not pass `previous` into `refreshRangers`: keeps last scrape's still-future scout cards. */
export function reuseHiddenUpcoming(feed: RangersFeed, previous: RangersFeed | undefined, now: Date, count = RANGERS_UPCOMING_COUNT): RangersFeed {
  const remembered = previous?.upcoming ?? [];
  if (remembered.length === 0) return feed;
  const games = mergeUpcoming(
    feed.upcoming.map((card) => card.game),
    remembered.map((card) => card.game),
    feed.recent ?? [],
    now,
    Math.max(count, feed.upcoming.length),
  );
  if (games.length === feed.upcoming.length) return feed;
  const cards = new Map([...remembered, ...feed.upcoming].map((card) => [upcomingKey(card.game), card]));
  return { ...feed, upcoming: games.map((game) => cards.get(upcomingKey(game))!).filter(Boolean) };
}

export function selectUpcoming(games: VaGameRow[], now: Date, count: number): RangersUpcomingGame[] {
  const today = todayKey(now);
  return games
    .map(upcomingFromRow)
    .filter((g): g is RangersUpcomingGame => Boolean(g && g.date >= today))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""))
    .slice(0, count);
}

function placeholderStanding(id: string, name: string, division: string): RangersStandingRow {
  return {
    teamId: id,
    name,
    shortName: name,
    division,
    rank: 0,
    record: emptyRecord(),
    isUs: false,
  };
}

function oneGoalLoss(game: RangersPlayedGame): boolean {
  return game.result === "L" && Math.abs(game.ourScore - game.theirScore) === 1;
}

function scoreLabel(game: RangersPlayedGame): string {
  return `${game.ourScore}-${game.theirScore}`;
}

function listNames(games: RangersPlayedGame[]): string {
  return games.map((g) => `${g.opponentName} ${scoreLabel(g)}`).join(", ");
}

const BELIEF_LABEL: Record<RangersBeliefLevel, string> = {
  steal: "Gettable",
  toss_up: "Even-ish",
  uphill: "Uphill",
  long_shot: "Tall order",
};

/** Probability bands for the lamp, on our expected points share from `belief-model.ts`. */
export function beliefLevel(pUs: number): RangersBeliefLevel {
  if (pUs >= 0.55) return "steal";
  if (pUs >= 0.4) return "toss_up";
  if (pUs >= 0.2) return "uphill";
  return "long_shot";
}

function signed(x: number): string {
  const r = Math.round(x * 10) / 10;
  return `${r > 0 ? "+" : r < 0 ? "−" : "±"}${Math.abs(r).toFixed(1)}`;
}

export interface BeliefOdds {
  /** Our expected points share (ties half). */
  pUs: number;
  /** Our win / tie / loss chances. */
  outcome?: { win: number; tie: number; loss: number };
  /** Last season's ratings, centered in the division, when known. */
  usPrior?: number;
  themPrior?: number;
  /** Our expected goal margin, including home ice. */
  expectedMargin: number;
  usRating: number;
  themRating: number;
  usGames: number;
  themGames: number;
}

export function oddsForUs(prediction: MatchupPrediction, isHome: boolean): BeliefOdds {
  return isHome
    ? {
        pUs: prediction.pHome,
        outcome: prediction.outcome,
        usPrior: prediction.homePrior,
        themPrior: prediction.awayPrior,
        expectedMargin: prediction.expectedHomeMargin,
        usRating: prediction.homeRating,
        themRating: prediction.awayRating,
        usGames: prediction.homeGames,
        themGames: prediction.awayGames,
      }
    : {
        pUs: 1 - prediction.pHome,
        outcome: { win: prediction.outcome.loss, tie: prediction.outcome.tie, loss: prediction.outcome.win },
        usPrior: prediction.awayPrior,
        themPrior: prediction.homePrior,
        expectedMargin: -prediction.expectedHomeMargin,
        usRating: prediction.awayRating,
        themRating: prediction.homeRating,
        usGames: prediction.awayGames,
        themGames: prediction.homeGames,
      };
}

export function buildBelief(input: {
  us: RangersRecord;
  them: RangersRecord;
  beaten: RangersPlayedGame[];
  lostTo: RangersPlayedGame[];
  prior?: RangersPlayedGame;
  game: Pick<RangersUpcomingGame, "isHome" | "rink">;
  opponentName: string;
  now: Date;
  odds: BeliefOdds;
}): RangersBelief {
  const { odds } = input;
  const pct = Math.round(odds.pUs * 100);
  const gap = odds.usRating - odds.themRating;
  const why: string[] = [
    `Model: ${pct}% expected points for us, projected margin ${signed(odds.expectedMargin)} goals.`,
    `Schedule-adjusted goal margin per game: us ${signed(odds.usRating)}, ${input.opponentName} ${signed(odds.themRating)}.`,
  ];
  if (odds.outcome) {
    why.push(`Win ${Math.round(100 * odds.outcome.win)}%, tie ${Math.round(100 * odds.outcome.tie)}%, loss ${Math.round(100 * odds.outcome.loss)}%.`);
  }
  if (Math.min(odds.usGames, odds.themGames) < 5) {
    const priorNote =
      odds.usPrior != null || odds.themPrior != null
        ? ` Last season's ratings seed the start at quarter weight (us ${odds.usPrior != null ? signed(odds.usPrior) : "unknown"}, them ${odds.themPrior != null ? signed(odds.themPrior) : "unknown"}).`
        : "";
    why.push(`Early grade: ${Math.min(odds.usGames, odds.themGames)} game(s) on the smaller sample, so ratings are pulled toward average.${priorNote}`);
  }
  if (input.prior) {
    why.push(
      input.prior.result === "L"
        ? `They beat us ${input.prior.theirScore}–${input.prior.ourScore} last time (already inside the rating).`
        : input.prior.result === "W"
          ? `We beat them ${input.prior.ourScore}–${input.prior.theirScore} last time (already inside the rating).`
          : `Last meeting ended ${input.prior.ourScore}–${input.prior.theirScore}.`,
    );
  }
  if (input.lostTo.length > 0) why.push(`Their losses: ${listNames(input.lostTo)}.`);
  why.push(input.game.isHome ? `Home ice (${input.game.rink || "Tewksbury"}), worth about ${BELIEF_HOME_EDGE}.` : `Road game at ${input.game.rink || "their rink"}.`);

  const level = beliefLevel(odds.pUs);
  const parts: string[] = [];
  if (Math.abs(gap) < 1) parts.push(`Close on paper: the two ratings are within a goal a game.`);
  else if (gap > 0) parts.push(`We rate ${Math.abs(gap).toFixed(1)} goals a game better than ${input.opponentName} once schedule is counted.`);
  else parts.push(`${input.opponentName} rates ${Math.abs(gap).toFixed(1)} goals a game better than us once schedule is counted.`);
  if (input.prior?.result === "L") {
    parts.push(`Rematch. They hung a ${input.prior.theirScore}–${input.prior.ourScore} on us last time.`);
  }
  if (input.lostTo.some(oneGoalLoss)) {
    const g = input.lostTo.find(oneGoalLoss)!;
    parts.push(`${input.opponentName} dropped a one-goal game to ${g.opponentName} (${g.theirScore}–${g.ourScore}).`);
  } else if (input.beaten.length > 0 && input.lostTo.length === 0 && !input.prior) {
    parts.push(`Undefeated so far. Wins: ${listNames(input.beaten)}.`);
  } else if (!input.prior && input.beaten.length === 0 && input.lostTo.length === 0) {
    parts.push(`${input.opponentName} has not played a completed game yet, so this grade leans on the league average.`);
  }
  if (input.game.isHome) parts.push(`Home ice, ${input.game.rink || "Tewksbury"}.`);
  else parts.push(`We're on the road at ${input.game.rink || "their barn"}.`);

  return {
    level,
    label: BELIEF_LABEL[level],
    score: pct,
    why,
    blurb: parts.join(" "),
    gradedAt: input.now.toISOString(),
    sampleGp: input.us.gp,
    ...(odds.outcome ? { outcome: { win: round3(odds.outcome.win), tie: round3(odds.outcome.tie), loss: round3(odds.outcome.loss) } } : {}),
  };
}

function round3(x: number): number {
  return Math.round(x * 1000) / 1000;
}

/** Last season's fitted home-ice edge, in words for the card. */
const BELIEF_HOME_EDGE = "a fifth of a goal";

export function buildScoutCard(input: {
  us: RangersStandingRow;
  opponent: RangersStandingRow;
  game: RangersUpcomingGame;
  opponentGames: VaGameRow[];
  ourRecent: RangersPlayedGame[];
  now: Date;
  odds: BeliefOdds;
}): RangersScoutCard {
  const played = input.opponentGames.map((g) => playedFromRow(g)).filter((g): g is RangersPlayedGame => Boolean(g));
  const beaten = played.filter((g) => g.result === "W");
  const lostTo = played.filter((g) => g.result === "L");
  const tied = played.filter((g) => g.result === "T");
  const warmup = selectUpcoming(input.opponentGames, input.now, 12).filter((g) => g.date < input.game.date).slice(0, 3);
  const prior = input.ourRecent.find((g) => g.opponentId && g.opponentId === input.opponent.teamId);
  const belief = buildBelief({
    us: input.us.record,
    them: input.opponent.record,
    beaten,
    lostTo,
    prior,
    game: input.game,
    opponentName: input.opponent.shortName || input.opponent.name,
    now: input.now,
    odds: input.odds,
  });
  return { opponent: input.opponent, game: input.game, beaten, lostTo, tied, warmup, prior, belief };
}

export function buildRangersFeed(input: {
  standings: VaStandingsResponse;
  ourSchedule: VaScheduleResponse;
  opponentSchedules: Record<string, VaScheduleResponse>;
  fetchedAt: string;
  now: Date;
  upcomingCount?: number;
  errors?: string[];
  /** Still-future games from the last published feed (see `mergeUpcoming`). */
  knownUpcoming?: RangersUpcomingGame[];
  /** League-wide completed rows for the rating model; our and opponent schedules are always included. */
  leagueRows?: VaGameRow[];
}): RangersFeed {
  const errors = [...(input.errors ?? [])];
  const rows = flattenStandings(input.standings.Teams);
  const usRow = rows.find(isRangers2016);
  if (!usRow?.TeamID) {
    return {
      fetchedAt: input.fetchedAt,
      sourceUrl: RANGERS_STANDINGS_URL,
      scheduleUrl: RANGERS_SCHEDULE_URL,
      seasonLabel: "2026–27",
      team: placeholderStanding("", "Boston Jr. Rangers 16 - Elite", "2016 White"),
      standings: [],
      recent: [],
      upcoming: [],
      errors: [...errors, "Could not find the 2016 Jr. Rangers in Elite 9 boys standings."],
    };
  }

  const division = usRow.DivisionName ?? "";
  const divisionRows = rows.filter((r) => (r.DivisionName ?? "") === division);
  const standings = divisionRows.map((row, idx) => standingFromRow(row, idx + 1, row.TeamID === usRow.TeamID));
  const us = standings.find((s) => s.isUs) ?? standingFromRow(usRow, 0, true);
  const byId = new Map(standings.map((s) => [s.teamId, s]));

  const ourGames = flattenSchedule(input.ourSchedule.Games);
  const recent = ourGames
    .map((g) => playedFromRow(g))
    .filter((g): g is RangersPlayedGame => Boolean(g))
    .sort((a, b) => a.date.localeCompare(b.date) || (a.start ?? "").localeCompare(b.start ?? ""));
  const count = input.upcomingCount ?? RANGERS_UPCOMING_COUNT;
  const upcomingGames = mergeUpcoming(selectUpcoming(ourGames, input.now, count), input.knownUpcoming ?? [], recent, input.now, count);

  const ratingRows = [
    ...(input.leagueRows ?? []),
    ...ourGames.map((g) => (g.CurrTeamID ? g : { ...g, CurrTeamID: us.teamId })),
    ...Object.entries(input.opponentSchedules).flatMap(([id, feed]) => flattenSchedule(feed.Games).map((g) => (g.CurrTeamID ? g : { ...g, CurrTeamID: id }))),
  ];
  const model = fitBeliefModel(gamesFromRows(ratingRows).games, todayKey(input.now), teamIdentitiesFromRows(ratingRows));

  const upcoming: RangersScoutCard[] = upcomingGames.map((game) => {
    const opponent = byId.get(game.opponentId) ?? placeholderStanding(game.opponentId, game.opponentName, us.division);
    const oppFeed = input.opponentSchedules[game.opponentId];
    const oppGames = flattenSchedule(oppFeed?.Games);
    if (!oppFeed) errors.push(`No schedule for ${opponent.name}.`);
    const prediction = game.isHome ? model.predict(us.teamId, game.opponentId) : model.predict(game.opponentId, us.teamId);
    const odds = oddsForUs(prediction, game.isHome);
    return buildScoutCard({ us, opponent, game, opponentGames: oppGames, ourRecent: recent, now: input.now, odds });
  });

  return {
    fetchedAt: input.fetchedAt,
    sourceUrl: RANGERS_STANDINGS_URL,
    scheduleUrl: RANGERS_SCHEDULE_URL,
    seasonLabel: "2026–27",
    team: us,
    standings,
    recent,
    upcoming,
    errors,
  };
}

export function cookieHeaderFromSetCookie(setCookie: readonly string[]): string {
  return setCookie
    .map((part) => part.split(";")[0]?.trim() ?? "")
    .filter((pair) => pair.includes("="))
    .join("; ");
}

export async function widgetSessionCookie(log: (message: string) => void): Promise<string> {
  try {
    const res = await httpFetch(`${RANGERS_WIDGETS}/schedules`, { headers: { Accept: "text/html" } });
    const parts = typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
    await res.arrayBuffer();
    const cookie = cookieHeaderFromSetCookie(parts);
    log(`rangers session: ${parts.length} set-cookie header(s)${cookie ? "" : " (empty)"}`);
    return cookie;
  } catch (error) {
    log(`rangers session: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

export function rangersPostWithCookie(cookie: string): RangersPost {
  return async (path, body) => {
    return fetchJson(`${RANGERS_WIDGETS}${path}`, {
      method: "POST",
      body: JSON.stringify(body),
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "X-Requested-With": "XMLHttpRequest",
        Origin: RANGERS_WIDGETS,
        Referer: `${RANGERS_WIDGETS}/schedules`,
        // Widget PHP rejects the browser-navigation Sec-Fetch defaults from httpFetch.
        "Sec-Fetch-Dest": "empty",
        "Sec-Fetch-Mode": "cors",
        "Sec-Fetch-Site": "same-origin",
        ...(cookie ? { Cookie: cookie } : {}),
      },
    });
  };
}

export const defaultRangersPost: RangersPost = rangersPostWithCookie("");

export function standingsBody(season = RANGERS_SEASON): unknown {
  return {
    CustomerID: RANGERS_CUSTOMER_ID,
    Season: season,
    League: RANGERS_LEAGUE,
    Program: "",
    TeamID: "",
    Schedules: "",
    Team: "",
    Division: "",
    DivisionGroupNameSelector: "",
    DivisionDisplay: "",
    LastX: "5",
    GroupBy: "",
    Columns: STANDINGS_COLUMNS,
    Sort: "",
    IncludeOtherLeagues: "n",
    TagIDS: "",
    StandingsProfileID: "3",
    ShowDropDown: "n",
  };
}

export function scheduleBody(teamId: string, token = "", season = RANGERS_SEASON): unknown {
  return {
    CustomerID: RANGERS_CUSTOMER_ID,
    Season: season,
    League: RANGERS_LEAGUE,
    Program: "",
    TeamID: teamId,
    Team: "",
    Location: "",
    Schedules: "",
    Columns: SCHEDULE_COLUMNS,
    GroupBy: ["DivisionName", "CurrTeamShortName"],
    ShowDropDowns: "n",
    FutureGames: "",
    NumOfDays: "",
    IncludeOtherLeagues: "n",
    LiveBarnURL: "",
    BoxScoreURL: "",
    LinkBehaviour: "",
    GamesEvents: "g",
    NumOfRecords: "",
    DateFormat: "%a %c/%d",
    GameStatus: "",
    StartDate: "",
    EndDate: "",
    TagIDS: "42",
    LiveUnpublished: "l",
    OrderBy: "",
    OrderByAscDesc: "",
    Iframe: "y",
    token,
    displayDivision: "n",
    Division: "",
    DivisionGroupNameSelector: "",
    DivisionDisplay: "",
  };
}

export async function widgetToken(post: RangersPost, log: (message: string) => void): Promise<string> {
  try {
    const res = await post<{ result?: string; token?: string }>("/index/getwidgetformat", { CustomerID: RANGERS_CUSTOMER_ID, FormatName: "e9" });
    return res.token ?? "";
  } catch (error) {
    log(`rangers widget token: ${error instanceof Error ? error.message : String(error)}`);
    return "";
  }
}

export async function refreshRangers(options: RefreshRangersOptions = {}): Promise<RangersFeed> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const post = options.post ?? rangersPostWithCookie(await widgetSessionCookie(log));
  const fetchedAt = now.toISOString();
  const errors: string[] = [];

  let standings: VaStandingsResponse = {};
  try {
    standings = await post<VaStandingsResponse>("/standings/get", standingsBody());
    if (standings.result && standings.result !== "success") errors.push(standings.message ?? "Standings request failed.");
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    log(`rangers standings FAILED: ${message}`);
    return buildRangersFeed({ standings: {}, ourSchedule: {}, opponentSchedules: {}, fetchedAt, now, errors: [`standings: ${message}`] });
  }

  const us = flattenStandings(standings.Teams).find(isRangers2016);
  if (!us?.TeamID) {
    return buildRangersFeed({ standings, ourSchedule: {}, opponentSchedules: {}, fetchedAt, now, errors });
  }

  const token = await widgetToken(post, log);
  let leagueGames: VaGameRow[] = [];
  try {
    const league = await post<VaScheduleResponse>("/schedules/get", scheduleBody("", token));
    leagueGames = flattenSchedule(league.Games);
    log(`rangers league-wide: ${leagueGames.length} rows`);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    errors.push(`schedule: ${message}`);
    log(`rangers schedule FAILED: ${message}`);
  }

  let ourGames = gamesForTeam(leagueGames, us.TeamID);
  let upcoming = selectUpcoming(ourGames, now, options.upcomingCount ?? RANGERS_UPCOMING_COUNT);
  if (upcoming.length === 0) {
    try {
      const teamSchedule = await post<VaScheduleResponse>("/schedules/get", scheduleBody(us.TeamID, token));
      const teamGames = flattenSchedule(teamSchedule.Games);
      log(`rangers team schedule: ${teamGames.length} rows`);
      if (teamGames.length > ourGames.length) ourGames = teamGames;
      upcoming = selectUpcoming(ourGames, now, options.upcomingCount ?? RANGERS_UPCOMING_COUNT);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`team schedule: ${message}`);
      log(`rangers team schedule FAILED: ${message}`);
    }
  }

  const remembered = (options.previous?.upcoming ?? []).map((card) => card.game);
  const scrapedCount = upcoming.length;
  const played = ourGames.map((g) => playedFromRow(g)).filter((g): g is RangersPlayedGame => Boolean(g));
  upcoming = mergeUpcoming(upcoming, remembered, played, now, options.upcomingCount ?? RANGERS_UPCOMING_COUNT);
  if (upcoming.length > scrapedCount) {
    log(`rangers: kept ${upcoming.length - scrapedCount} upcoming game(s) from the last scrape that the widget hid from this IP`);
  }

  log(`rangers schedule: ${ourGames.length} rows (${ourGames.filter(isCompletedGame).length} completed, ${upcoming.length} upcoming)`);
  if (ourGames.length && scrapedCount === 0) {
    const sample = ourGames[0] ?? {};
    log(
      `rangers no upcoming: GameDate=${sample.GameDate ?? ""} GameDateF=${sample.GameDateF ?? ""} GameStatus=${sample.GameStatus ?? ""} keys=${Object.keys(sample).join(",")}`,
    );
  }

  const ourSchedule = asTeamSchedule(us.TeamID, ourGames);
  const opponentSchedules: Record<string, VaScheduleResponse> = {};
  await Promise.all(
    upcoming.map(async (game) => {
      if (!game.opponentId || opponentSchedules[game.opponentId]) return;
      let rows = gamesForTeam(leagueGames, game.opponentId);
      const hasResult = rows.some((row) => parseResult(row.WinLoss ?? ""));
      if (!hasResult) {
        try {
          const opp = await post<VaScheduleResponse>("/schedules/get", scheduleBody(game.opponentId, token));
          rows = flattenSchedule(opp.Games);
        } catch (error) {
          const message = error instanceof Error ? error.message : String(error);
          errors.push(`${game.opponentName}: ${message}`);
          log(`rangers opponent ${game.opponentId} FAILED: ${message}`);
        }
      }
      opponentSchedules[game.opponentId] = asTeamSchedule(game.opponentId, rows);
    }),
  );

  const feed = buildRangersFeed({
    standings,
    ourSchedule,
    opponentSchedules,
    fetchedAt,
    now,
    upcomingCount: options.upcomingCount,
    errors,
    knownUpcoming: remembered,
    leagueRows: leagueGames,
  });
  const ranks = await fetchMhrRanks({ standings: feed.standings, fetchHtml: options.fetchMhrHtml, log });
  const withMhr = attachMhrToFeed(feed, ranks);
  log(`rangers: ${withMhr.team.name} ${formatRecord(withMhr.team.record)} · ${withMhr.upcoming.length} upcoming`);
  return withMhr;
}
