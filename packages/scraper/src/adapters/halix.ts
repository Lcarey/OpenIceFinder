import { localToIso, parseDateOnly, toDateKey, type RawEvent } from "@openice/shared";
import { fetchJson } from "../http.js";
import type { Adapter } from "./types.js";

interface HalixEventInfo {
  calendarKey: string;
  calendarLabel: string;
  eventKey: string;
  eventName: string;
  eventType: string;
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
      out.push({ title: ev.eventName.trim(), start, end, surface: ev.calendarLabel, url: scheduleUrl });
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
