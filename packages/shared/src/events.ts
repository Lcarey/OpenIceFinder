import type { IceEvent, RawEvent } from "./types.js";

/** Stable id from rink, start, and title so repeated refreshes produce the same ids. */
export function eventId(rinkId: string, event: Pick<RawEvent, "title" | "start" | "end">): string {
  const key = `${rinkId}|${event.start}|${event.end}|${event.title.toLowerCase()}`;
  let hash = 2166136261;
  for (let i = 0; i < key.length; i++) {
    hash ^= key.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return `${rinkId}-${(hash >>> 0).toString(36)}`;
}

/** Drop duplicate (start,end,title) rows, sort chronologically. */
export function dedupeAndSort<T extends RawEvent>(events: T[]): T[] {
  const seen = new Set<string>();
  const out: T[] = [];
  for (const e of events) {
    const key = `${e.start}|${e.end}|${e.title.toLowerCase()}|${e.surface ?? ""}`;
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(e);
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

export function eventsBetween<T extends IceEvent>(events: T[], startIso: string, endIso: string): T[] {
  const start = new Date(startIso).getTime();
  const end = new Date(endIso).getTime();
  return events.filter((e) => {
    const s = new Date(e.start).getTime();
    return s >= start && s < end;
  });
}
