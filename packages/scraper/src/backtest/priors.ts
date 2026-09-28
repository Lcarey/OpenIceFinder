/**
 * Pre-season priors: last season's strength for this season's teams.
 *
 * Two sources, both in goals per game so they can seed a margin rating directly:
 *  - Elite 9: last season's final Massey rating for the same program, birth year and level.
 *  - MyHockeyRankings: last season's MHR rating. MHR ratings are built so that a rating gap is an expected goal gap.
 * Each prior is centered within the team's current division, because only differences inside a division matter
 * and teams move between tiers from one season to the next.
 */
import { birthYear, History, type BtGame } from "./games.js";
import { masseyRatings } from "./ratings.js";

export interface TeamIdentity {
  id: string;
  name: string;
  division: string;
  birthYear: string;
  program: string;
  level: string;
}

const LEVEL_WORDS: Record<string, string> = { e: "elite", s: "select", elite: "elite", select: "select", aaa: "elite" };

export function normalizeLevel(raw: string): string {
  const words = raw
    .toLowerCase()
    .replace(/[#().]/g, " ")
    .split(/\s+/)
    .filter(Boolean);
  if (!words.length) return "";
  const head = LEVEL_WORDS[words[0]!] ?? words[0]!;
  const num = words.slice(1).find((w) => /^\d+$/.test(w));
  return num && num !== "1" ? `${head} ${num}` : head;
}

function programWords(raw: string): string[] {
  return raw
    .toLowerCase()
    .replace(/\bjunior\b/g, "jr")
    .replace(/\bvt\b/g, "vermont")
    .replace(/\bnh\b/g, "new hampshire")
    .replace(/[^a-z0-9 ]+/g, " ")
    .split(/\s+/)
    .filter((w) => w && !/^\d+u$/.test(w) && w !== "aaa" && w !== "aa");
}

/** "Jr. Rangers 16 - E 2" or "Casco Bay U14H - Elite" → program + level. */
export function parseE9Name(name: string): { program: string; level: string } {
  const m = name.match(/^(.*?)\s+(?:\d{2}|U\d{2}[A-Z]?)\s*-\s*(.+)$/);
  if (!m) return { program: programWords(name).join(" "), level: "" };
  return { program: programWords(m[1]!).join(" "), level: normalizeLevel(m[2]!) };
}

/** "Worcester Jr Railers (Select #1) 9U AAA" → program words + level. Unknown tags like "(BHL)" mean no level. */
export function parseMhrName(name: string): { words: string[]; level: string } {
  const paren = name.match(/\(([^)]*)\)/);
  const base = name.replace(/\([^)]*\)/g, " ");
  const tagged = paren ? normalizeLevel(paren[1]!) : "";
  return { words: programWords(base), level: /^(elite|select)/.test(tagged) ? tagged : "elite" };
}

/** Elite 9 programs whose short name also matches clubs elsewhere on MHR. */
const MHR_PROGRAM_ALIASES: Record<string, string> = {
  "jr rangers": "boston jr rangers",
  americans: "boston americans",
  express: "walpole express",
  "ne knights": "new england knights",
  saints: "rhode island saints",
  "giants west": "95 giants",
  "giants east": "95 giants east",
};

/** One identity per team id; prefers the longest name seen (e.g. "Elite" over "E"). */
export function identities(games: BtGame[]): Map<string, TeamIdentity> {
  const out = new Map<string, TeamIdentity>();
  const add = (id: string, name: string, division: string) => {
    const cur = out.get(id);
    if (cur && cur.name.length >= name.length) return;
    const parsed = parseE9Name(name);
    out.set(id, { id, name, division: division || cur?.division || "", birthYear: birthYear(division || cur?.division || ""), ...parsed });
  };
  for (const g of games) {
    add(g.homeId, g.homeName, g.homeDiv);
    add(g.awayId, g.awayName, g.awayDiv);
  }
  return out;
}

function levelsMatch(a: string, b: string): boolean {
  return a === b || (a.startsWith("elite") && b.startsWith("elite") && (a === "elite" || b === "elite"));
}

/** Map each current team to at most one previous-season team with the same program and birth year. */
export function matchTeams(prev: Map<string, TeamIdentity>, cur: Map<string, TeamIdentity>): Map<string, string> {
  const out = new Map<string, string>();
  for (const team of cur.values()) {
    const same = [...prev.values()].filter((p) => p.birthYear === team.birthYear && p.program === team.program);
    const exact = same.filter((p) => p.level === team.level);
    const pick = exact.length === 1 ? exact[0] : same.length === 1 && levelsMatch(same[0]!.level, team.level) ? same[0] : undefined;
    if (pick) out.set(team.id, pick.id);
  }
  return out;
}

export interface MhrTeam {
  mhrId: number | null;
  state?: string;
  name: string;
  record: string;
  rating: number | null;
}

export interface MhrSnapshot {
  mhrYear: number;
  season: string;
  divisions: Array<{ label: string; age: number; teams: MhrTeam[] }>;
}

/** MHR's age label is season start year minus birth year. */
export function mhrAgeFor(birth: string, mhrYear: number): number {
  return mhrYear - Number(birth);
}

/** Age label from an MHR team name ("… 9U AAA"), falling back to its list's age. */
function mhrTeamAge(name: string, listAge: number): number {
  const m = name.match(/\b(\d{1,2})U\b/);
  return m ? Number(m[1]) : listAge;
}

/** Merge several MHR snapshots for one season, deduped by MHR id (first wins). */
export function mergeMhr(...snaps: Array<MhrSnapshot | undefined>): MhrSnapshot | undefined {
  const list = snaps.filter((s): s is MhrSnapshot => Boolean(s));
  if (!list.length) return undefined;
  const seen = new Set<string>();
  const divisions = list.flatMap((snap) =>
    snap.divisions.map((d) => ({
      ...d,
      teams: d.teams.filter((t) => {
        const key = t.mhrId != null ? String(t.mhrId) : t.name;
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }),
    })),
  );
  return { mhrYear: list[0]!.mhrYear, season: list[0]!.season, divisions };
}

export function matchMhr(team: TeamIdentity, mhr: MhrSnapshot): MhrTeam | undefined {
  const age = mhrAgeFor(team.birthYear, mhr.mhrYear);
  const words = (MHR_PROGRAM_ALIASES[team.program] ?? team.program).split(" ").filter(Boolean);
  if (!words.length) return undefined;
  const pool = mhr.divisions
    .flatMap((d) => d.teams.map((t) => ({ t, age: mhrTeamAge(t.name, d.age) })))
    .filter((x) => x.age === age && x.t.rating != null && x.t.rating > 0 && x.t.state !== "NY")
    .map((x) => x.t);
  const aaa = pool.filter((t) => /\bAAA\b/.test(t.name));
  const candidates = (aaa.length ? aaa : pool)
    .filter((t) => {
      const parsed = parseMhrName(t.name);
      return words.every((w) => parsed.words.includes(w));
    });
  const exact = candidates.filter((t) => parseMhrName(t.name).level === team.level);
  if (exact.length === 1) return exact[0];
  if (candidates.length === 1 && levelsMatch(parseMhrName(candidates[0]!.name).level, team.level)) return candidates[0];
  return undefined;
}

export interface TeamPrior {
  /** Last season's Elite 9 Massey rating, centered in the current division. */
  e9?: number;
  /** Last season's MHR rating, centered in the current division. */
  mhr?: number;
}

function centerByDivision(values: Map<string, number>, cur: Map<string, TeamIdentity>): Map<string, number> {
  const byDiv = new Map<string, number[]>();
  for (const [id, v] of values) {
    const div = cur.get(id)?.division ?? "";
    const list = byDiv.get(div) ?? [];
    list.push(v);
    byDiv.set(div, list);
  }
  const mean = new Map([...byDiv].map(([d, list]) => [d, list.reduce((a, b) => a + b, 0) / list.length]));
  return new Map([...values].map(([id, v]) => [id, v - mean.get(cur.get(id)?.division ?? "")!]));
}

export interface PriorBuild {
  priors: Map<string, TeamPrior>;
  coverage: { teams: number; e9: number; mhr: number; either: number };
  matches: Array<{ team: string; division: string; e9From?: string; mhrFrom?: string }>;
}

export function buildPriors(curGames: BtGame[], prevGames: BtGame[] | undefined, mhr: MhrSnapshot | undefined): PriorBuild {
  const cur = identities(curGames);
  const e9 = new Map<string, number>();
  const matches: PriorBuild["matches"] = [];
  const e9From = new Map<string, string>();
  if (prevGames?.length) {
    const prev = identities(prevGames);
    const last = prevGames.reduce((d, g) => (g.date > d ? g.date : d), "");
    const final = masseyRatings(new History(prevGames), last, { cap: 8, lambda: 1, target: "margin" });
    for (const [id, prevId] of matchTeams(prev, cur)) {
      e9.set(id, final.rating(prevId));
      e9From.set(id, prev.get(prevId)!.name);
    }
  }
  const mhrRaw = new Map<string, number>();
  const mhrFrom = new Map<string, string>();
  if (mhr) {
    for (const team of cur.values()) {
      const hit = matchMhr(team, mhr);
      if (hit?.rating != null) {
        mhrRaw.set(team.id, hit.rating);
        mhrFrom.set(team.id, hit.name);
      }
    }
  }
  const e9c = centerByDivision(e9, cur);
  const mhrc = centerByDivision(mhrRaw, cur);
  const priors = new Map<string, TeamPrior>();
  for (const team of cur.values()) {
    const p: TeamPrior = {};
    if (e9c.has(team.id)) p.e9 = e9c.get(team.id);
    if (mhrc.has(team.id)) p.mhr = mhrc.get(team.id);
    priors.set(team.id, p);
    matches.push({ team: team.name, division: team.division, e9From: e9From.get(team.id), mhrFrom: mhrFrom.get(team.id) });
  }
  const vals = [...priors.values()];
  return {
    priors,
    coverage: {
      teams: cur.size,
      e9: vals.filter((p) => p.e9 != null).length,
      mhr: vals.filter((p) => p.mhr != null).length,
      either: vals.filter((p) => p.e9 != null || p.mhr != null).length,
    },
    matches,
  };
}

/** Compact prior inputs that can ship inside the Lambda bundle. */
export interface PriorSources {
  /** Season the ratings come from, e.g. "2025–26". */
  season: string;
  mhrYear: number;
  e9: Array<{ name: string; division: string; rating: number }>;
  mhr: Array<{ name: string; age: number; state?: string; rating: number }>;
}

export function compactPriorSources(season: string, prevGames: BtGame[], mhr: MhrSnapshot | undefined): PriorSources {
  const prev = identities(prevGames);
  const last = prevGames.reduce((d, g) => (g.date > d ? g.date : d), "");
  const final = masseyRatings(new History(prevGames), last, { cap: 8, lambda: 1, target: "margin" });
  const e9 = [...prev.values()].map((t) => ({ name: t.name, division: t.division, rating: Math.round(final.rating(t.id) * 1000) / 1000 }));
  const mhrTeams = (mhr?.divisions ?? []).flatMap((d) =>
    d.teams.filter((t) => t.rating != null && t.rating > 0).map((t) => ({ name: t.name, age: mhrTeamAge(t.name, d.age), ...(t.state ? { state: t.state } : {}), rating: t.rating! })),
  );
  return { season, mhrYear: mhr?.mhrYear ?? 0, e9, mhr: mhrTeams };
}

/** Same as `buildPriors`, from compact sources. `teams` are this season's identities (from any rows, played or not). */
export function priorsFromSources(teams: Map<string, TeamIdentity>, src: PriorSources): Map<string, TeamPrior> {
  const prev = new Map<string, TeamIdentity>();
  const rating = new Map<string, number>();
  src.e9.forEach((t, i) => {
    const id = `prev${i}`;
    prev.set(id, { id, name: t.name, division: t.division, birthYear: birthYear(t.division), ...parseE9Name(t.name) });
    rating.set(id, t.rating);
  });
  const e9 = new Map<string, number>();
  for (const [id, prevId] of matchTeams(prev, teams)) e9.set(id, rating.get(prevId)!);
  const snap: MhrSnapshot = { mhrYear: src.mhrYear, season: src.season, divisions: [{ label: "compact", age: 0, teams: src.mhr.map((t) => ({ mhrId: null, name: t.name, state: t.state, record: "", rating: t.rating })) }] };
  const mhrRaw = new Map<string, number>();
  if (src.mhrYear) {
    for (const team of teams.values()) {
      const hit = matchMhr(team, snap);
      if (hit?.rating != null) mhrRaw.set(team.id, hit.rating);
    }
  }
  const e9c = centerByDivision(e9, teams);
  const mhrc = centerByDivision(mhrRaw, teams);
  const out = new Map<string, TeamPrior>();
  for (const id of teams.keys()) {
    const p: TeamPrior = {};
    if (e9c.has(id)) p.e9 = e9c.get(id);
    if (mhrc.has(id)) p.mhr = mhrc.get(id);
    out.set(id, p);
  }
  return out;
}

export type PriorMode = "e9" | "mhr" | "blend";

/** Pre-season mean in goals per game, scaled by `rho`; undefined when the team has no prior of that kind. */
export function priorValue(p: TeamPrior | undefined, mode: PriorMode, rho: number, mhrScale = 1): number | undefined {
  if (!p) return undefined;
  const mhr = p.mhr != null ? p.mhr * mhrScale : undefined;
  const v = mode === "e9" ? p.e9 : mode === "mhr" ? mhr : p.e9 != null && mhr != null ? (p.e9 + mhr) / 2 : (p.e9 ?? mhr);
  return v == null ? undefined : rho * v;
}

