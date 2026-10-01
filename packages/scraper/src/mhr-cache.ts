import { MHR_SEASON, type MhrEntry, type MhrSnapshot } from "@openice/shared";
import { decodeEntities, stripTags } from "./html.js";

export const MHR_LISTS = [
  { birthYear: 2016, url: `https://myhockeyrankings.com/rank?y=${MHR_SEASON}&v=122&view=alphabetic` },
  { birthYear: 2015, url: `https://myhockeyrankings.com/rank?y=${MHR_SEASON}&v=123&view=alphabetic` },
];

export function parseMhrTable(html: string, birthYear: number): MhrEntry[] {
  const headers = [...html.matchAll(/<th\b[^>]*>([\s\S]*?)<\/th>/gi)].map((m) => stripTags(m[1]!).toLowerCase().replace(/[^a-z ]/g, "").trim());
  const ratingColumn = headers.indexOf("rating"), rankColumn = headers.indexOf("rank"), recordColumn = headers.indexOf("record");
  if (ratingColumn < 0) throw new Error("MHR rating column is missing.");
  const teams: MhrEntry[] = [];
  for (const row of html.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)) {
    const link = row[1]!.match(/<a\b[^>]*href=["']([^"']*(?:team_info|team-info)[^"']*)["'][^>]*>([\s\S]*?)<\/a>/i);
    if (!link) continue;
    const url = new URL(decodeEntities(link[1]!), "https://myhockeyrankings.com");
    const season = Number(url.searchParams.get("y") ?? url.pathname.match(/team-info\/\d+\/(\d+)/)?.[1]);
    if (season !== MHR_SEASON) throw new Error("MHR returned a different season.");
    const id = Number(url.searchParams.get("t") ?? url.pathname.match(/team-info\/(\d+)/)?.[1]);
    const name = stripTags(link[2]!);
    if (!id || !new RegExp(`\\b${MHR_SEASON - birthYear}U\\b`, "i").test(name)) continue;
    const cells = [...row[1]!.matchAll(/<td\b[^>]*>([\s\S]*?)<\/td>/gi)].map((m) => stripTags(m[1]!));
    const ratingText = cells[ratingColumn];
    if (!ratingText || !/^\d+(?:\.\d+)?$/.test(ratingText)) throw new Error(`Invalid MHR rating for ${name}.`);
    const record = cells[recordColumn]?.match(/^([0-9]+)-([0-9]+)-([0-9]+)(?:-([0-9]+))?$/);
    const games = record ? record.slice(1).reduce((sum, n) => sum + Number(n ?? 0), 0) : 0;
    const rating = games >= 5 ? Number(ratingText) : 0;
    const rank = rankColumn >= 0 ? Number(cells[rankColumn]?.match(/^\d+/)?.[0]) : undefined;
    // Store AAA rosters only: these are the teams eligible for the app's games.
    if (/\bAAA\b/.test(name)) teams.push({ id, name, birthYear, url: `https://myhockeyrankings.com/team-info/${id}/${MHR_SEASON}`, ...(rating > 0 ? { rating } : {}), ...(rank && rating > 0 ? { rank } : {}) });
  }
  if (teams.length < 10 || new Set(teams.map((t) => t.id)).size !== teams.length) throw new Error("MHR returned an empty, incomplete, or duplicate listing.");
  return teams;
}

/** A failed age list retains its last successful snapshot and original timestamp. */
export async function refreshMhrSnapshot(options: {
  previous?: MhrSnapshot;
  fetchTable: (url: string) => Promise<string>;
  now?: Date;
  log?: (message: string) => void;
}): Promise<MhrSnapshot> {
  const checkedAt = (options.now ?? new Date()).toISOString();
  const previous = options.previous?.version === 1 && options.previous.season === MHR_SEASON ? options.previous : undefined;
  const snapshot: MhrSnapshot = { version: 1, season: MHR_SEASON, sources: [], teams: [] };
  for (const list of MHR_LISTS) {
    try {
      const teams = parseMhrTable(await options.fetchTable(list.url), list.birthYear);
      snapshot.teams.push(...teams);
      snapshot.sources.push({ ...list, checkedAt, fetchedAt: checkedAt });
      options.log?.(`MHR ${list.birthYear}: ${teams.length} teams, ${teams.filter((t) => t.rating).length} published ratings.`);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      snapshot.teams.push(...(previous?.teams.filter((t) => t.birthYear === list.birthYear) ?? []));
      snapshot.sources.push({ ...list, checkedAt, fetchedAt: previous?.sources.find((s) => s.birthYear === list.birthYear)?.fetchedAt, error: message });
      options.log?.(`MHR ${list.birthYear}: ${message} Retaining previous ratings.`);
    }
  }
  return snapshot;
}
