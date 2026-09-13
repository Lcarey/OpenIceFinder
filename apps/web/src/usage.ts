import type { IceCategory, IceEvent, ProgramEvent, ProgramFeed } from "@openice/shared";

/** One thing happening on the ice: a rink calendar block, a program (team) block, or both merged. */
export interface UsageBlock {
  id: string;
  start: string;
  end: string;
  kind: "rink" | "program" | "merged";
  /** Rink calendar title (e.g. "AHC", "Public Skate") when known. */
  title: string;
  category?: IceCategory;
  /** Program short name (e.g. "AHC") when team detail exists. */
  programShortName?: string;
  /** Teams/groups on the ice, as published by the program. */
  teams: string[];
  eventType?: ProgramEvent["type"];
  opponent?: string;
  note?: string;
  url?: string;
  allDay?: boolean;
}

function overlaps(aStart: string, aEnd: string, bStart: string, bEnd: string): boolean {
  return new Date(aStart).getTime() < new Date(bEnd).getTime() && new Date(bStart).getTime() < new Date(aEnd).getTime();
}

function looksLikeProgramBlock(event: IceEvent, shortName: string, name: string): boolean {
  const title = event.title.toLowerCase();
  if (title.includes(shortName.toLowerCase()) || title.includes(name.toLowerCase())) return true;
  return event.category === "private_rental";
}

/**
 * Merge a rink's calendar with the program events that happen at that rink. Rink blocks that overlap a program
 * event (and look like that program's rental) absorb the team detail; program events with no matching rink block
 * are shown on their own so nothing the club published is lost.
 */
export function mergeUsage(rinkEvents: IceEvent[], programFeeds: ProgramFeed[]): UsageBlock[] {
  const blocks: UsageBlock[] = rinkEvents.map((e) => ({
    id: e.id,
    start: e.start,
    end: e.end,
    kind: "rink",
    title: e.title,
    category: e.category,
    teams: [],
    url: e.url,
    allDay: e.allDay,
  }));

  for (const feed of programFeeds) {
    const { shortName, name } = feed.program;
    for (const pe of feed.events) {
      if (!pe.atHomeRink) continue;
      const host = blocks.find(
        (b) => b.kind !== "program" && !b.allDay && overlaps(b.start, b.end, pe.start, pe.end) && (b.kind === "merged" ? b.programShortName === shortName : looksLikeProgramBlock(rinkEvents.find((e) => e.id === b.id)!, shortName, name)),
      );
      if (host) {
        host.kind = "merged";
        host.programShortName = shortName;
        for (const t of pe.teams) if (!host.teams.includes(t)) host.teams.push(t);
        host.eventType = host.eventType && host.eventType !== pe.type ? host.eventType : pe.type;
        if (pe.opponent) host.opponent = host.opponent ? `${host.opponent} / ${pe.opponent}` : pe.opponent;
        if (pe.note) host.note = host.note ? `${host.note} ${pe.note}` : pe.note;
        host.url = host.url ?? pe.url;
        // Track the program's own times when they extend beyond the rink block (e.g. 5:20–6:20 inside a 5–7 "AHC" block stays 5–7).
        continue;
      }
      blocks.push({
        id: `p-${pe.id}`,
        start: pe.start,
        end: pe.end,
        kind: "program",
        title: shortName,
        programShortName: shortName,
        teams: [...pe.teams],
        eventType: pe.type,
        opponent: pe.opponent,
        note: pe.note,
        url: pe.url,
      });
    }
  }

  blocks.sort((a, b) => a.start.localeCompare(b.start) || a.end.localeCompare(b.end));
  return blocks;
}

/** Program events at the home rink that fall inside a rink block, so a long "AHC" block can list its sub-slots in order. */
export function programSlotsWithin(block: UsageBlock, programFeeds: ProgramFeed[]): ProgramEvent[] {
  if (block.kind !== "merged") return [];
  return programFeeds
    .flatMap((f) => (f.program.shortName === block.programShortName ? f.events : []))
    .filter((pe) => pe.atHomeRink && overlaps(block.start, block.end, pe.start, pe.end))
    .sort((a, b) => a.start.localeCompare(b.start));
}
