import { formatIsoWithOffset, localToUtcMillis, type RawEvent } from "@openice/shared";
import { fetchText } from "../http.js";
import type { Adapter } from "./types.js";

interface VEvent {
  summary: string;
  dtstart: { millis: number; allDay: boolean };
  dtend?: { millis: number; allDay: boolean };
  rrule?: Record<string, string>;
  exdates: number[];
  location?: string;
  url?: string;
  description?: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n")
    .filter(Boolean);
}

/**
 * Parse an iCal date/time. Floating and TZID times are treated as rink-local
 * wall-clock times (feeds like My Calendar label local times with bogus TZIDs).
 */
export function parseIcalDate(value: string, params: string): { millis: number; allDay: boolean } | null {
  const allDay = /VALUE=DATE(?!-TIME)/i.test(params) || /^\d{8}$/.test(value);
  const m = value.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return null;
  const [year, month, day] = [Number(m[1]), Number(m[2]), Number(m[3])];
  const hour = Number(m[4] ?? "0");
  const minute = Number(m[5] ?? "0");
  if (m[7] === "Z") return { millis: Date.UTC(year, month - 1, day, hour, minute), allDay };
  return { millis: localToUtcMillis({ year, month, day, hour, minute }), allDay };
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, "\n").replace(/\\,/g, ",").replace(/\\;/g, ";").replace(/\\\\/g, "\\").trim();
}

export function parseIcal(text: string): VEvent[] {
  const events: VEvent[] = [];
  let current: Partial<VEvent> & { exdates: number[] } | null = null;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      current = { exdates: [] };
      continue;
    }
    if (line === "END:VEVENT") {
      if (current?.summary && current.dtstart) events.push(current as VEvent);
      current = null;
      continue;
    }
    if (!current) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...paramParts] = head.split(";");
    const params = paramParts.join(";");
    switch (name!.toUpperCase()) {
      case "SUMMARY":
        current.summary = unescapeText(value);
        break;
      case "DTSTART":
        current.dtstart = parseIcalDate(value, params) ?? undefined;
        break;
      case "DTEND":
        current.dtend = parseIcalDate(value, params) ?? undefined;
        break;
      case "RRULE":
        current.rrule = Object.fromEntries(value.split(";").map((part) => part.split("=") as [string, string]));
        break;
      case "EXDATE":
        for (const v of value.split(",")) {
          const parsed = parseIcalDate(v, params);
          if (parsed) current.exdates.push(parsed.millis);
        }
        break;
      case "LOCATION":
        current.location = unescapeText(value) || undefined;
        break;
      case "URL":
        current.url = value.trim() || undefined;
        break;
      case "DESCRIPTION":
        current.description = unescapeText(value) || undefined;
        break;
      default:
        break;
    }
  }
  return events;
}

const BYDAY: Record<string, number> = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 };

/** Expand a VEVENT (with optional WEEKLY/DAILY RRULE) into concrete instances inside [rangeStart, rangeEnd). */
export function expandVEvent(ev: VEvent, rangeStart: Date, rangeEnd: Date): RawEvent[] {
  const duration = ev.dtend ? Math.max(0, ev.dtend.millis - ev.dtstart.millis) : ev.dtstart.allDay ? 86_400_000 : 3_600_000;
  const toRaw = (startMillis: number): RawEvent => ({
    title: ev.summary,
    start: formatIsoWithOffset(startMillis),
    end: formatIsoWithOffset(startMillis + duration),
    allDay: ev.dtstart.allDay,
    surface: ev.location,
    url: ev.url,
    description: ev.description,
  });
  const inRange = (ms: number) => ms >= rangeStart.getTime() && ms < rangeEnd.getTime();
  const excluded = (ms: number) => ev.exdates.some((ex) => Math.abs(ex - ms) < 86_400_000 && new Date(ex).getUTCDate() === new Date(ms).getUTCDate());

  if (!ev.rrule) return inRange(ev.dtstart.millis) ? [toRaw(ev.dtstart.millis)] : [];

  const freq = (ev.rrule.FREQ ?? "").toUpperCase();
  if (freq !== "WEEKLY" && freq !== "DAILY") return inRange(ev.dtstart.millis) ? [toRaw(ev.dtstart.millis)] : [];
  const interval = Number(ev.rrule.INTERVAL ?? "1") || 1;
  const until = ev.rrule.UNTIL ? parseIcalDate(ev.rrule.UNTIL, "")?.millis ?? Infinity : Infinity;
  const count = ev.rrule.COUNT ? Number(ev.rrule.COUNT) : Infinity;
  const byDay = ev.rrule.BYDAY ? ev.rrule.BYDAY.split(",").map((d) => BYDAY[d.slice(-2).toUpperCase()]).filter((d): d is number => d !== undefined) : null;

  const out: RawEvent[] = [];
  let emitted = 0;
  const stepMs = (freq === "WEEKLY" ? 7 : 1) * 86_400_000 * interval;
  const startDow = new Date(ev.dtstart.millis + 5 * 3_600_000).getUTCDay(); // shift avoids midnight-offset edge cases
  for (let base = ev.dtstart.millis; base <= until && base < rangeEnd.getTime() + 7 * 86_400_000 && emitted < count; base += stepMs) {
    const days = freq === "WEEKLY" && byDay ? byDay.map((d) => (d - startDow + 7) % 7) : [0];
    for (const offset of days.sort((a, b) => a - b)) {
      const instance = base + offset * 86_400_000;
      if (instance > until || emitted >= count) break;
      emitted++;
      if (excluded(instance)) continue;
      if (inRange(instance)) out.push(toRaw(instance));
    }
  }
  return out;
}

/** Generic iCal feed adapter (Daly Rink via WordPress My Calendar). */
export const icalAdapter: Adapter<"ical"> = async (_rink, source, ctx) => {
  const text = await fetchText(source.url, { headers: { Accept: "text/calendar, text/plain, */*" } });
  const vevents = parseIcal(text);
  const events = vevents.flatMap((ev) => expandVEvent(ev, ctx.rangeStart, ctx.rangeEnd));
  ctx.log(`ical: ${vevents.length} VEVENTs -> ${events.length} instances`);
  return events;
};
