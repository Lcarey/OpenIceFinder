import { createHash } from "node:crypto";
import { YOUTH_STALE_LIMIT_MS, type DriveEstimate, type YouthGame, type YouthHockeyFeed, type YouthLeague, type YouthSourceStatus, type YouthTeam, type YouthBirthYear, type YouthVenue } from "@openice/shared";

export interface RawYouthGame {
  sourceGameId?: string;
  birthYear: YouthBirthYear;
  division: string;
  home: YouthTeam;
  away: YouthTeam;
  start: string;
  end?: string;
  location: string;
  sourceUrl: string;
}
export interface YouthSource {
  id: string;
  name: string;
  url: string;
  league: YouthLeague;
  collect: () => Promise<RawYouthGame[]>;
}
export interface LocatedVenue extends YouthVenue { lat: number; lng: number; aliases: string[]; evidenceUrl: string }

export function normalizeLocation(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();
}
export function resolveVenue(location: string, venues: LocatedVenue[]): LocatedVenue | undefined {
  const key = normalizeLocation(location);
  if (!key || /\btba\b|\btbd\b/.test(key)) return undefined;
  const exact = venues.filter((v) => [v.name, ...v.aliases].some((a) => normalizeLocation(a) === key));
  if (exact.length === 1) return exact[0];
  // Only permit explicit sheet suffixes; never match an ambiguous town or a substring.
  const base = key.replace(/\s+(?:rink\s+)?(?:[1-9]|upper|lower|east|west|nhl|oly|olympic|blue|red|gold|gray|a|b|c)$/, "");
  const matches = venues.filter((v) => [v.name, ...v.aliases].some((a) => normalizeLocation(a) === base));
  return matches.length === 1 ? matches[0] : undefined;
}

export function teamKey(name: string): string {
  return normalizeLocation(name).replace(/\bjuniors?\b/g, "jr").replace(/\b(?:2015|2016|15|16|elite|aaa)\b/g, "").replace(/\s+/g, " ").trim();
}
export function resolveIceSheet(location: string): string {
  const match = normalizeLocation(location).match(/(?:^| )(?:rink )?([1-9]|upper|lower|east|west|nhl|oly|olympic|blue|red|gold|gray|lawler|gallant|a|b|c)(?: arena)?$/);
  if (!match) return "";
  const sheet = match[1]!;
  return /^\d$/.test(sheet) ? `Rink ${sheet}` : sheet === "oly" ? "Olympic" : sheet[0]!.toUpperCase() + sheet.slice(1);
}
export function gameKey(g: Pick<YouthGame, "home" | "away" | "start" | "venue" | "birthYear" | "iceSheet">): string {
  return [g.birthYear, ...[teamKey(g.home.name), teamKey(g.away.name)].sort(), Date.parse(g.start), g.venue.id, normalizeLocation(g.iceSheet)].join("|");
}
export function deduplicateGames(games: YouthGame[]): YouthGame[] {
  const found = new Map<string, YouthGame>();
  // A freshly verified authoritative copy wins over an old cached copy.
  for (const game of [...games].sort((a, b) => Date.parse(b.verifiedAt) - Date.parse(a.verifiedAt))) {
    const key = gameKey(game);
    if (!found.has(key)) found.set(key, game);
  }
  return [...found.values()].sort((a, b) => Date.parse(a.start) - Date.parse(b.start) || a.id.localeCompare(b.id));
}

export async function refreshYouthHockey(options: {
  sources: YouthSource[];
  venues: LocatedVenue[];
  drive: (v: LocatedVenue, start: string) => Promise<DriveEstimate | undefined>;
  previous?: YouthHockeyFeed;
  now?: Date;
  log?: (message: string) => void;
}): Promise<YouthHockeyFeed> {
  const now = options.now ?? new Date();
  const rangeEnd = new Date(now.getTime() + 90 * 86400_000);
  const generatedAt = now.toISOString();
  const games: YouthGame[] = [];
  const statuses: YouthSourceStatus[] = [];
  for (const source of options.sources) {
    const status: YouthSourceStatus = { id: source.id, name: source.name, url: source.url, status: "ok", attemptedAt: generatedAt, gameCount: 0 };
    try {
      const rows = await source.collect();
      const sourceGames: YouthGame[] = [];
      const excluded = new Set<string>();
      for (const row of rows) {
        const ms = Date.parse(row.start);
        if (!Number.isFinite(ms) || ms < now.getTime() || ms >= rangeEnd.getTime() || ![2015, 2016].includes(row.birthYear) || !(row.home.eligible || row.away.eligible)) continue;
        const venue = resolveVenue(row.location, options.venues);
        if (!venue || !Number.isFinite(venue.lat) || !Number.isFinite(venue.lng)) { excluded.add(row.location); continue; }
        const drive = await options.drive(venue, row.start);
        if (!drive || !Number.isFinite(drive.durationSeconds) || drive.durationSeconds <= 0) { excluded.add(row.location); continue; }
        if (drive.durationSeconds >= 1800) continue;
        const game: YouthGame = {
          id: "", sourceId: source.id, sourceGameId: row.sourceGameId, league: source.league,
          birthYear: row.birthYear, division: row.division, home: row.home, away: row.away, start: row.start,
          ...(row.end && Date.parse(row.end) > ms ? { end: row.end } : {}),
          venue: { id: venue.id, name: venue.name, address: venue.address, town: venue.town },
          iceSheet: resolveIceSheet(row.location),
          drive, driveSeconds: drive.durationSeconds, driveMeters: drive.distanceMeters, sourceUrl: row.sourceUrl, verifiedAt: generatedAt,
        };
        game.id = `${source.id}:${row.sourceGameId ?? createHash("sha256").update(gameKey(game)).digest("hex").slice(0, 20)}`;
        sourceGames.push(game);
      }
      status.fetchedAt = generatedAt;
      status.excludedVenues = [...excluded].sort();
      status.gameCount = deduplicateGames(sourceGames).length;
      games.push(...sourceGames);
      options.log?.(`${source.id}: ${rows.length} source games, ${status.gameCount} nearby upcoming games, ${excluded.size} unresolved venues`);
    } catch (error) {
      const previous = options.previous?.sources.find((s) => s.id === source.id);
      status.fetchedAt = previous?.fetchedAt;
      const age = previous?.fetchedAt ? now.getTime() - Date.parse(previous.fetchedAt) : Infinity;
      status.status = Number.isFinite(age) && age <= YOUTH_STALE_LIMIT_MS ? "stale" : "unavailable";
      // Collector errors contain public source information only; never routing URLs or origin configuration.
      status.message = error instanceof Error ? error.message.split("\n")[0]!.replace(/^page\.[^:]+: (?:Error: )?/, "") : "Schedule could not be loaded.";
      if (status.status === "stale") {
        const cached = (options.previous?.games ?? []).filter((g) => g.sourceId === source.id && Date.parse(g.start) >= now.getTime() && Date.parse(g.start) < rangeEnd.getTime() && now.getTime() - Date.parse(g.verifiedAt) <= YOUTH_STALE_LIMIT_MS);
        // Re-route cached schedules too: an old OSRM feed must never bypass the traffic cutoff.
        for (const game of cached) {
          const venue = options.venues.find((v) => v.id === game.venue.id);
          if (!venue) continue;
          const drive = await options.drive(venue, game.start);
          if (!drive || !Number.isFinite(drive.durationSeconds) || drive.durationSeconds <= 0 || drive.durationSeconds >= 1800) continue;
          games.push({ ...game, drive, driveSeconds: drive.durationSeconds, driveMeters: drive.distanceMeters });
          status.gameCount++;
        }
      }
      options.log?.(`${source.id}: ${status.status} — ${status.message}`);
    }
    statuses.push(status);
  }
  return { version: 1, generatedAt, rangeStart: generatedAt, rangeEnd: rangeEnd.toISOString(), sources: statuses, games: deduplicateGames(games) };
}
