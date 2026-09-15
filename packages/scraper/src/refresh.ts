import {
  dedupeAndSort,
  eventId,
  isOpenIce,
  localDateKey,
  localToUtcMillis,
  type IceEvent,
  type OfferingsFeed,
  type Program,
  type ProgramFeed,
  type RangersFeed,
  type RawEvent,
  type Rink,
  type RinkFeed,
  type RinkIndex,
  type RinkIndexEntry,
} from "@openice/shared";
import type OpenAI from "openai";
import { fetchRinkEvents, type AdapterContext } from "./adapters/index.js";
import type { Classifier, UnknownTitle } from "./classify.js";
import { applyFmcClassOverlay, refreshOfferings, type OfferingsRefreshContext } from "./offerings/index.js";
import { refreshPrograms, type RefreshProgramsOptions } from "./programs/index.js";
import { refreshRangers } from "./rangers.js";

export interface RefreshOptions {
  rinks: Rink[];
  /** Hockey programs whose team schedules annotate a rink; refreshed alongside the rinks. */
  programs?: Program[];
  classifier: Classifier;
  openai: () => Promise<OpenAI>;
  openaiModel: string;
  /** Days ahead to fetch (from the start of today, rink-local). */
  rangeDays?: number;
  now?: Date;
  concurrency?: number;
  log?: (message: string) => void;
  /** Override the adapter dispatcher (tests). */
  fetchEvents?: (rink: Rink, ctx: AdapterContext) => Promise<RawEvent[]>;
  /** Override the program page fetcher (tests). */
  fetchProgramPage?: RefreshProgramsOptions["fetch"];
  /** Previous program feed lookup, used to carry over events for unreachable team pages. */
  previousProgramFeed?: RefreshProgramsOptions["previous"];
  /** Override offerings scrapers (tests). When `fetchEvents` is set and this is omitted, offerings are skipped. */
  fetchOfferings?: (ctx: OfferingsRefreshContext) => ReturnType<typeof refreshOfferings>;
  /** Override the hidden /rangers Elite 9 scrape (tests). Skipped when `fetchEvents` is set unless this is provided. */
  fetchRangers?: () => Promise<RangersFeed>;
}

export interface RefreshResult {
  feeds: RinkFeed[];
  programFeeds: ProgramFeed[];
  offeringFeeds: OfferingsFeed[];
  rangersFeed: RangersFeed | null;
  index: RinkIndex;
}

/** [start of today in America/New_York, +rangeDays) as UTC instants. */
export function refreshWindow(now: Date, rangeDays: number): { rangeStart: Date; rangeEnd: Date } {
  const todayKey = localDateKey(now);
  const [y, m, d] = todayKey.split("-").map(Number) as [number, number, number];
  const rangeStart = new Date(localToUtcMillis({ year: y, month: m, day: d, hour: 0, minute: 0 }));
  const endDay = new Date(Date.UTC(y, m - 1, d + rangeDays));
  const rangeEnd = new Date(localToUtcMillis({ year: endDay.getUTCFullYear(), month: endDay.getUTCMonth() + 1, day: endDay.getUTCDate(), hour: 0, minute: 0 }));
  return { rangeStart, rangeEnd };
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  const workers = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (next < items.length) {
      const idx = next++;
      results[idx] = await fn(items[idx]!);
    }
  });
  await Promise.all(workers);
  return results;
}

export async function refreshAll(options: RefreshOptions): Promise<RefreshResult> {
  const now = options.now ?? new Date();
  const log = options.log ?? (() => {});
  const { rangeStart, rangeEnd } = refreshWindow(now, options.rangeDays ?? 35);
  const fetchEvents = options.fetchEvents ?? fetchRinkEvents;

  type Partial = { rink: Rink; raw: RawEvent[]; errors: string[] };
  const partials = await mapWithConcurrency(options.rinks, options.concurrency ?? 4, async (rink): Promise<Partial> => {
    const ctx: AdapterContext = {
      rangeStart,
      rangeEnd,
      openai: options.openai,
      openaiModel: options.openaiModel,
      log: (message) => log(`[${rink.id}] ${message}`),
    };
    const started = Date.now();
    try {
      const raw = dedupeAndSort(await fetchEvents(rink, ctx));
      log(`[${rink.id}] ${raw.length} events in ${Date.now() - started}ms`);
      return { rink, raw, errors: [] };
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`[${rink.id}] FAILED: ${message}`);
      const prefix = `${rink.source.kind}: `;
      return { rink, raw: [], errors: [message.startsWith(prefix) ? message : prefix + message] };
    }
  });

  const programResult = await refreshPrograms({ programs: options.programs ?? [], rangeStart, rangeEnd, now, log, fetch: options.fetchProgramPage, previous: options.previousProgramFeed });

  const fetchedAt = now.toISOString();
  const rinkEvents = new Map(partials.map((p) => [p.rink.id, p.raw]));
  const shouldLoadOfferings = Boolean(options.fetchOfferings) || !options.fetchEvents;
  const offeringResult = shouldLoadOfferings
    ? await (options.fetchOfferings ?? refreshOfferings)({
        rangeStart,
        rangeEnd,
        fetchedAt,
        rinks: options.rinks,
        rinkEvents,
        log,
      })
    : { feeds: [] as OfferingsFeed[], fmcClasses: [] };
  if (offeringResult.fmcClasses.length > 0) {
    for (const part of partials) {
      part.raw = dedupeAndSort(applyFmcClassOverlay(part.rink.id, part.raw, offeringResult.fmcClasses));
    }
  }

  // First pass: table + rules. Collect what needs the model.
  const unknowns: UnknownTitle[] = [];
  for (const part of partials) {
    const seen = new Set<string>();
    for (const raw of part.raw) {
      if (options.classifier.classify(part.rink.id, raw.title)) continue;
      const key = raw.title.toLowerCase();
      if (seen.has(key)) continue;
      seen.add(key);
      unknowns.push({ rinkId: part.rink.id, rinkName: part.rink.name, title: raw.title, example: { start: raw.start, end: raw.end, surface: raw.surface, description: raw.description } });
    }
  }
  if (unknowns.length > 0) {
    log(`classifier: ${unknowns.length} titles need the model`);
    await options.classifier.resolveWithModel(unknowns);
  }

  const feeds: RinkFeed[] = partials.map((part) => {
    const events: IceEvent[] = part.raw.map((raw) => {
      const result = options.classifier.classify(part.rink.id, raw.title) ?? options.classifier.fallback();
      return { ...raw, id: eventId(part.rink.id, raw), rinkId: part.rink.id, category: result.category, classifiedBy: result.classifiedBy };
    });
    if (part.rink.source.kind === "link-only") {
      part.errors.push(part.rink.source.reason ?? "No machine-readable schedule; check the rink's website.");
    }
    return { rink: part.rink, fetchedAt, rangeStart: rangeStart.toISOString(), rangeEnd: rangeEnd.toISOString(), events, errors: part.errors };
  });

  const nowMs = now.getTime();
  const entries: RinkIndexEntry[] = feeds.map((feed) => {
    const open = feed.events.filter((e) => isOpenIce(e.category));
    const nextOpenIce = open.find((e) => new Date(e.end).getTime() > nowMs);
    return {
      rink: feed.rink,
      fetchedAt: feed.fetchedAt,
      eventCount: feed.events.length,
      openIceCount: open.length,
      nextOpenIce,
      ok: feed.errors.length === 0 || feed.events.length > 0,
      errors: feed.errors,
    };
  });
  entries.sort((a, b) => a.rink.driveMinutes - b.rink.driveMinutes || a.rink.name.localeCompare(b.rink.name));

  const index: RinkIndex = { generatedAt: fetchedAt, rinks: entries };
  if (programResult.index.length > 0) index.programs = programResult.index;
  if (offeringResult.feeds.length > 0) {
    index.offerings = {};
    for (const feed of offeringResult.feeds) {
      index.offerings[feed.id] = {
        fetchedAt: feed.fetchedAt,
        eventCount: feed.offerings.length,
        ok: feed.errors.length === 0 || feed.offerings.length > 0,
        errors: feed.errors,
      };
    }
  }

  const shouldLoadRangers = Boolean(options.fetchRangers) || !options.fetchEvents;
  let rangersFeed: RangersFeed | null = null;
  if (shouldLoadRangers) {
    try {
      rangersFeed = await (options.fetchRangers ?? (() => refreshRangers({ now, log })))();
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      log(`rangers FAILED: ${message}`);
      rangersFeed = {
        fetchedAt,
        sourceUrl: "https://www.elite9hockey.com/pages/standings/boys-2026-27/",
        scheduleUrl: "https://www.elite9hockey.com/pages/schedules/boys-2026-27-schedule/",
        seasonLabel: "2026–27",
        team: {
          teamId: "",
          name: "Boston Jr. Rangers 16 - Elite",
          shortName: "Jr. Rangers 16 - Elite",
          division: "2016 White",
          rank: 0,
          record: { gp: 0, wins: 0, losses: 0, ties: 0, points: 0, gf: 0, ga: 0, gd: 0, streak: "", lastFive: "" },
          isUs: true,
        },
        standings: [],
        recent: [],
        upcoming: [],
        errors: [message],
      };
    }
  }

  return { feeds, programFeeds: programResult.feeds, offeringFeeds: offeringResult.feeds, rangersFeed, index };
}
