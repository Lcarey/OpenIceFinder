import type { MhrEntry, MhrSource } from "./mhr.js";
import type { DriveEstimate } from "./types.js";
import { localDateKey, RINK_TIME_ZONE } from "./time.js";

export type YouthBirthYear = 2015 | 2016;
export type YouthLeague = "FED Elite" | "Elite 9" | "AAA tournaments";
export interface YouthTeam {
  mhr?: MhrEntry;
  id: string;
  name: string;
  eligible: boolean;
  division: string;
  evidenceUrl?: string;
}
export interface YouthVenue {
  id: string;
  name: string;
  address: string;
  town: string;
}
export interface YouthGame {
  id: string;
  sourceId: string;
  sourceGameId?: string;
  league: YouthLeague;
  birthYear: YouthBirthYear;
  division: string;
  home: YouthTeam;
  away: YouthTeam;
  start: string;
  /** Only present when the source publishes an end time. */
  end?: string;
  venue: YouthVenue;
  iceSheet: string;
  /** Cached typical-traffic prediction for the game’s local weekday and start time. */
  drive?: DriveEstimate;
  driveSeconds: number;
  driveMeters: number;
  sourceUrl: string;
  verifiedAt: string;
}
export interface YouthSourceStatus {
  id: string;
  name: string;
  url: string;
  status: "ok" | "stale" | "unavailable";
  attemptedAt: string;
  fetchedAt?: string;
  message?: string;
  gameCount: number;
  excludedVenues?: string[];
}
export interface YouthHockeyFeed {
  mhrSources?: MhrSource[];
  version: 1;
  generatedAt: string;
  rangeStart: string;
  rangeEnd: string;
  sources: YouthSourceStatus[];
  games: YouthGame[];
}
export const YOUTH_STALE_LIMIT_MS = 48 * 60 * 60 * 1000;
export const YOUTH_LEAGUES: YouthLeague[] = ["FED Elite", "Elite 9", "AAA tournaments"];
export type YouthWindow = "today" | "weekend" | "month";

function shiftDay(key: string, days: number): string {
  const d = new Date(`${key}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

export function selectYouthGames(feed: YouthHockeyFeed, filters: { window: YouthWindow; year?: YouthBirthYear; league?: YouthLeague }, now = new Date()): YouthGame[] {
  const today = localDateKey(now);
  let first = today;
  let last = shiftDay(today, filters.window === "today" ? 1 : 30);
  if (filters.window === "weekend") {
    const day = new Date(`${today}T12:00:00Z`).getUTCDay();
    first = day === 0 ? shiftDay(today, -1) : shiftDay(today, (6 - day + 7) % 7);
    last = shiftDay(first, 2);
  }
  return feed.games.filter((g) => {
    const start = Date.parse(g.start);
    const verified = Date.parse(g.verifiedAt);
    if (!Number.isFinite(start) || !Number.isFinite(verified) || start < now.getTime() || now.getTime() - verified > YOUTH_STALE_LIMIT_MS) return false;
    const date = localDateKey(g.start);
    return date >= first && date < last && g.driveSeconds >= 0 && g.driveSeconds < 1800
      && (g.home.eligible || g.away.eligible) && (!filters.year || g.birthYear === filters.year) && (!filters.league || g.league === filters.league);
  }).sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

export function youthDirectionsUrl(game: YouthGame): string {
  return `https://www.google.com/maps/dir/?${new URLSearchParams({ api: "1", destination: `${game.venue.name}, ${game.venue.address}`, travelmode: "driving" })}`;
}

export function youthDriveLabel(seconds: number): string {
  // Preserve the strict cutoff without showing an included 29:59 route as "30 min".
  return seconds >= 1740 ? "<30 min" : `~${Math.round(seconds / 60)} min`;
}

export function youthCalendarUrl(game: YouthGame): string {
  const start = new Date(game.start);
  const publishedEnd = game.end ? new Date(game.end) : undefined;
  const knownEnd = publishedEnd && Number.isFinite(publishedEnd.getTime()) && publishedEnd > start;
  const end = knownEnd ? publishedEnd : new Date(start.getTime() + 90 * 60_000);
  const compact = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");
  const details = [
    `${game.league} · ${game.division} · ${game.birthYear} birth year`,
    `Estimated drive from Arlington: ${youthDriveLabel(game.driveSeconds)} (Amazon Location, typical traffic for arrival at game start).`,
    ...(!knownEnd ? ["Duration is estimated at 90 minutes; the source does not publish an end time."] : []),
    `Official schedule: ${game.sourceUrl}`,
    `Directions: ${youthDirectionsUrl(game)}`,
    `Schedule last verified: ${new Date(game.verifiedAt).toLocaleString("en-US", { timeZone: RINK_TIME_ZONE, timeZoneName: "short" })}`,
    "Check the official schedule before leaving. Changes and cancellations do not automatically update this calendar entry.",
  ].join("\n\n");
  return `https://calendar.google.com/calendar/r/eventedit?${new URLSearchParams({
    action: "TEMPLATE", text: `Watch hockey: ${game.away.name} vs ${game.home.name} — ${game.birthYear}`,
    dates: `${compact(start)}/${compact(end)}`, stz: RINK_TIME_ZONE, etz: RINK_TIME_ZONE,
    location: [game.venue.name, game.iceSheet, game.venue.address].filter(Boolean).join(", "), details,
  })}`;
}
