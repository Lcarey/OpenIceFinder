import { localToIso, type RawEvent } from "@openice/shared";
import { fetchText } from "../http.js";
import type { Adapter } from "./types.js";

interface FinnlyEvent {
  EventId: number;
  EventStartTime: string;
  EventEndTime: string;
  FacilityName?: string;
  EventTypeName?: string;
  SubEventTypeName?: string | null;
  AccountName?: string | null;
  Description?: string | null;
  ShowAccount?: boolean;
  Closed?: boolean;
}

/** Local "2026-09-08T16:00:00" (no zone) -> ISO with the rink's offset. */
function localIsoFromNaive(text: string): string | null {
  const m = text.match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2})/);
  if (!m) return null;
  return localToIso({ year: Number(m[1]), month: Number(m[2]), day: Number(m[3]), hour: Number(m[4]), minute: Number(m[5]) });
}

/** Pull the `_onlineScheduleList = [...]` JSON array out of the inline script. */
export function extractFinnlySchedule(html: string): FinnlyEvent[] {
  const marker = html.indexOf("_onlineScheduleList = ");
  if (marker < 0) return [];
  const start = html.indexOf("[", marker);
  if (start < 0) return [];
  // Find the matching closing bracket, honouring strings.
  let depth = 0;
  let inString = false;
  for (let i = start; i < html.length; i++) {
    const ch = html[i]!;
    if (inString) {
      if (ch === "\\") i++;
      else if (ch === '"') inString = false;
      continue;
    }
    if (ch === '"') inString = true;
    else if (ch === "[") depth++;
    else if (ch === "]") {
      depth--;
      if (depth === 0) return JSON.parse(html.slice(start, i + 1)) as FinnlyEvent[];
    }
  }
  return [];
}

export function parseFinnly(html: string, pageUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  for (const ev of extractFinnlySchedule(html)) {
    const type = (ev.EventTypeName ?? "").trim();
    if (!type || type === "Conflict") continue;
    const start = localIsoFromNaive(ev.EventStartTime);
    const end = localIsoFromNaive(ev.EventEndTime);
    if (!start || !end) continue;
    const account = ev.ShowAccount && ev.AccountName ? ev.AccountName.trim() : "";
    const sub = (ev.SubEventTypeName ?? "").trim();
    const title = [type, sub && sub !== type ? sub : "", account && account !== type ? account : ""].filter(Boolean).join(" - ");
    out.push({ title, start, end, surface: ev.FacilityName?.trim() || undefined, url: pageUrl, description: ev.Description?.trim() || undefined });
  }
  return out;
}

/** Finnly Connect facility schedules (Warrior Ice Arena). Data is inlined in the HTML. */
export const finnlyAdapter: Adapter<"finnly"> = async (_rink, source, ctx) => {
  const base = source.baseUrl.replace(/\/$/, "");
  const events: RawEvent[] = [];
  for (const scheduleId of source.scheduleIds) {
    const url = `${base}/schedule/${scheduleId}`;
    const html = await fetchText(url);
    const parsed = parseFinnly(html, url);
    ctx.log(`finnly schedule ${scheduleId}: ${parsed.length} events`);
    events.push(...parsed);
  }
  return events.filter((e) => new Date(e.start) >= ctx.rangeStart && new Date(e.start) < ctx.rangeEnd);
};
