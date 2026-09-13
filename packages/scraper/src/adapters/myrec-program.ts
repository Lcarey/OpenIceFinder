import { localToIso, parseClock, parseDateOnly, type RawEvent } from "@openice/shared";
import { decodeEntities, stripTags } from "../html.js";
import { fetchText } from "../http.js";
import type { Adapter } from "./types.js";

/**
 * Parse the activities table on a myrec.com program_details page. Each row has
 * data-title cells: Activity, Days, Date/Time (date, time range, location).
 */
export function parseMyRecProgram(html: string, pageUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  const rows = html.split(/<tr\b/i).slice(1);
  for (const rawRow of rows) {
    const row = `<tr${rawRow}`;
    const cell = (title: string) => {
      const match = row.match(new RegExp(`<td[^>]*data-title="${title}"[^>]*>([\\s\\S]*?)<\\/td>`, "i"));
      return match ? match[1]! : null;
    };
    const activityHtml = cell("Activity");
    const dateTimeHtml = cell("Date/Time");
    if (!activityHtml || !dateTimeHtml) continue;

    const title = stripTags(activityHtml.replace(/<b style="color: red;">[\s\S]*?<\/b>/i, ""));
    if (!title) continue;

    const dateTimeText = decodeEntities(dateTimeHtml.replace(/<br\s*\/?>/gi, "\n").replace(/<[^>]+>/g, " "))
      .split("\n")
      .map((line) => line.replace(/\s+/g, " ").trim())
      .filter(Boolean);
    const dateLine = dateTimeText.find((line) => /^\d{1,2}\/\d{1,2}\/\d{4}/.test(line));
    const timeLine = dateTimeText.find((line) => /\d{1,2}:\d{2}\s*[AP]M\s*-\s*\d{1,2}:\d{2}\s*[AP]M/i.test(line));
    const location = dateTimeText.find((line) => !/^\d/.test(line) && !/[AP]M/i.test(line));
    if (!dateLine || !timeLine) continue;

    const date = parseDateOnly(dateLine);
    const times = timeLine.match(/(\d{1,2}:\d{2}\s*[AP]M)\s*-\s*(\d{1,2}:\d{2}\s*[AP]M)/i);
    if (!date || !times) continue;
    const startClock = parseClock(times[1]!);
    const endClock = parseClock(times[2]!);
    if (!startClock || !endClock) continue;

    out.push({
      title,
      start: localToIso({ ...date, ...startClock }),
      end: localToIso({ ...date, ...endClock }),
      surface: location,
      url: pageUrl,
    });
  }
  return out;
}

/** myrec.com program detail pages with dated activity rows (Belmont Stick and Puck). */
export const myrecProgramAdapter: Adapter<"myrec-program"> = async (_rink, source, ctx) => {
  const base = source.baseUrl.replace(/\/$/, "");
  const events: RawEvent[] = [];
  for (const programId of source.programIds) {
    const url = `${base}/info/activities/program_details.aspx?ProgramID=${programId}`;
    const html = await fetchText(url);
    const parsed = parseMyRecProgram(html, url);
    ctx.log(`myrec-program ${programId}: ${parsed.length} rows`);
    events.push(...parsed);
  }
  return events.filter((e) => new Date(e.start) >= ctx.rangeStart && new Date(e.start) < ctx.rangeEnd);
};
