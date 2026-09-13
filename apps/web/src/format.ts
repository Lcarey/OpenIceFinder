import { RINK_TIME_ZONE, localDateKey } from "@openice/shared";

const timeFmt = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, hour: "numeric", minute: "2-digit" });
const weekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, weekday: "long" });
const shortWeekdayFmt = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, weekday: "short" });
const dayFmt = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, month: "short", day: "numeric" });
const monthFmt = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, month: "long", year: "numeric" });
const dateTimeFmt = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });

export function formatTime(iso: string | Date): string {
  return timeFmt.format(typeof iso === "string" ? new Date(iso) : iso).replace(":00", "").toLowerCase();
}

export function formatTimeRange(start: string, end: string): string {
  return `${formatTime(start)} – ${formatTime(end)}`;
}

export function formatDay(iso: string | Date): string {
  return dayFmt.format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatWeekday(iso: string | Date, short = false): string {
  return (short ? shortWeekdayFmt : weekdayFmt).format(typeof iso === "string" ? new Date(iso) : iso);
}

export function formatMonth(date: Date): string {
  return monthFmt.format(date);
}

export function formatDateTime(iso: string): string {
  return dateTimeFmt.format(new Date(iso));
}

export function formatRelativeFetched(iso: string, now = Date.now()): string {
  const minutes = Math.round((now - new Date(iso).getTime()) / 60_000);
  if (minutes < 1) return "just now";
  if (minutes < 60) return `${minutes} min ago`;
  const hours = Math.round(minutes / 60);
  if (hours < 36) return `${hours} h ago`;
  return `${Math.round(hours / 24)} d ago`;
}

export function dayLabel(dateKey: string, todayKey: string, tomorrowKey: string): string {
  const date = dateFromKey(dateKey);
  if (dateKey === todayKey) return `Today · ${formatWeekday(date, true)} ${formatDay(date)}`;
  if (dateKey === tomorrowKey) return `Tomorrow · ${formatWeekday(date, true)} ${formatDay(date)}`;
  return `${formatWeekday(date)} · ${formatDay(date)}`;
}

/** Noon UTC on that date; safe for display formatting in America/New_York. */
export function dateFromKey(dateKey: string): Date {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  return new Date(Date.UTC(y, m - 1, d, 16, 0, 0));
}

export function dateKeyOf(iso: string | Date): string {
  return localDateKey(iso);
}

export function shiftDateKey(dateKey: string, days: number): string {
  const [y, m, d] = dateKey.split("-").map(Number) as [number, number, number];
  const shifted = new Date(Date.UTC(y, m - 1, d + days));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-${String(shifted.getUTCDate()).padStart(2, "0")}`;
}

/** Sunday-first week containing dateKey. */
export function weekStartKey(dateKey: string): string {
  const date = dateFromKey(dateKey);
  return shiftDateKey(dateKey, -date.getUTCDay());
}

export function monthStartKey(dateKey: string): string {
  return `${dateKey.slice(0, 7)}-01`;
}

export function shiftMonth(dateKey: string, months: number): string {
  const [y, m] = dateKey.split("-").map(Number) as [number, number];
  const shifted = new Date(Date.UTC(y, m - 1 + months, 1));
  return `${shifted.getUTCFullYear()}-${String(shifted.getUTCMonth() + 1).padStart(2, "0")}-01`;
}

export function groupByDay<T extends { start: string }>(events: T[]): Array<{ dateKey: string; events: T[] }> {
  const map = new Map<string, T[]>();
  for (const e of events) {
    const key = dateKeyOf(e.start);
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return [...map.entries()].sort(([a], [b]) => a.localeCompare(b)).map(([dateKey, list]) => ({ dateKey, events: list }));
}

/** Minutes since local midnight, for positioning in the week grid. */
export function minutesIntoDay(iso: string): number {
  const date = new Date(iso);
  const parts = new Intl.DateTimeFormat("en-US", { timeZone: RINK_TIME_ZONE, hour: "numeric", minute: "numeric", hourCycle: "h23" }).formatToParts(date);
  const hour = Number(parts.find((p) => p.type === "hour")?.value ?? 0) % 24;
  const minute = Number(parts.find((p) => p.type === "minute")?.value ?? 0);
  return hour * 60 + minute;
}
