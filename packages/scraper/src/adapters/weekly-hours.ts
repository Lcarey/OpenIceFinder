import { localDateKey, localToIso, parseClock, parseDateOnly, type RawEvent, type WeeklyHoursSession } from "@openice/shared";
import type { Adapter } from "./types.js";

/** Massachusetts public-school vacation weeks for 2026–27 (DCR skips stick time on these days). */
export const MA_SCHOOL_BREAKS: Array<{ from: string; to: string }> = [
  { from: "2026-11-25", to: "2026-11-27" },
  { from: "2026-12-24", to: "2027-01-02" },
  { from: "2027-02-15", to: "2027-02-19" },
  { from: "2027-04-19", to: "2027-04-23" },
];

function pad(n: number): string {
  return String(n).padStart(2, "0");
}

function dateKey(year: number, month: number, day: number): string {
  return `${year}-${pad(month)}-${pad(day)}`;
}

function addCalendarDay(year: number, month: number, day: number): { year: number; month: number; day: number } {
  const next = new Date(Date.UTC(year, month - 1, day + 1));
  return { year: next.getUTCFullYear(), month: next.getUTCMonth() + 1, day: next.getUTCDate() };
}

function inBreak(key: string, breaks: Array<{ from: string; to: string }>): boolean {
  return breaks.some((b) => key >= b.from && key <= b.to);
}

export function expandWeeklyHours(
  sessions: WeeklyHoursSession[],
  rangeStart: Date,
  rangeEnd: Date,
  options: { seasonStart?: string; seasonEnd?: string; url?: string; schoolBreaks?: Array<{ from: string; to: string }> } = {},
): RawEvent[] {
  const startKey = options.seasonStart && options.seasonStart > localDateKey(rangeStart) ? options.seasonStart : localDateKey(rangeStart);
  const rangeEndKey = localDateKey(rangeEnd);
  let lastKey = rangeEndKey;
  if (options.seasonEnd) {
    const seasonEnd = parseDateOnly(options.seasonEnd);
    if (seasonEnd) {
      const exclusive = addCalendarDay(seasonEnd.year, seasonEnd.month, seasonEnd.day);
      const seasonEndExclusive = dateKey(exclusive.year, exclusive.month, exclusive.day);
      if (seasonEndExclusive < lastKey) lastKey = seasonEndExclusive;
    }
  }
  const breaks = options.schoolBreaks ?? MA_SCHOOL_BREAKS;
  const out: RawEvent[] = [];

  let cursor = parseDateOnly(startKey);
  if (!cursor) return out;
  while (dateKey(cursor.year, cursor.month, cursor.day) < lastKey) {
    const key = dateKey(cursor.year, cursor.month, cursor.day);
    const weekday = new Date(Date.UTC(cursor.year, cursor.month - 1, cursor.day)).getUTCDay();
    for (const session of sessions) {
      if (!session.days.includes(weekday)) continue;
      if (session.skipSchoolVacations && inBreak(key, breaks)) continue;
      const startClock = parseClock(session.start);
      const endClock = parseClock(session.end);
      if (!startClock || !endClock) continue;
      let end = localToIso({ ...cursor, ...endClock });
      const start = localToIso({ ...cursor, ...startClock });
      if (end <= start) {
        const next = addCalendarDay(cursor.year, cursor.month, cursor.day);
        end = localToIso({ ...next, ...endClock });
      }
      out.push({ title: session.title, start, end, url: options.url });
    }
    cursor = addCalendarDay(cursor.year, cursor.month, cursor.day);
  }
  return out;
}

export const weeklyHoursAdapter: Adapter<"weekly-hours"> = async (rink, source, ctx) => {
  return expandWeeklyHours(source.sessions, ctx.rangeStart, ctx.rangeEnd, {
    seasonStart: source.seasonStart,
    seasonEnd: source.seasonEnd,
    url: rink.scheduleUrl ?? rink.website,
  });
};
