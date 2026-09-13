import { createHash } from "node:crypto";
import { localToIso, parseClock, parseDateOnly, type Program, type ProgramEvent, type ProgramEventType, type ProgramTeam } from "@openice/shared";
import { fetchText } from "../http.js";
import { decodeEntities, stripTags } from "../html.js";

export interface CrossbarContext {
  rangeStart: Date;
  rangeEnd: Date;
  log: (message: string) => void;
  /** Override the fetcher (tests). */
  fetch?: (url: string) => Promise<string>;
  concurrency?: number;
}

const TEAM_LINK = /href="\/team\/(\d+)"[^>]*>([\s\S]*?)<\/a>/g;
const ROW = /<tr eid="(\d+)">([\s\S]*?)<\/tr>/g;
const CELL = /<td[^>]*>([\s\S]*?)<\/td>/g;
const NOTE = /title="([^"]*)"/;

function clean(html: string): string {
  return decodeEntities(stripTags(html)).replace(/\s+/g, " ").trim();
}

/** Team ids and names linked anywhere on the club site's home page (nav + season listings). */
export function parseCrossbarTeams(html: string, baseUrl: string): ProgramTeam[] {
  const teams = new Map<string, ProgramTeam>();
  for (const match of html.matchAll(TEAM_LINK)) {
    const id = match[1]!;
    const name = clean(match[2]!);
    if (!name || teams.has(id)) continue;
    teams.set(id, { id, name, url: `${baseUrl}/team/${id}/calendar` });
  }
  return [...teams.values()];
}

export interface CrossbarRow {
  eid: string;
  team: string;
  date: { year: number; month: number; day: number };
  from: { hour: number; minute: number };
  to: { hour: number; minute: number };
  type: ProgramEventType;
  location: string;
  /** "Opponent / Sharing With" column split on commas; "@ Foo" / "vs. Foo" kept whole. */
  others: string[];
  opponent?: string;
  note?: string;
}

function eventType(text: string): ProgramEventType {
  const t = text.toLowerCase();
  if (t.includes("practice")) return "practice";
  if (t.includes("game") || t.includes("scrimmage")) return "game";
  if (t.includes("meeting")) return "meeting";
  return "other";
}

/** Team name as shown in the page's `<h1>`; Crossbar double-spaces some names. */
export function parseCrossbarTeamName(html: string): string | undefined {
  const m = html.match(/<h1[^>]*>([\s\S]*?)<\/h1>/);
  return m ? clean(m[1]!) : undefined;
}

/** Rows of a team's `/team/<id>/schedule` list view. */
export function parseCrossbarSchedule(html: string, teamName: string): CrossbarRow[] {
  const rows: CrossbarRow[] = [];
  for (const match of html.matchAll(ROW)) {
    const eid = match[1]!;
    const cellsHtml = [...match[2]!.matchAll(CELL)].map((c) => c[1]!);
    if (cellsHtml.length < 7) continue;
    const cells = cellsHtml.map(clean);
    const date = parseDateOnly(cells[1]!);
    const from = parseClock(cells[2]!);
    const to = parseClock(cells[3]!);
    if (!date || !from || !to) continue;
    const note = cellsHtml[0]!.match(NOTE)?.[1];
    const sharing = cells[6]!;
    let opponent: string | undefined;
    const others: string[] = [];
    if (/^(@|vs\.?)\s/i.test(sharing)) {
      opponent = sharing.replace(/^vs\.?\s+/i, "vs. ").replace(/^@\s+/, "@ ");
    } else if (sharing) {
      others.push(...sharing.split(/\s*,\s*/).filter(Boolean));
    }
    rows.push({ eid, team: teamName, date, from, to, type: eventType(cells[4]!), location: cells[5]!, others, opponent, note: note ? decodeEntities(note) : undefined });
  }
  return rows;
}

function slotKey(row: CrossbarRow): string {
  const d = row.date;
  return `${d.year}-${d.month}-${d.day}|${row.from.hour}:${row.from.minute}|${row.to.hour}:${row.to.minute}|${row.location.toLowerCase()}`;
}

/**
 * Every team publishes its own copy of a shared slot, so collapse rows with the same date, time, and location
 * into one event whose `teams` is the union of the row owners and their "sharing with" entries.
 */
export function mergeCrossbarRows(rows: CrossbarRow[], program: Program, teams: ProgramTeam[]): ProgramEvent[] {
  const home = new RegExp(program.source.homeLocationPattern, "i");
  const byName = new Map(teams.map((t) => [t.name.toLowerCase(), t.id]));
  const merged = new Map<string, { row: CrossbarRow; names: Set<string>; eids: string[]; opponents: Set<string>; notes: Set<string> }>();
  for (const row of rows) {
    const key = slotKey(row);
    const slot = merged.get(key) ?? { row, names: new Set<string>(), eids: [], opponents: new Set<string>(), notes: new Set<string>() };
    slot.names.add(row.team);
    for (const other of row.others) slot.names.add(other);
    slot.eids.push(row.eid);
    if (row.opponent) slot.opponents.add(row.opponent);
    if (row.note) slot.notes.add(row.note);
    merged.set(key, slot);
  }
  const events: ProgramEvent[] = [];
  for (const slot of merged.values()) {
    const { row } = slot;
    const start = localToIso({ ...row.date, ...row.from });
    let end = localToIso({ ...row.date, ...row.to });
    if (end <= start) end = localToIso({ ...row.date, hour: row.to.hour + 24, minute: row.to.minute });
    const names = [...slot.names].sort((a, b) => a.localeCompare(b));
    const teamIds = names.map((n) => byName.get(n.toLowerCase())).filter((id): id is string => Boolean(id));
    const primaryTeam = teamIds[0] ?? teams.find((t) => t.name === row.team)?.id;
    const id = createHash("sha1").update(`${program.id}|${start}|${end}|${row.location}`).digest("hex").slice(0, 12);
    events.push({
      id,
      type: row.type,
      start,
      end,
      location: row.location,
      atHomeRink: home.test(row.location),
      teams: names,
      teamIds,
      opponent: slot.opponents.size ? [...slot.opponents].join(" / ") : undefined,
      note: slot.notes.size ? [...slot.notes].join(" ") : undefined,
      url: primaryTeam ? `${program.source.baseUrl}/team/${primaryTeam}/calendar` : program.website,
    });
  }
  events.sort((a, b) => a.start.localeCompare(b.start) || a.location.localeCompare(b.location));
  return events;
}

async function mapWithConcurrency<T, R>(items: T[], limit: number, fn: (item: T) => Promise<R>): Promise<R[]> {
  const results: R[] = new Array(items.length);
  let next = 0;
  await Promise.all(
    Array.from({ length: Math.min(limit, items.length) }, async () => {
      while (next < items.length) {
        const idx = next++;
        results[idx] = await fn(items[idx]!);
      }
    }),
  );
  return results;
}

/** Scrape every team's schedule on a Crossbar club site and merge shared slots. */
export async function fetchCrossbarProgram(program: Program, ctx: CrossbarContext): Promise<{ teams: ProgramTeam[]; events: ProgramEvent[]; errors: string[]; failedTeamIds: string[] }> {
  // Crossbar returns sporadic 502s under concurrent load; go slow and retry patiently.
  const get = ctx.fetch ?? ((url: string) => fetchText(url, { retries: 5 }));
  const { baseUrl } = program.source;
  const teams = parseCrossbarTeams(await get(`${baseUrl}/`), baseUrl);
  if (teams.length === 0) throw new Error("crossbar: no team links found on the club home page");
  ctx.log(`crossbar: ${teams.length} teams`);

  const errors: string[] = [];
  const failedTeamIds: string[] = [];
  const rowsPerTeam = await mapWithConcurrency(teams, ctx.concurrency ?? 1, async (team) => {
    try {
      const html = await get(`${baseUrl}/team/${team.id}/schedule`);
      const name = parseCrossbarTeamName(html) ?? team.name;
      if (name !== team.name) team.name = name;
      return parseCrossbarSchedule(html, name);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      ctx.log(`crossbar: ${team.name} failed: ${message}`);
      errors.push(`${team.name}: ${message}`);
      failedTeamIds.push(team.id);
      return [];
    }
  });

  const startMs = ctx.rangeStart.getTime();
  const endMs = ctx.rangeEnd.getTime();
  const events = mergeCrossbarRows(rowsPerTeam.flat(), program, teams).filter((e) => {
    const s = new Date(e.start).getTime();
    return s >= startMs && s < endMs;
  });
  return { teams, events, errors, failedTeamIds };
}
