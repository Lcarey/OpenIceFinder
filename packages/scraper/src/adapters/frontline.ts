import { localToIso, parseClock, parseDateOnly, type RawEvent } from "@openice/shared";
import { decodeEntities, stripTags } from "../html.js";
import { fetchText } from "../http.js";
import type { Adapter } from "./types.js";

/**
 * Parse a frontline-connect monthlysched.cfm page. Each day is a
 * `<td valign="top" id="NNN">` cell with a hidden `Mon DD YYYY` span, an
 * optional `<strong>SURFACE</strong>` and `sessdiv` blocks of `H:MM AM - H:MM PM`.
 */
export function parseFrontlineMonth(html: string, title: string, pageUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  const cellRegex = /<td[^>]*valign="top"[^>]*id="\d+"[^>]*>([\s\S]*?)<\/td>/gi;
  for (const match of html.matchAll(cellRegex)) {
    const cell = match[1]!;
    const dateMatch = cell.match(/id="spandt\d+">([^<]+)</i);
    if (!dateMatch) continue;
    const date = parseDateOnly(decodeEntities(dateMatch[1]!));
    if (!date) continue;

    const surfaceMatch = cell.match(/<div class="surfdiv[^"]*">\s*<strong>([^<]*)<\/strong>/i);
    const surface = surfaceMatch ? stripTags(surfaceMatch[1]!) : undefined;

    for (const sess of cell.matchAll(/<div class="sessdiv[^"]*">([\s\S]*?)<\/div>/gi)) {
      const text = stripTags(sess[1]!);
      const times = text.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
      if (!times) continue;
      const startClock = parseClock(times[1]!);
      const endClock = parseClock(times[2]!);
      if (!startClock || !endClock) continue;
      out.push({
        title,
        start: localToIso({ ...date, ...startClock }),
        end: localToIso({ ...date, ...endClock }),
        surface,
        url: pageUrl,
      });
    }
  }
  return out;
}

function monthsInRange(start: Date, end: Date): Array<{ month: number; year: number }> {
  const months: Array<{ month: number; year: number }> = [];
  const cursor = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth(), 1));
  while (cursor < end) {
    months.push({ month: cursor.getUTCMonth() + 1, year: cursor.getUTCFullYear() });
    cursor.setUTCMonth(cursor.getUTCMonth() + 1);
  }
  return months;
}

/** frontline-connect monthly schedules (Flynn Rink). One request per session per month. */
export const frontlineAdapter: Adapter<"frontline"> = async (_rink, source, ctx) => {
  const base = source.baseUrl.replace(/\/$/, "");
  const events: RawEvent[] = [];
  for (const [sessionId, label] of Object.entries(source.sessions)) {
    for (const { month, year } of monthsInRange(ctx.rangeStart, ctx.rangeEnd)) {
      const url = `${base}/monthlysched.cfm?fac=${encodeURIComponent(source.fac)}&facid=${source.facId}&session=${sessionId}&month=${month}&year=${year}`;
      const html = await fetchText(url);
      const parsed = parseFrontlineMonth(html, label, url);
      ctx.log(`frontline session ${sessionId} ${year}-${month}: ${parsed.length} sessions`);
      events.push(...parsed);
    }
  }
  return events.filter((e) => new Date(e.start) >= ctx.rangeStart && new Date(e.start) < ctx.rangeEnd);
};
