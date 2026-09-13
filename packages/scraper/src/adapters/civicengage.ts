import { localToIso, parseClock, type RawEvent } from "@openice/shared";
import { decodeEntities, stripTags } from "../html.js";
import { fetchText } from "../http.js";
import type { Adapter } from "./types.js";

/**
 * Parse a CivicEngage (CivicPlus) `calendar.aspx?view=list` page. Each `<li>` has an
 * `<h3>` title, a `.date` line like "September 14, 2026, 10:00 AM - 11:45 AM" and a
 * hidden schema.org `startDate`.
 */
export function parseCivicEngageList(html: string, baseUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const item of html.matchAll(/<li>([\s\S]*?)<\/li>/gi)) {
    const li = item[1]!;
    const startMatch = li.match(/itemprop="startDate"[^>]*>(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/i);
    if (!startMatch) continue;
    const titleMatch = li.match(/<h3>[\s\S]*?<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? stripTags(titleMatch[1]!) : "";
    if (!title) continue;
    const date = { year: Number(startMatch[1]), month: Number(startMatch[2]), day: Number(startMatch[3]) };
    const startClock = { hour: Number(startMatch[4]), minute: Number(startMatch[5]) };

    const dateLine = li.match(/<div class="date">([\s\S]*?)<\/div>/i);
    const dateText = dateLine ? decodeEntities(stripTags(dateLine[1]!)) : "";
    const endMatch = dateText.match(/-\s*(\d{1,2}:\d{2}\s*[AP]M)\s*$/i);
    const endClock = endMatch ? parseClock(endMatch[1]!) : null;
    const start = localToIso({ ...date, ...startClock });
    const end = endClock ? localToIso({ ...date, ...endClock }) : localToIso({ ...date, hour: startClock.hour + 1, minute: startClock.minute });

    const hrefMatch = li.match(/href="(\/Calendar\.aspx\?EID=\d+[^"]*)"/i);
    const url = hrefMatch ? new URL(decodeEntities(hrefMatch[1]!), baseUrl).toString() : undefined;
    const descMatch = li.match(/itemprop="description">([\s\S]*?)<\/p>/i);
    out.push({ title, start, end: end > start ? end : start, url, description: descMatch ? stripTags(descMatch[1]!).slice(0, 500) : undefined });
  }
  return out;
}

/** CivicEngage municipal calendars (Stoneham Arena, CID=26). */
export const civicEngageAdapter: Adapter<"civicengage"> = async (_rink, source, ctx) => {
  const base = source.baseUrl.replace(/\/$/, "");
  const url = `${base}/calendar.aspx?view=list&CID=${source.calendarId}`;
  const html = await fetchText(url);
  const events = parseCivicEngageList(html, base);
  ctx.log(`civicengage CID=${source.calendarId}: ${events.length} events`);
  return events.filter((e) => new Date(e.start) >= ctx.rangeStart && new Date(e.start) < ctx.rangeEnd);
};
