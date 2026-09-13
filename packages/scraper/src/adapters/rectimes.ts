import { formatIsoWithOffset, localToUtcMillis, toDateKey, type RawEvent } from "@openice/shared";
import { fetchJson } from "../http.js";
import type { Adapter } from "./types.js";

type Loose = Record<string, unknown>;

function pickString(obj: Loose, keys: string[]): string | undefined {
  for (const key of keys) {
    const value = obj[key];
    if (typeof value === "string" && value.trim()) return value.trim();
  }
  return undefined;
}

/** RecTimes returns local-looking timestamps with a Z suffix; treat them as rink-local wall-clock. */
function parseRecTimesTimestamp(text: string): string | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return formatIsoWithOffset(localToUtcMillis({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) }));
}

export function parseRecTimesBookings(rows: unknown, scheduleUrl?: string): RawEvent[] {
  if (!Array.isArray(rows)) return [];
  const out: RawEvent[] = [];
  for (const row of rows as Loose[]) {
    const startText = pickString(row, ["startTimeLocal", "startTime", "start", "startDateTime"]);
    const endText = pickString(row, ["endTimeLocal", "endTime", "end", "endDateTime"]);
    if (!startText || !endText) continue;
    const start = parseRecTimesTimestamp(startText);
    const end = parseRecTimesTimestamp(endText);
    if (!start || !end) continue;
    const title =
      pickString(row, ["title", "name", "eventName", "bookingName", "activityName", "description", "customerName", "userName", "organizationName", "type", "bookingType"]) ??
      "Booked ice";
    out.push({ title, start, end, surface: pickString(row, ["venueName", "venue"]), url: scheduleUrl });
  }
  return out;
}

/** RecTimes facility calendars (John A. Ryan Arena, Watertown). */
export const recTimesAdapter: Adapter<"rectimes"> = async (rink, source, ctx) => {
  const base = source.apiBaseUrl.replace(/\/$/, "");
  const url = `${base}/api/v1/facilities/${encodeURIComponent(source.facility)}/bookings/get_for_calendar`;
  const body = JSON.stringify({
    venueIds: source.venueIds,
    startTimeLocal: `${toDateKey(ctx.rangeStart)}T00:00:00Z`,
    endTimeLocal: `${toDateKey(ctx.rangeEnd)}T00:00:00Z`,
  });
  const rows = await fetchJson<unknown>(url, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/json", Origin: "https://app.rectimes.com", Referer: `https://app.rectimes.com/${source.facility}` },
  });
  const events = parseRecTimesBookings(rows, rink.scheduleUrl);
  ctx.log(`rectimes ${source.facility}: ${events.length} bookings`);
  return events;
};
