import type { OfferingsFeed, RawEvent, Rink } from "@openice/shared";
import { fetchHalixClasses, overlayFmcClasses, type FmcClassEvent } from "../adapters/halix.js";
import { clinicsFromFmc, clinicsFromStinkysocks, clinicsFromWarrior, mergeClinicOfferings } from "./clinics.js";
import { fetchStinkysocksOfferings } from "./stinkysocks.js";

export { overlayFmcClasses, fetchHalixClasses } from "../adapters/halix.js";
export { parseStinkysocksPage, fetchStinkysocksOfferings } from "./stinkysocks.js";
export { clinicsFromWarrior, clinicsFromFmc, isWarriorClinicTitle } from "./clinics.js";

export interface OfferingsRefreshContext {
  rangeStart: Date;
  rangeEnd: Date;
  fetchedAt: string;
  rinks: Rink[];
  rinkEvents: Map<string, RawEvent[]>;
  log: (message: string) => void;
  fetchStinkysocks?: typeof fetchStinkysocksOfferings;
  fetchFmcClasses?: typeof fetchHalixClasses;
}

export interface OfferingsRefreshResult {
  feeds: OfferingsFeed[];
  fmcClasses: FmcClassEvent[];
}

export async function refreshOfferings(ctx: OfferingsRefreshContext): Promise<OfferingsRefreshResult> {
  const rangeStart = ctx.rangeStart.toISOString();
  const rangeEnd = ctx.rangeEnd.toISOString();
  const stinkyFn = ctx.fetchStinkysocks ?? fetchStinkysocksOfferings;
  const fmcFn = ctx.fetchFmcClasses ?? fetchHalixClasses;

  const stinkyErrors: string[] = [];
  let stinkyOfferings: OfferingsFeed["offerings"] = [];
  try {
    const result = await stinkyFn({ rangeStart: ctx.rangeStart, rangeEnd: ctx.rangeEnd, log: ctx.log });
    stinkyOfferings = result.offerings;
    stinkyErrors.push(...result.errors);
  } catch (error) {
    stinkyErrors.push(error instanceof Error ? error.message : String(error));
  }

  const fmcErrors: string[] = [];
  let fmcClasses: FmcClassEvent[] = [];
  const halix = ctx.rinks.find((r) => r.source.kind === "halix")?.source;
  if (halix && halix.kind === "halix") {
    try {
      fmcClasses = await fmcFn(halix, { rangeStart: ctx.rangeStart, rangeEnd: ctx.rangeEnd, log: ctx.log });
    } catch (error) {
      fmcErrors.push(error instanceof Error ? error.message : String(error));
      ctx.log(`fmc classes FAILED: ${fmcErrors[0]}`);
    }
  }

  const warriorEvents = ctx.rinkEvents.get("warrior-brighton") ?? [];
  const clinics = mergeClinicOfferings(clinicsFromWarrior(warriorEvents), clinicsFromFmc(fmcClasses), clinicsFromStinkysocks(stinkyOfferings));

  const stinkysocks: OfferingsFeed = {
    id: "stinkysocks",
    fetchedAt: ctx.fetchedAt,
    rangeStart,
    rangeEnd,
    offerings: stinkyOfferings,
    errors: stinkyErrors,
  };
  const clinicsFeed: OfferingsFeed = {
    id: "clinics",
    fetchedAt: ctx.fetchedAt,
    rangeStart,
    rangeEnd,
    offerings: clinics,
    errors: fmcErrors,
  };
  return { feeds: [stinkysocks, clinicsFeed], fmcClasses };
}

export function applyFmcClassOverlay(rinkId: string, events: RawEvent[], classes: FmcClassEvent[]): RawEvent[] {
  const mine = classes.filter((c) => c.rinkId === rinkId);
  if (mine.length === 0) return events;
  return overlayFmcClasses(events, mine);
}
