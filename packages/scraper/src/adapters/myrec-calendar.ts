import { parseUsDateTime, toDateKey, type RawEvent } from "@openice/shared";
import { fetchText, formEncode } from "../http.js";
import type { Adapter } from "./types.js";

interface MyRecEvent {
  id: number;
  title: string;
  start: string;
  end: string;
  url?: string;
  allDay?: string | boolean;
}

export function parseMyRecCalendar(json: string, facilityUrl: string): RawEvent[] {
  const rows = JSON.parse(json) as MyRecEvent[];
  const out: RawEvent[] = [];
  for (const row of rows) {
    const allDay = String(row.allDay).toLowerCase() === "true";
    const start = parseUsDateTime(row.start);
    const end = parseUsDateTime(row.end);
    if (!start || !end) continue;
    const title = row.title.replace(/\\+'/g, "'").replace(/\\+"/g, '"').trim();
    if (!title) continue;
    out.push({ title, start, end: allDay && end <= start ? start : end, allDay, url: row.url || facilityUrl });
  }
  return out;
}

/**
 * myrec.com facility calendars (Arlington Ed Burns). FullCalendar posts a form
 * to CalWebService.asmx/GetCalendarPublic and gets a JSON array back.
 */
export const myrecCalendarAdapter: Adapter<"myrec-calendar"> = async (_rink, source, ctx) => {
  const base = source.baseUrl.replace(/\/$/, "");
  const endpoint = `${base}/info/calendar/CalWebService.asmx/GetCalendarPublic`;
  const facilityUrl = `${base}/info/calendar/default.aspx?FacilityID=${source.facilityId}&AreaID=${source.areaId ?? 0}`;
  const body = formEncode({
    SearchBy: "1",
    FacilityID: source.facilityId,
    AreaID: source.areaId ?? 0,
    FacilityTypeID: 0,
    AllowViewAll: false,
    ShowFacilities: false,
    EventType: "",
    Debug: false,
    start: toDateKey(ctx.rangeStart),
    end: toDateKey(ctx.rangeEnd),
  });
  const json = await fetchText(endpoint, {
    method: "POST",
    body,
    headers: { "Content-Type": "application/x-www-form-urlencoded; charset=UTF-8", Accept: "application/json, text/javascript, */*", Referer: facilityUrl },
  });
  return parseMyRecCalendar(json, facilityUrl);
};
