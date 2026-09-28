/**
 * Candidate win-prediction metrics for the Elite 9 backtest.
 *
 * Every metric is a raw home-minus-away signal computed only from `History`, which the harness fills with games
 * dated strictly before the target game. The harness turns each signal into a probability with a walk-forward
 * logistic calibration, so metrics do not need to be on any particular scale.
 */
import type { RangersPlayedGame, RangersRecord } from "@openice/shared";
import { dayNumber, type History, type TeamGame } from "./games.js";
import { legacyBeliefScore } from "./legacy-belief.js";
import { logit, sigmoid, solveSpd } from "./linalg.js";
import { masseyRatings, teamIndex, type MasseyOptions } from "./ratings.js";

export { masseyRatings, type MasseyOptions };

export type Scorer = (homeId: string, awayId: string) => number;

export interface Metric {
  name: string;
  family: string;
  /** Rough count of tunable knobs plus model machinery; breaks near-ties toward simpler metrics. */
  complexity: number;
  /** When set, maps the raw signal straight to P(home win) so the uncalibrated metric can be scored too. */
  rawProbability?: (x: number) => number;
  prepare(history: History, date: string): Scorer;
}

// ---------------------------------------------------------------- team summaries

export interface TeamSummary {
  /** Sum of weights (games when unweighted). */
  n: number;
  /** Points share, ties = half. */
  wp: number;
  /** Wins only. */
  winsOnly: number;
  gf: number;
  ga: number;
  /** Mean capped goal differential. */
  gd: number;
}

export interface SummaryOptions {
  /** Keep only the last N games. */
  lastN?: number;
  /** Exponential decay by games back; weight halves every `halfLifeGames`. */
  halfLifeGames?: number;
  /** Cap on |margin| per game for `gd`. */
  cap?: number;
}

export function summarize(games: readonly TeamGame[], opts: SummaryOptions = {}): TeamSummary {
  const list = opts.lastN ? games.slice(-opts.lastN) : games;
  const cap = opts.cap ?? Infinity;
  let n = 0;
  let wp = 0;
  let wins = 0;
  let gf = 0;
  let ga = 0;
  let gd = 0;
  for (let i = 0; i < list.length; i++) {
    const g = list[i]!;
    const back = list.length - 1 - i;
    const w = opts.halfLifeGames ? 0.5 ** (back / opts.halfLifeGames) : 1;
    n += w;
    wp += w * g.result;
    wins += w * (g.result === 1 ? 1 : 0);
    gf += w * g.gf;
    ga += w * g.ga;
    gd += w * Math.max(-cap, Math.min(cap, g.gf - g.ga));
  }
  if (n === 0) return { n: 0, wp: 0.5, winsOnly: 0.5, gf: 0, ga: 0, gd: 0 };
  return { n, wp: wp / n, winsOnly: wins / n, gf: gf / n, ga: ga / n, gd: gd / n };
}

function diffMetric(
  name: string,
  family: string,
  complexity: number,
  value: (games: readonly TeamGame[], history: History) => number,
): Metric {
  return {
    name,
    family,
    complexity,
    prepare(history) {
      const cache = new Map<string, number>();
      const get = (id: string) => {
        let v = cache.get(id);
        if (v === undefined) {
          v = value(history.team(id), history);
          if (!Number.isFinite(v)) v = 0;
          cache.set(id, v);
        }
        return v;
      };
      return (home, away) => get(home) - get(away);
    },
  };
}

function pythag(s: TeamSummary, k: number): number {
  const gf = s.gf + 0.5;
  const ga = s.ga + 0.5;
  return gf ** k / (gf ** k + ga ** k);
}

function streak(games: readonly TeamGame[]): number {
  let len = 0;
  let sign = 0;
  for (let i = games.length - 1; i >= 0; i--) {
    const r = games[i]!.result;
    const s = r === 1 ? 1 : r === 0 ? -1 : 0;
    if (s === 0) break;
    if (sign === 0) sign = s;
    if (s !== sign) break;
    len++;
  }
  return sign * len;
}

// ---------------------------------------------------------------- strength of schedule

function rpiParts(history: History): Map<string, { wp: number; owp: number; oowp: number }> {
  const wp = new Map<string, number>();
  for (const [id, games] of history.teams) wp.set(id, summarize(games).wp);
  const owp = new Map<string, number>();
  for (const [id, games] of history.teams) {
    owp.set(id, games.length ? games.reduce((sum, g) => sum + (wp.get(g.oppId) ?? 0.5), 0) / games.length : 0.5);
  }
  const out = new Map<string, { wp: number; owp: number; oowp: number }>();
  for (const [id, games] of history.teams) {
    const oowp = games.length ? games.reduce((sum, g) => sum + (owp.get(g.oppId) ?? 0.5), 0) / games.length : 0.5;
    out.set(id, { wp: wp.get(id)!, owp: owp.get(id)!, oowp });
  }
  return out;
}

function rpiMetric(name: string, weights: [number, number, number]): Metric {
  return {
    name,
    family: "schedule",
    complexity: 2,
    prepare(history) {
      const parts = rpiParts(history);
      const v = (id: string) => {
        const p = parts.get(id);
        return p ? weights[0] * p.wp + weights[1] * p.owp + weights[2] * p.oowp : 0.5;
      };
      return (home, away) => v(home) - v(away);
    },
  };
}

function sosAdjustedGd(cap: number): Metric {
  return {
    name: `sos-adj-gd:cap${cap}`,
    family: "schedule",
    complexity: 2,
    prepare(history) {
      const gd = new Map<string, number>();
      for (const [id, games] of history.teams) gd.set(id, summarize(games, { cap }).gd);
      const adj = (id: string) => {
        const games = history.team(id);
        if (!games.length) return 0;
        const opp = games.reduce((sum, g) => sum + (gd.get(g.oppId) ?? 0), 0) / games.length;
        return (gd.get(id) ?? 0) + opp;
      };
      return (home, away) => adj(home) - adj(away);
    },
  };
}

// ---------------------------------------------------------------- rating models

function masseyMetric(opts: MasseyOptions): Metric {
  const tag = opts.target === "result" ? "result" : opts.target === "sqrt" ? `sqrt:cap${opts.cap}` : `cap${opts.cap}`;
  return {
    name: `massey:${tag}:l${opts.lambda}${opts.halfLifeDays ? `:hl${opts.halfLifeDays}d` : ""}`,
    family: "massey",
    complexity: 3 + (opts.halfLifeDays ? 1 : 0),
    prepare(history, date) {
      const m = masseyRatings(history, date, opts);
      return (home, away) => m.rating(home) - m.rating(away) + m.hfa;
    },
  };
}

export interface BtOptions {
  lambda: number;
  /** Soft target from margin: y = 0.5 + 0.5·tanh(margin / soft). Omit for win/tie/loss = 1/0.5/0. */
  soft?: number;
  halfLifeDays?: number;
}

/** Bradley–Terry (logistic) ratings with a home term, ridge-penalized, via Newton's method. */
export function bradleyTerry(history: History, date: string, opts: BtOptions): { rating: (id: string) => number; hfa: number } {
  const idx = teamIndex(history);
  const t = idx.size;
  const n = t + 1;
  const x = new Float64Array(n);
  const today = dayNumber(date);
  const rows = history.games.map((g) => {
    const raw = g.homeGoals - g.awayGoals;
    const y = opts.soft ? 0.5 + 0.5 * Math.tanh(raw / opts.soft) : raw > 0 ? 1 : raw < 0 ? 0 : 0.5;
    const w = opts.halfLifeDays ? 0.5 ** ((today - dayNumber(g.date)) / opts.halfLifeDays) : 1;
    return { h: idx.get(g.homeId)!, a: idx.get(g.awayId)!, y, w };
  });
  for (let it = 0; it < 12 && t; it++) {
    const H = new Float64Array(n * n);
    const grad = new Float64Array(n);
    for (const { h, a, y, w } of rows) {
      const p = sigmoid(x[h]! - x[a]! + x[t]!);
      const r = w * (p - y);
      const q = w * Math.max(p * (1 - p), 1e-9);
      grad[h]! += r;
      grad[a]! -= r;
      grad[t]! += r;
      H[h * n + h]! += q;
      H[a * n + a]! += q;
      H[t * n + t]! += q;
      H[h * n + a]! -= q;
      H[a * n + h]! -= q;
      H[h * n + t]! += q;
      H[t * n + h]! += q;
      H[a * n + t]! -= q;
      H[t * n + a]! -= q;
    }
    for (let i = 0; i < t; i++) {
      H[i * n + i]! += opts.lambda;
      grad[i]! += opts.lambda * x[i]!;
    }
    H[t * n + t]! += 1e-3;
    grad[t]! += 1e-3 * x[t]!;
    const step = solveSpd(H, grad, n);
    let max = 0;
    for (let i = 0; i < n; i++) {
      x[i]! -= step[i]!;
      max = Math.max(max, Math.abs(step[i]!));
    }
    if (max < 1e-7) break;
  }
  return { rating: (id) => (idx.has(id) ? x[idx.get(id)!]! : 0), hfa: x[t] ?? 0 };
}

function btMetric(opts: BtOptions): Metric {
  return {
    name: `bt:l${opts.lambda}${opts.soft ? `:soft${opts.soft}` : ""}${opts.halfLifeDays ? `:hl${opts.halfLifeDays}d` : ""}`,
    family: "bradley-terry",
    complexity: 3 + (opts.soft ? 1 : 0) + (opts.halfLifeDays ? 1 : 0),
    rawProbability: sigmoid,
    prepare(history, date) {
      const m = bradleyTerry(history, date, opts);
      return (home, away) => m.rating(home) - m.rating(away) + m.hfa;
    },
  };
}

function colleyMetric(): Metric {
  return {
    name: "colley",
    family: "colley",
    complexity: 2,
    prepare(history) {
      const idx = teamIndex(history);
      const n = idx.size;
      const C = new Float64Array(n * n);
      const b = new Float64Array(n).fill(1);
      for (let i = 0; i < n; i++) C[i * n + i] = 2;
      for (const g of history.games) {
        const h = idx.get(g.homeId)!;
        const a = idx.get(g.awayId)!;
        C[h * n + h]! += 1;
        C[a * n + a]! += 1;
        C[h * n + a]! -= 1;
        C[a * n + h]! -= 1;
        const s = Math.sign(g.homeGoals - g.awayGoals) / 2;
        b[h]! += s;
        b[a]! -= s;
      }
      const r = n ? solveSpd(C, b, n) : new Float64Array(0);
      const v = (id: string) => (idx.has(id) ? r[idx.get(id)!]! : 0.5);
      return (home, away) => v(home) - v(away);
    },
  };
}

export interface EloOptions {
  k: number;
  /** Home-ice bonus in Elo points used when computing expectations during updates. */
  hfa: number;
  mov: "none" | "log" | "538";
}

/** Replay history in order and return final Elo ratings (1500 start). */
export function eloRatings(history: History, opts: EloOptions): (id: string) => number {
  const r = new Map<string, number>();
  const get = (id: string) => r.get(id) ?? 1500;
  for (const g of history.games) {
    const rh = get(g.homeId);
    const ra = get(g.awayId);
    const diff = rh + opts.hfa - ra;
    const expected = 1 / (1 + 10 ** (-diff / 400));
    const margin = g.homeGoals - g.awayGoals;
    const actual = margin > 0 ? 1 : margin < 0 ? 0 : 0.5;
    let mult = 1;
    if (opts.mov === "log") mult = Math.log(Math.abs(margin) + 1) || 0.5;
    if (opts.mov === "538") {
      const winnerDiff = margin >= 0 ? diff : -diff;
      mult = ((Math.log(Math.abs(margin) + 1) || 0.5) * 2.2) / (winnerDiff * 0.001 + 2.2);
    }
    const delta = opts.k * mult * (actual - expected);
    r.set(g.homeId, rh + delta);
    r.set(g.awayId, ra - delta);
  }
  return get;
}

function eloMetric(opts: EloOptions): Metric {
  return {
    name: `elo:k${opts.k}:hfa${opts.hfa}:${opts.mov}`,
    family: "elo",
    complexity: 3,
    rawProbability: sigmoid,
    prepare(history) {
      const get = eloRatings(history, opts);
      return (home, away) => ((get(home) + opts.hfa - get(away)) / 400) * Math.LN10;
    },
  };
}

export interface PoissonOptions {
  lambda: number;
  halfLifeDays?: number;
}

/**
 * Independent-Poisson goals model: log E[home goals] = mu + hfa + att_home − def_away, and symmetric for away.
 * Ridge-penalized attack and defense, fit by Newton's method.
 */
export function poissonRatings(history: History, date: string, opts: PoissonOptions) {
  const idx = teamIndex(history);
  const t = idx.size;
  const n = 2 * t + 2;
  const MU = 2 * t;
  const HFA = 2 * t + 1;
  const x = new Float64Array(n);
  const today = dayNumber(date);
  let goals = 0;
  for (const g of history.games) goals += g.homeGoals + g.awayGoals;
  x[MU] = Math.log(Math.max(0.5, goals / Math.max(1, 2 * history.games.length)));
  const obs: Array<{ vars: [number, number]; goals: number; home: boolean; w: number }> = [];
  for (const g of history.games) {
    const h = idx.get(g.homeId)!;
    const a = idx.get(g.awayId)!;
    const w = opts.halfLifeDays ? 0.5 ** ((today - dayNumber(g.date)) / opts.halfLifeDays) : 1;
    obs.push({ vars: [h, t + a], goals: g.homeGoals, home: true, w });
    obs.push({ vars: [a, t + h], goals: g.awayGoals, home: false, w });
  }
  for (let it = 0; it < 10 && t; it++) {
    const H = new Float64Array(n * n);
    const grad = new Float64Array(n);
    for (const o of obs) {
      const [att, def] = o.vars;
      const eta = x[MU]! + (o.home ? x[HFA]! : 0) + x[att]! - x[def]!;
      const mu = Math.exp(eta);
      const r = o.w * (mu - o.goals);
      const q = o.w * mu;
      const idxs = o.home ? [MU, HFA, att, def] : [MU, att, def];
      const sign = o.home ? [1, 1, 1, -1] : [1, 1, -1];
      for (let i = 0; i < idxs.length; i++) {
        grad[idxs[i]!]! += sign[i]! * r;
        for (let j = 0; j < idxs.length; j++) H[idxs[i]! * n + idxs[j]!]! += sign[i]! * sign[j]! * q;
      }
    }
    for (let i = 0; i < 2 * t; i++) {
      H[i * n + i]! += opts.lambda;
      grad[i]! += opts.lambda * x[i]!;
    }
    H[MU * n + MU]! += 1e-3;
    H[HFA * n + HFA]! += 1e-3;
    grad[HFA]! += 1e-3 * x[HFA]!;
    const step = solveSpd(H, grad, n);
    let max = 0;
    for (let i = 0; i < n; i++) {
      x[i]! -= step[i]!;
      max = Math.max(max, Math.abs(step[i]!));
    }
    if (max < 1e-7) break;
  }
  const att = (id: string) => (idx.has(id) ? x[idx.get(id)!]! : 0);
  const def = (id: string) => (idx.has(id) ? x[t + idx.get(id)!]! : 0);
  return {
    expected(homeId: string, awayId: string): { home: number; away: number } {
      return {
        home: Math.exp(x[MU]! + x[HFA]! + att(homeId) - def(awayId)),
        away: Math.exp(x[MU]! + att(awayId) - def(homeId)),
      };
    },
    att,
    def,
    hfa: x[HFA]!,
  };
}

/** P(home win), P(tie), P(away win) for independent Poisson goal counts. */
export function poissonOutcome(home: number, away: number, maxGoals = 30): { win: number; tie: number; loss: number } {
  const pmf = (lam: number) => {
    const out = new Float64Array(maxGoals + 1);
    out[0] = Math.exp(-lam);
    for (let k = 1; k <= maxGoals; k++) out[k] = (out[k - 1]! * lam) / k;
    return out;
  };
  const ph = pmf(home);
  const pa = pmf(away);
  let win = 0;
  let tie = 0;
  let loss = 0;
  for (let i = 0; i <= maxGoals; i++) {
    for (let j = 0; j <= maxGoals; j++) {
      const q = ph[i]! * pa[j]!;
      if (i > j) win += q;
      else if (i === j) tie += q;
      else loss += q;
    }
  }
  return { win, tie, loss };
}

function poissonMetric(opts: PoissonOptions): Metric {
  return {
    name: `poisson:l${opts.lambda}${opts.halfLifeDays ? `:hl${opts.halfLifeDays}d` : ""}`,
    family: "poisson",
    complexity: 4 + (opts.halfLifeDays ? 1 : 0),
    rawProbability: sigmoid,
    prepare(history, date) {
      const m = poissonRatings(history, date, opts);
      return (home, away) => {
        const e = m.expected(home, away);
        const o = poissonOutcome(e.home, e.away);
        return logit(o.win + 0.5 * o.tie);
      };
    },
  };
}

/** Recent over-performance: mean of (actual capped margin − Massey-expected margin) over a team's last N games. */
function residualFormMetric(lastN: number): Metric {
  return {
    name: `form:residual:last${lastN}`,
    family: "momentum",
    complexity: 4,
    prepare(history, date) {
      const m = masseyRatings(history, date, { cap: 8, lambda: 1, target: "margin" });
      const resid = (id: string) => {
        const games = history.team(id).slice(-lastN);
        if (!games.length) return 0;
        let sum = 0;
        for (const g of games) {
          const expected = m.rating(id) - m.rating(g.oppId) + (g.home ? m.hfa : -m.hfa);
          sum += Math.max(-8, Math.min(8, g.gf - g.ga)) - expected;
        }
        return sum / games.length;
      };
      return (home, away) => resid(home) - resid(away);
    },
  };
}

/** Home-ice only, as a constant signal per birth year (captures age-group differences in home advantage). */
function homeByBirthYearMetric(): Metric {
  return { name: "home:constant", family: "home", complexity: 1, prepare: () => () => 1 };
}

// ---------------------------------------------------------------- head-to-head, rest, current belief

function meetings(history: History, homeId: string, awayId: string): TeamGame[] {
  return history.team(homeId).filter((g) => g.oppId === awayId);
}

function h2hMetric(kind: "result" | "margin"): Metric {
  return {
    name: `h2h:${kind}`,
    family: "head-to-head",
    complexity: 1,
    prepare(history) {
      return (home, away) => {
        const m = meetings(history, home, away);
        if (!m.length) return 0;
        if (kind === "result") return m.reduce((s, g) => s + g.result - 0.5, 0) / m.length;
        return m.reduce((s, g) => s + Math.max(-5, Math.min(5, g.gf - g.ga)), 0) / m.length;
      };
    },
  };
}

function restMetric(): Metric {
  return {
    name: "rest-days",
    family: "rest",
    complexity: 1,
    prepare(history, date) {
      const today = dayNumber(date);
      const rest = (id: string) => {
        const games = history.team(id);
        const last = games[games.length - 1];
        return last ? Math.min(14, today - dayNumber(last.date)) : 14;
      };
      return (home, away) => rest(home) - rest(away);
    },
  };
}

function record(games: readonly TeamGame[]): RangersRecord {
  let wins = 0;
  let losses = 0;
  let ties = 0;
  let gf = 0;
  let ga = 0;
  for (const g of games) {
    if (g.result === 1) wins++;
    else if (g.result === 0) losses++;
    else ties++;
    gf += g.gf;
    ga += g.ga;
  }
  return { gp: games.length, wins, losses, ties, points: wins * 2 + ties, gf, ga, gd: gf - ga, streak: "", lastFive: "" };
}

function played(g: TeamGame): RangersPlayedGame {
  return {
    date: g.date,
    opponentId: g.oppId,
    opponentName: g.oppId,
    result: g.result === 1 ? "W" : g.result === 0 ? "L" : "T",
    ourScore: g.gf,
    theirScore: g.ga,
    isHome: g.home,
    location: "",
    rink: "",
  };
}

/** The hand-tuned score shipped on the scout cards before this backtest, graded from the home team's side. */
function currentBeliefMetric(): Metric {
  return {
    name: "baseline:current-belief",
    family: "baseline",
    complexity: 8,
    rawProbability: (x) => Math.min(0.99, Math.max(0.01, x / 100)),
    prepare(history) {
      return (home, away) => {
        const them = history.team(away).map(played);
        const prior = [...meetings(history, home, away)].reverse()[0];
        return legacyBeliefScore({
          us: record(history.team(home)),
          them: record(history.team(away)),
          lostTo: them.filter((g) => g.result === "L"),
          prior: prior ? played(prior) : undefined,
          isHome: true,
        });
      };
    },
  };
}

// ---------------------------------------------------------------- catalogue

export function baselineMetrics(): Metric[] {
  return [
    { name: "baseline:home-rate", family: "baseline", complexity: 0, prepare: () => () => 0 },
    { name: "baseline:coin-flip", family: "baseline", complexity: 0, rawProbability: () => 0.5, prepare: () => () => 0 },
    currentBeliefMetric(),
  ];
}

export function candidateMetrics(): Metric[] {
  const out: Metric[] = [];

  // Season-to-date record.
  out.push(diffMetric("record:points-pct", "record", 1, (g) => summarize(g).wp));
  out.push(diffMetric("record:wins-pct", "record", 1, (g) => summarize(g).winsOnly));
  out.push(diffMetric("record:gf-per-game", "record", 1, (g) => summarize(g).gf));
  out.push(diffMetric("record:ga-per-game", "record", 1, (g) => -summarize(g).ga));
  for (const cap of [1, 2, 3, 5, 8, Infinity]) {
    out.push(diffMetric(`record:gd:cap${cap}`, "record", 2, (g) => summarize(g, { cap }).gd));
  }
  for (const k of [1, 1.5, 2, 2.5, 3]) {
    out.push(diffMetric(`record:pythag:k${k}`, "record", 2, (g) => pythag(summarize(g), k)));
  }

  // Recency.
  for (const hl of [3, 6, 12]) {
    out.push(diffMetric(`decay:points-pct:hl${hl}`, "recency", 2, (g) => summarize(g, { halfLifeGames: hl }).wp));
    out.push(diffMetric(`decay:gd:cap5:hl${hl}`, "recency", 3, (g) => summarize(g, { halfLifeGames: hl, cap: 5 }).gd));
    out.push(diffMetric(`decay:gd:hl${hl}`, "recency", 2, (g) => summarize(g, { halfLifeGames: hl }).gd));
  }
  for (const lastN of [3, 5, 8]) {
    out.push(diffMetric(`form:points-pct:last${lastN}`, "recency", 2, (g) => summarize(g, { lastN }).wp));
    out.push(diffMetric(`form:gd:cap5:last${lastN}`, "recency", 3, (g) => summarize(g, { lastN, cap: 5 }).gd));
  }
  out.push(diffMetric("form:streak", "momentum", 1, (g) => streak(g)));
  out.push(diffMetric("form:last-result", "momentum", 1, (g) => (g.length ? g[g.length - 1]!.result - 0.5 : 0)));

  // Head-to-head and rest.
  out.push(h2hMetric("result"), h2hMetric("margin"), restMetric());

  // Strength of schedule.
  out.push(rpiMetric("rpi:ncaa", [0.25, 0.5, 0.25]));
  out.push(rpiMetric("rpi:heavy-own", [0.5, 0.35, 0.15]));
  out.push(rpiMetric("sos:opp-points-pct", [0, 1, 0]));
  for (const cap of [3, 5, Infinity]) out.push(sosAdjustedGd(cap));

  // Rating models.
  for (const cap of [2, 3, 5, 8, Infinity]) {
    for (const lambda of [0.3, 1, 3, 10]) out.push(masseyMetric({ cap, lambda, target: "margin" }));
  }
  for (const lambda of [1, 3, 10]) out.push(masseyMetric({ cap: 1, lambda, target: "result" }));
  for (const halfLifeDays of [30, 60]) {
    for (const lambda of [1, 3]) out.push(masseyMetric({ cap: 5, lambda, halfLifeDays, target: "margin" }));
  }
  for (const lambda of [0.1, 0.3, 1, 3]) out.push(btMetric({ lambda }));
  for (const soft of [2, 4]) {
    for (const lambda of [0.3, 1]) out.push(btMetric({ lambda, soft }));
  }
  out.push(colleyMetric());

  // Round 2: refinements around the round-1 leaders, a goals model, and residual momentum.
  for (const cap of [6, 10, 12, 15]) {
    for (const lambda of [0.3, 1]) out.push(masseyMetric({ cap, lambda, target: "margin" }));
  }
  out.push(masseyMetric({ cap: 8, lambda: 0.1, target: "margin" }));
  for (const cap of [8, Infinity]) {
    for (const lambda of [0.3, 1]) out.push(masseyMetric({ cap, lambda, target: "sqrt" }));
  }
  for (const halfLifeDays of [90, 120]) {
    for (const cap of [8, Infinity]) out.push(masseyMetric({ cap, lambda: 1, halfLifeDays, target: "margin" }));
  }
  for (const soft of [6, 8]) out.push(btMetric({ lambda: 0.3, soft }));
  for (const lambda of [1, 3, 10]) out.push(poissonMetric({ lambda }));
  out.push(poissonMetric({ lambda: 3, halfLifeDays: 90 }));
  for (const lastN of [3, 5, 8]) out.push(residualFormMetric(lastN));
  out.push(homeByBirthYearMetric());
  for (const k of [8, 16, 24, 32, 48, 64]) {
    for (const hfa of [0, 35]) {
      for (const mov of ["none", "log", "538"] as const) out.push(eloMetric({ k, hfa, mov }));
    }
  }
  return out;
}

/** Second-stage models: walk-forward logistic regression over several first-stage signals. */
export interface ComboSpec {
  name: string;
  features: string[];
  l2: number;
  /** Fit a separate calibration per birth year (pooled fallback when a year has too little history). */
  byBirthYear?: boolean;
}

export { logit, sigmoid };

export const BASE_RATING = "massey:cap8:l1";

export function comboSpecs(): ComboSpec[] {
  const r = BASE_RATING;
  const pairs = [
    "h2h:margin",
    "h2h:result",
    "form:gd:cap5:last5",
    "form:points-pct:last5",
    "form:residual:last3",
    "form:residual:last5",
    "form:streak",
    "form:last-result",
    "rest-days",
    "record:points-pct",
    "sos:opp-points-pct",
    "elo:k48:hfa35:log",
    "bt:l0.3:soft4",
    "poisson:l3",
    "record:gf-per-game",
  ];
  const out: ComboSpec[] = pairs.map((f) => ({ name: `combo:${r}+${f}`, features: [r, f], l2: 1 }));
  out.push({ name: `combo:${r}:by-birth-year`, features: [r], l2: 1, byBirthYear: true });
  out.push({ name: `combo:${r}+home:by-birth-year`, features: [r, "home:constant"], l2: 1, byBirthYear: true });
  const sink = [r, "h2h:margin", "form:residual:last5", "form:streak", "rest-days", "record:points-pct", "elo:k48:hfa35:log", "poisson:l3"];
  for (const l2 of [1, 10, 50]) out.push({ name: `combo:kitchen-sink:l2-${l2}`, features: sink, l2 });
  out.push({ name: "combo:massey+elo+poisson+bt", features: [r, "elo:k48:hfa35:log", "poisson:l3", "bt:l0.3:soft4"], l2: 10 });
  out.push({ name: "combo:record-only (pts%+gd+gf)", features: ["record:points-pct", "record:gd:capInfinity", "record:gf-per-game"], l2: 1 });
  out.push({ name: "combo:massey-margin+massey-result", features: [r, "massey:result:l1"], l2: 1 });
  return out;
}
