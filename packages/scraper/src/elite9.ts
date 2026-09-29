/* Public Valley Associates widget adapter, shared by Rangers and youth hockey. */
import { stripTags } from "./html.js";
import { fetchJson, httpFetch } from "./http.js";

export const RANGERS_STANDINGS_URL = "https://www.elite9hockey.com/pages/standings/boys-2026-27/";
export const RANGERS_SCHEDULE_URL = "https://www.elite9hockey.com/pages/schedules/boys-2026-27-schedule/";
export const RANGERS_WIDGETS = "https://widgets.vahockey.com";
export const RANGERS_SEASON = "2027";
export const RANGERS_LEAGUE = "e9bhl";
export const RANGERS_CUSTOMER_ID = "1";
export const RANGERS_UPCOMING_COUNT = 5;

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

