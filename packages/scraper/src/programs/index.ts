import type { Program, ProgramEvent, ProgramFeed, ProgramIndexEntry } from "@openice/shared";
import { fetchCrossbarProgram, type CrossbarContext } from "./crossbar.js";

export interface RefreshProgramsOptions {
  programs: Program[];
  rangeStart: Date;
  rangeEnd: Date;
  now?: Date;
  log?: (message: string) => void;
  /** Override the fetcher (tests). */
  fetch?: CrossbarContext["fetch"];
  /** Last successful feed per program id; used to keep a team's events when its page fails this run. */
  previous?: (programId: string) => Promise<ProgramFeed | undefined>;
}

export interface RefreshProgramsResult {
  feeds: ProgramFeed[];
  index: ProgramIndexEntry[];
}

/**
 * Events from the last successful feed that involve a team whose page failed this run and that no other
 * team's page already reported (shared slots are republished by every participant, so only solo slots are missing).
 */
export function carryOverEvents(current: ProgramEvent[], previous: ProgramFeed | undefined, failedTeamIds: string[], rangeStart: Date, rangeEnd: Date): ProgramEvent[] {
  if (!previous || failedTeamIds.length === 0) return [];
  const failed = new Set(failedTeamIds);
  const seen = new Set(current.map((e) => `${e.start}|${e.end}|${e.location.toLowerCase()}`));
  const startMs = rangeStart.getTime();
  const endMs = rangeEnd.getTime();
  return previous.events.filter((e) => {
    if (!e.teamIds.some((id) => failed.has(id))) return false;
    const s = new Date(e.start).getTime();
    if (s < startMs || s >= endMs) return false;
    const key = `${e.start}|${e.end}|${e.location.toLowerCase()}`;
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

/** Refresh every configured program's team schedules; a failing program yields an empty feed with an error. */
export async function refreshPrograms(options: RefreshProgramsOptions): Promise<RefreshProgramsResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const fetchedAt = now.toISOString();
  const feeds: ProgramFeed[] = [];
  for (const program of options.programs) {
    const ctx: CrossbarContext = { rangeStart: options.rangeStart, rangeEnd: options.rangeEnd, log: (m) => log(`[${program.id}] ${m}`), fetch: options.fetch };
    const started = Date.now();
    try {
      const { teams, events, errors, failedTeamIds } = await fetchCrossbarProgram(program, ctx);
      if (failedTeamIds.length > 0 && options.previous) {
        const prior = await options.previous(program.id).catch(() => undefined);
        const carried = carryOverEvents(events, prior, failedTeamIds, options.rangeStart, options.rangeEnd);
        if (carried.length > 0) {
          events.push(...carried);
          events.sort((a, b) => a.start.localeCompare(b.start) || a.location.localeCompare(b.location));
          log(`[${program.id}] carried over ${carried.length} events from the previous run for ${failedTeamIds.length} unreachable team page(s)`);
        }
      }
      log(`[${program.id}] ${events.length} events (${events.filter((e) => e.atHomeRink).length} at home) in ${Date.now() - started}ms`);
      feeds.push({ program, fetchedAt, rangeStart: options.rangeStart.toISOString(), rangeEnd: options.rangeEnd.toISOString(), teams, events, errors });
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[${program.id}] FAILED: ${message}`);
      const prior = options.previous ? await options.previous(program.id).catch(() => undefined) : undefined;
      if (prior && prior.events.length > 0) {
        // Keep publishing the last good schedule rather than wiping it; the stale fetchedAt is shown in the UI.
        log(`[${program.id}] keeping the previous feed from ${prior.fetchedAt}`);
        feeds.push({ ...prior, program, errors: [`${message} — showing schedules fetched ${prior.fetchedAt}`] });
      } else {
        feeds.push({ program, fetchedAt, rangeStart: options.rangeStart.toISOString(), rangeEnd: options.rangeEnd.toISOString(), teams: [], events: [], errors: [message] });
      }
    }
  }
  const index: ProgramIndexEntry[] = feeds.map((feed) => ({
    program: feed.program,
    fetchedAt: feed.fetchedAt,
    teamCount: feed.teams.length,
    eventCount: feed.events.length,
    homeEventCount: feed.events.filter((e) => e.atHomeRink).length,
    ok: feed.errors.length === 0 || feed.events.length > 0,
    errors: feed.errors,
  }));
  return { feeds, index };
}
