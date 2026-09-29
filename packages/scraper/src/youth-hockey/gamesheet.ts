import { chromium, type Browser, type Page } from "playwright";
import { localDateKey, type YouthBirthYear, type YouthTeam } from "@openice/shared";
import { fetchText } from "../http.js";
import { stripTags } from "../html.js";
import type { RawYouthGame } from "./core.js";

export const FED_CONFIG = { season: "15008", seasonStart: "2026-08-01", seasonEnd: "2027-08-01", divisions: { 2015: "80179", 2016: "80161" } };
export const EXPOSURE_URL = "https://www.easternexposurecup.com/en/index.html";
export interface VerifiedYouthRoster { name: string; birthYear: YouthBirthYear; evidenceUrl: string; aliases?: string[] }
interface GameSheetTeam { id?: string | number; title?: string; division?: { id?: string | number; title?: string } }
export interface GameSheetRow {
  gameId?: string | number;
  status?: string;
  gameType?: string;
  timeStampZulu?: string;
  endTimeStampZulu?: string;
  location?: string;
  home?: GameSheetTeam;
  visitor?: GameSheetTeam;
}
const cleanName = (name: string) => name.toLowerCase().replace(/[^a-z0-9]/g, "");

export function parseGameSheetGames(rows: GameSheetRow[], options: { season: string; fedYear?: YouthBirthYear; rosters?: VerifiedYouthRoster[] }): RawYouthGame[] {
  const games: RawYouthGame[] = [];
  for (const row of rows) {
    if (!/^scheduled$|^upcoming$/i.test(row.status ?? "") || /practice|training/i.test(row.gameType ?? "")) continue;
    // GameSheet's UTC timestamp is authoritative; never interpret a date-only field as a start time.
    if (!row.timeStampZulu || !/T\d{2}:\d{2}.*(?:Z|[+-]\d{2}:\d{2})$/.test(row.timeStampZulu) || !Number.isFinite(Date.parse(row.timeStampZulu)) || !row.location) continue;
    const division = row.home?.division?.title ?? row.visitor?.division?.title ?? "";
    const year = options.fedYear ?? Number(division.match(/\b(2015|2016)\b/)?.[1]) as YouthBirthYear;
    if (![2015, 2016].includes(year)) continue;
    const url = `https://gamesheetstats.com/seasons/${options.season}/games/${row.gameId}`;
    const team = (t: GameSheetTeam | undefined): YouthTeam => {
      const name = t?.title?.trim() ?? "";
      const roster = options.rosters?.find((r) => r.birthYear === year && [r.name, ...(r.aliases ?? [])].some((n) => cleanName(n) === cleanName(name)));
      const fedEligible = Boolean(options.fedYear && String(t?.division?.id) === FED_CONFIG.divisions[options.fedYear]);
      return { id: `gamesheet:${t?.id ?? cleanName(name)}`, name, division: t?.division?.title ?? "Unverified", eligible: fedEligible || Boolean(roster), evidenceUrl: fedEligible ? `https://fedhockey.com/club/elite${year}` : roster?.evidenceUrl };
    };
    const home = team(row.home), away = team(row.visitor);
    if (!home.name || !away.name || !(home.eligible || away.eligible) || !row.gameId) continue;
    games.push({ sourceGameId: String(row.gameId), birthYear: year, division, home, away, start: row.timeStampZulu, end: row.endTimeStampZulu, location: row.location, sourceUrl: url });
  }
  return games;
}

export function discoverExposureSchedule(html: string, year: number): string | undefined {
  for (const m of html.matchAll(/<a\b[^>]*href=["']([^"']+)["'][^>]*>([\s\S]*?)<\/a>/gi)) {
    const label = stripTags(m[2]!);
    if (new RegExp(`\\b${year}\\b`).test(label) && /schedule/i.test(label)) {
      const u = new URL(m[1]!.replace(/&amp;/g, "&"), EXPOSURE_URL);
      if (u.hostname === "gamesheetstats.com" && /^\/seasons\/\d+\/(?:schedule|games)/.test(u.pathname)) return u.toString();
    }
  }
  return undefined;
}

/** Ordinary browser session; a security challenge is a source failure, never bypassed. */
export class GameSheetCollector {
  private browser?: Browser;
  private async page(): Promise<Page> {
    this.browser ??= await chromium.launch({ channel: "chromium", headless: process.env.YOUTH_BROWSER_HEADED === "0" });
    const page = await this.browser.newPage({ timezoneId: "America/New_York" });
    page.setDefaultTimeout(30_000);
    return page;
  }
  async close() { await this.browser?.close(); }

  async collect(season: string, division: string | undefined, now: Date): Promise<GameSheetRow[]> {
    const page = await this.page();
    try {
      // Reuse only the public widget's own same-origin session authorization in memory.
      // Never persist it, log it, or send it to a different endpoint/origin.
      let authorization: string | undefined;
      page.on("request", async (request) => {
        const u = new URL(request.url());
        if (u.origin === "https://gamesheetstats.com" && u.pathname === `/api/unified-games/${season}`) {
          authorization = (await request.allHeaders())["authorization"] ?? authorization;
        }
      });
      const url = new URL(`https://gamesheetstats.com/seasons/${season}/games`);
      if (division) url.searchParams.set("filter[division]", division);
      await page.goto(url.toString(), { waitUntil: "domcontentloaded", timeout: 35_000 });
      // These schedules use a virtualized role=table; only reading visible rows loses games.
      await page.locator('[role="table"], table').first().waitFor({ state: "attached", timeout: 35_000 }).catch(async () => {
        const title = await page.title();
        throw new Error(/just a moment|verification|challenge/i.test(title)
          ? "GameSheet requires browser verification; this source could not be refreshed."
          : `GameSheet schedule did not finish loading (${title.slice(0, 120)}).`);
      });
      if (!authorization) {
        // The first page can be server-rendered. Ask the normal UI for its next page
        // before using the session; do not extract tokens from hidden page state.
        const request = page.waitForRequest((r) => {
          const u = new URL(r.url());
          return u.origin === "https://gamesheetstats.com" && u.pathname === `/api/unified-games/${season}`;
        }, { timeout: 10_000 }).catch(() => undefined);
        const scroll = page.locator('[data-testid="games-virtual-scroll"]');
        if (await scroll.count()) await scroll.evaluate((el) => { el.scrollTop = el.scrollHeight; });
        const observed = await request;
        authorization = observed ? (await observed.allHeaders())["authorization"] ?? authorization : authorization;
      }
      const result: GameSheetRow[] = [];
      const end = new Date(now.getTime() + 90 * 86400_000);
      for (let offset = 0; offset < 10000;) {
        const params = new URLSearchParams({ dateStart: localDateKey(now), dateEnd: localDateKey(end), order: "asc", limit: "100", offset: String(offset) });
        if (division) params.set("division", division);
        const endpoint = `/api/unified-games/${season}?${params}`;
        const response = await page.evaluate(async ({ path, authorization }) => {
          const res = await fetch(path, { signal: AbortSignal.timeout(25000), headers: authorization ? { Authorization: authorization } : {} });
          if (!res.ok) throw new Error(`GameSheet schedule HTTP ${res.status}`);
          return res.json();
        }, { path: endpoint, authorization }) as { data?: GameSheetRow[]; meta?: { filtered?: number } };
        if (!Array.isArray(response.data)) throw new Error("GameSheet returned an unexpected schedule format.");
        result.push(...response.data);
        offset += response.data.length;
        // Some servers cap page size below the requested limit; a short page is not completion.
        if (!response.data.length || (response.meta?.filtered != null && offset >= response.meta.filtered)) return result;
      }
      throw new Error("GameSheet pagination exceeded its limit; refusing an incomplete schedule.");
    } finally { await page.close(); }
  }

  async fed(year: YouthBirthYear, now: Date): Promise<RawYouthGame[]> {
    const date = localDateKey(now);
    if (date < FED_CONFIG.seasonStart || date >= FED_CONFIG.seasonEnd) throw new Error("FED season configuration needs updating.");
    const rows = await this.collect(FED_CONFIG.season, FED_CONFIG.divisions[year], now);
    return parseGameSheetGames(rows, { season: FED_CONFIG.season, fedYear: year });
  }
  async exposure(now: Date, rosters: VerifiedYouthRoster[]): Promise<RawYouthGame[]> {
    const url = discoverExposureSchedule(await fetchText(EXPOSURE_URL), now.getUTCFullYear());
    if (!url) throw new Error(`The ${now.getUTCFullYear()} Eastern Exposure Cup game schedule has not been published.`);
    const season = new URL(url).pathname.match(/\/seasons\/(\d+)/)![1]!;
    const rows = await this.collect(season, undefined, now);
    return parseGameSheetGames(rows, { season, rosters });
  }
}
