import { localToIso, parseDateOnly, toDateKey, type RawEvent } from "@openice/shared";
import { fetchJson } from "../http.js";
import type { Adapter } from "./types.js";

interface HalixEventInfo {
  calendarKey: string;
  calendarLabel: string;
  eventKey: string;
  eventName: string;
  eventType: string;
  eventDescription?: string;
  startTime: string;
  endTime: string;
  usageStartTime?: string;
  usageEndTime?: string;
}

interface HalixResponse {
  dayInfo: Array<{ date: string; eventInfo: HalixEventInfo[]; closed?: boolean }>;
}

function clock(text: string): { hour: number; minute: number } | null {
  const m = text.match(/^(\d{1,2}):(\d{2})/);
  return m ? { hour: Number(m[1]), minute: Number(m[2]) } : null;
}

export function parseHalixResponse(body: HalixResponse, scheduleUrl?: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const day of body.dayInfo ?? []) {
    const date = parseDateOnly(day.date);
    if (!date) continue;
    for (const ev of day.eventInfo ?? []) {
      // usage* excludes resurfacing time; prefer it when present.
      const startClock = clock(ev.usageStartTime ?? ev.startTime);
      const endClock = clock(ev.usageEndTime ?? ev.endTime);
      if (!startClock || !endClock) continue;
      let end = localToIso({ ...date, ...endClock });
      const start = localToIso({ ...date, ...startClock });
      if (end <= start) {
        // Ends after midnight.
        const next = new Date(Date.UTC(date.year, date.month - 1, date.day + 1));
        end = localToIso({ year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate(), ...endClock });
      }
      out.push({
        title: ev.eventName.trim(),
        start,
        end,
        surface: ev.calendarLabel,
        url: scheduleUrl,
        description: ev.eventDescription?.trim() || undefined,
      });
    }
  }
  return out;
}

/** FMC Ice Sports rinks on Halix. One POST per ~2 week window for all calendar keys. */
export const halixAdapter: Adapter<"halix"> = async (rink, source, ctx) => {
  const base = source.baseUrl.replace(/\/$/, "");
  const events: RawEvent[] = [];
  const windowDays = 14;
  const cursor = new Date(ctx.rangeStart);
  while (cursor < ctx.rangeEnd) {
    const windowEnd = new Date(Math.min(cursor.getTime() + windowDays * 86_400_000, ctx.rangeEnd.getTime()));
    const url = `${base}/event/sandboxes/${encodeURIComponent(source.sandbox)}/scope/business/${encodeURIComponent(source.businessKey)}/publicEvents?startDate=${toDateKey(cursor)}&endDate=${toDateKey(windowEnd)}`;
    const body = JSON.stringify({
      eventTypes: ["booking"],
      contextKey: source.businessKey,
      secondaryContextKey: "",
      filters: [{ eventType: "booking", filterValues: source.calendarKeys }],
    });
    const response = await fetchJson<HalixResponse>(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", Origin: base, Referer: rink.scheduleUrl ?? base },
    });
    const parsed = parseHalixResponse(response, rink.scheduleUrl);
    ctx.log(`halix ${toDateKey(cursor)}..${toDateKey(windowEnd)}: ${parsed.length} bookings`);
    events.push(...parsed);
    cursor.setTime(windowEnd.getTime());
  }
  return events;
};

const FMC_REGISTER_URL = "https://fmc.myhalix.io/pages/allprograms";

const FMC_LOCATION_TO_RINK: Array<{ match: RegExp; rinkId: string }> = [
  { match: /burlington/i, rinkId: "ice-palace-burlington" },
  { match: /somerville/i, rinkId: "veterans-somerville" },
  { match: /revere|cronin/i, rinkId: "cronin-revere" },
  { match: /cambridge|simoni/i, rinkId: "simoni-cambridge" },
  { match: /everett/i, rinkId: "allied-veterans-everett" },
];

export function mapFmcLocation(text: string | undefined): string | undefined {
  if (!text) return undefined;
  return FMC_LOCATION_TO_RINK.find((row) => row.match.test(text))?.rinkId;
}

export interface FmcClassEvent extends RawEvent {
  rinkId?: string;
}

function overlaps(a: RawEvent, b: RawEvent): boolean {
  return a.start < b.end && b.start < a.end;
}

export function isGenericFmcTitle(title: string): boolean {
  return /^(fmc\s+)?(programs|club ice)$/i.test(title.trim());
}

/** Replace generic Halix rental titles with the overlapping class name, and append leftover classes. */
export function overlayFmcClasses(bookings: RawEvent[], classes: RawEvent[]): RawEvent[] {
  const used = new Set<number>();
  const out = bookings.map((booking) => {
    if (!isGenericFmcTitle(booking.title)) return booking;
    const idx = classes.findIndex((cls, i) => !used.has(i) && overlaps(booking, cls));
    if (idx < 0) return booking;
    used.add(idx);
    const cls = classes[idx]!;
    return { ...booking, title: cls.title, url: cls.url ?? booking.url, description: cls.description ?? booking.description };
  });
  for (let i = 0; i < classes.length; i++) {
    if (!used.has(i)) out.push(classes[i]!);
  }
  return out;
}

/** FMC Halix class catalog (Learn to Skate, Club Ice, hockey classes). One POST per ~2 week window. */
export async function fetchHalixClasses(
  source: { baseUrl: string; sandbox: string; businessKey: string },
  ctx: { rangeStart: Date; rangeEnd: Date; log: (message: string) => void },
): Promise<FmcClassEvent[]> {
  const base = source.baseUrl.replace(/\/$/, "");
  const events: FmcClassEvent[] = [];
  const windowDays = 14;
  const cursor = new Date(ctx.rangeStart);
  while (cursor < ctx.rangeEnd) {
    const windowEnd = new Date(Math.min(cursor.getTime() + windowDays * 86_400_000, ctx.rangeEnd.getTime()));
    const url = `${base}/event/sandboxes/${encodeURIComponent(source.sandbox)}/scope/business/${encodeURIComponent(source.businessKey)}/publicEvents?startDate=${toDateKey(cursor)}&endDate=${toDateKey(windowEnd)}`;
    const body = JSON.stringify({
      eventTypes: ["class"],
      contextKey: source.businessKey,
      secondaryContextKey: "",
      filters: [],
    });
    const response = await fetchJson<HalixResponse>(url, {
      method: "POST",
      body,
      headers: { "Content-Type": "application/json", Origin: base, Referer: `${base}/pages/allprograms` },
    });
    const parsed = parseHalixResponse(response, FMC_REGISTER_URL).map((ev) => ({
      ...ev,
      rinkId: mapFmcLocation(ev.description ?? ev.surface),
      url: FMC_REGISTER_URL,
    }));
    ctx.log(`halix classes ${toDateKey(cursor)}..${toDateKey(windowEnd)}: ${parsed.length}`);
    events.push(...parsed);
    cursor.setTime(windowEnd.getTime());
  }
  return events;
}
