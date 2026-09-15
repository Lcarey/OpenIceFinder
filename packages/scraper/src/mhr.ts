import {
  matchRangersMhrTeam,
  rangersMhrUrl,
  type RangersFeed,
  type RangersStandingRow,
} from "@openice/shared";
import { fetchText } from "./http.js";

export function parseMhrRank(html: string): number | undefined {
  if (/just a moment|cf-mitigated|challenge-platform/i.test(html)) return undefined;

  const patterns = [
    /USA\s*10U\s*[-–]\s*All[\s\S]{0,280}?(?:#|rank(?:ing)?\s*[:#]?\s*)(\d{1,4})/i,
    /(?:#|rank(?:ing)?\s*[:#]?\s*)(\d{1,4})[\s\S]{0,280}?USA\s*10U\s*[-–]\s*All/i,
    /"name"\s*:\s*"USA 10U - All"[\s\S]{0,160}?"rank"\s*:\s*(\d+)/i,
    /"rank"\s*:\s*(\d+)[\s\S]{0,160}?"name"\s*:\s*"USA 10U - All"/i,
  ];
  for (const re of patterns) {
    const match = html.match(re);
    const rank = match ? Number(match[1]) : 0;
    if (rank > 0) return rank;
  }
  return undefined;
}

function patchRow(row: RangersStandingRow, ranks: ReadonlyMap<number, number>): RangersStandingRow {
  const mhr = matchRangersMhrTeam(row.name) ?? matchRangersMhrTeam(row.shortName);
  if (!mhr) return row;
  const rank = ranks.get(mhr.id);
  return {
    ...row,
    mhrUrl: rangersMhrUrl(mhr.id),
    ...(rank != null ? { mhrRank: rank } : {}),
  };
}

export function attachMhrToFeed(feed: RangersFeed, ranks: ReadonlyMap<number, number> = new Map()): RangersFeed {
  return {
    ...feed,
    team: patchRow(feed.team, ranks),
    standings: feed.standings.map((row) => patchRow(row, ranks)),
    upcoming: feed.upcoming.map((card) => ({ ...card, opponent: patchRow(card.opponent, ranks) })),
  };
}

export async function fetchMhrRanks(options: {
  standings: RangersStandingRow[];
  fetchHtml?: (url: string) => Promise<string>;
  log?: (message: string) => void;
}): Promise<Map<number, number>> {
  const log = options.log ?? (() => {});
  const fetchHtml = options.fetchHtml ?? ((url: string) => fetchText(url, { retries: 0, timeoutMs: 12_000 }));
  const ids = [
    ...new Set(
      options.standings
        .map((row) => matchRangersMhrTeam(row.name)?.id ?? matchRangersMhrTeam(row.shortName)?.id)
        .filter((id): id is number => typeof id === "number"),
    ),
  ];
  const ranks = new Map<number, number>();
  let blocked = 0;
  await Promise.all(
    ids.map(async (id) => {
      const url = rangersMhrUrl(id);
      try {
        const html = await fetchHtml(url);
        if (/just a moment|cf-mitigated|challenge-platform/i.test(html)) {
          blocked += 1;
          return;
        }
        const rank = parseMhrRank(html);
        if (rank != null) ranks.set(id, rank);
      } catch (error) {
        const status = error && typeof error === "object" && "status" in error ? Number(error.status) : 0;
        if (status === 403) blocked += 1;
        else log(`mhr ${id}: ${error instanceof Error ? error.message : String(error)}`);
      }
    }),
  );
  if (blocked) log(`mhr: ${blocked} team page(s) blocked or unranked; column stays blank until MHR publishes`);
  else if (ranks.size) log(`mhr: ${ranks.size} rank(s)`);
  else log("mhr: no published USA 10U ranks yet");
  return ranks;
}
