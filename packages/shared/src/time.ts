export const RINK_TIME_ZONE = "America/New_York";

const dtfCache = new Map<string, Intl.DateTimeFormat>();

function partsFormatter(timeZone: string): Intl.DateTimeFormat {
  let dtf = dtfCache.get(timeZone);
  if (!dtf) {
    dtf = new Intl.DateTimeFormat("en-US", {
      timeZone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    });
    dtfCache.set(timeZone, dtf);
  }
  return dtf;
}

/** Offset (minutes east of UTC) of `timeZone` at the given UTC instant. */
export function offsetMinutesAt(utcMillis: number, timeZone = RINK_TIME_ZONE): number {
  const parts = partsFormatter(timeZone).formatToParts(new Date(utcMillis));
  const get = (type: string) => Number(parts.find((p) => p.type === type)?.value ?? "0");
  const asUtc = Date.UTC(get("year"), get("month") - 1, get("day"), get("hour") % 24, get("minute"), get("second"));
  return Math.round((asUtc - utcMillis) / 60_000);
}

export interface LocalDateTime {
  year: number;
  month: number; // 1-12
  day: number;
  hour: number; // 0-23
  minute: number;
}

/** Convert a wall-clock time in `timeZone` to a UTC epoch millisecond value. */
export function localToUtcMillis(local: LocalDateTime, timeZone = RINK_TIME_ZONE): number {
  const guess = Date.UTC(local.year, local.month - 1, local.day, local.hour, local.minute, 0);
  let offset = offsetMinutesAt(guess, timeZone);
  let utc = guess - offset * 60_000;
  // Re-check in case the guess straddled a DST transition.
  const offset2 = offsetMinutesAt(utc, timeZone);
  if (offset2 !== offset) {
    offset = offset2;
    utc = guess - offset * 60_000;
  }
  return utc;
}

function pad(n: number, width = 2): string {
  return String(n).padStart(width, "0");
}

/** Format a UTC instant as ISO 8601 with the zone's offset, e.g. 2026-09-15T14:00:00-04:00. */
export function formatIsoWithOffset(utcMillis: number, timeZone = RINK_TIME_ZONE): string {
  const offset = offsetMinutesAt(utcMillis, timeZone);
  const shifted = new Date(utcMillis + offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return (
    `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}` +
    `T${pad(shifted.getUTCHours())}:${pad(shifted.getUTCMinutes())}:${pad(shifted.getUTCSeconds())}` +
    `${sign}${pad(Math.floor(abs / 60))}:${pad(abs % 60)}`
  );
}

/** Wall-clock time in `timeZone` -> ISO string with offset. */
export function localToIso(local: LocalDateTime, timeZone = RINK_TIME_ZONE): string {
  return formatIsoWithOffset(localToUtcMillis(local, timeZone), timeZone);
}

/** Parse "h:mm AM", "2:00P", "14:00", "3PM" into 24h hour/minute. */
export function parseClock(text: string): { hour: number; minute: number } | null {
  const m = text.trim().match(/^(\d{1,2})(?::(\d{2}))?(?::\d{2})?\s*([AaPp])?\.?[Mm]?\.?$/);
  if (!m) return null;
  let hour = Number(m[1]);
  const minute = Number(m[2] ?? "0");
  const meridiem = m[3]?.toLowerCase();
  if (meridiem === "p" && hour < 12) hour += 12;
  if (meridiem === "a" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

const MONTHS: Record<string, number> = {
  jan: 1, feb: 2, mar: 3, apr: 4, may: 5, jun: 6, jul: 7, aug: 8, sep: 9, sept: 9, oct: 10, nov: 11, dec: 12,
};

/** Parse "Sep 15 2026", "9/15/2026", "2026-09-15", "09/15/2026" into y/m/d. */
export function parseDateOnly(text: string): { year: number; month: number; day: number } | null {
  const t = text.trim();
  let m = t.match(/^(\d{4})-(\d{1,2})-(\d{1,2})/);
  if (m) return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (m) return { year: Number(m[3]), month: Number(m[1]), day: Number(m[2]) };
  m = t.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2})$/);
  if (m) {
    const yy = Number(m[3]);
    return { year: yy < 70 ? 2000 + yy : 1900 + yy, month: Number(m[1]), day: Number(m[2]) };
  }
  m = t.match(/^([A-Za-z]{3,9})\.?\s+(\d{1,2}),?\s+(\d{4})/);
  if (m) {
    const month = MONTHS[m[1]!.slice(0, 3).toLowerCase()];
    if (!month) return null;
    return { year: Number(m[3]), month, day: Number(m[2]) };
  }
  return null;
}

/** Parse myrec's "9/15/2026 2:00:00 PM" style timestamps as rink-local time. */
export function parseUsDateTime(text: string, timeZone = RINK_TIME_ZONE): string | null {
  const m = text.trim().match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})\s+(\d{1,2}):(\d{2})(?::(\d{2}))?\s*([AaPp][Mm])?$/);
  if (!m) return null;
  const clock = parseClock(`${m[4]}:${m[5]} ${m[7] ?? ""}`);
  if (!clock) return null;
  return localToIso({ year: Number(m[3]), month: Number(m[1]), day: Number(m[2]), ...clock }, timeZone);
}

/** Date-only key (YYYY-MM-DD) for an instant in the rink's zone. */
export function localDateKey(iso: string | number | Date, timeZone = RINK_TIME_ZONE): string {
  const millis = typeof iso === "number" ? iso : new Date(iso).getTime();
  const offset = offsetMinutesAt(millis, timeZone);
  const shifted = new Date(millis + offset * 60_000);
  return `${shifted.getUTCFullYear()}-${pad(shifted.getUTCMonth() + 1)}-${pad(shifted.getUTCDate())}`;
}

export function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

export function toDateKey(date: Date): string {
  return `${date.getUTCFullYear()}-${pad(date.getUTCMonth() + 1)}-${pad(date.getUTCDate())}`;
}
