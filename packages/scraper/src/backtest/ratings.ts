/** Rating models shared by the backtest and the shipped scout-card model. */
import { dayNumber, type History } from "./games.js";
import { solveSpd } from "./linalg.js";

export function teamIndex(history: History): Map<string, number> {
  const idx = new Map<string, number>();
  for (const id of history.teams.keys()) idx.set(id, idx.size);
  return idx;
}

export interface MasseyOptions {
  cap: number;
  lambda: number;
  halfLifeDays?: number;
  /** "margin" regresses capped goal margin, "sqrt" a signed square root of it, "result" win/tie/loss as +1/0/−1. */
  target: "margin" | "sqrt" | "result";
  /** Shrink the home-ice term toward `value`, with the pull of `weight` games. Off in the backtest. */
  hfaPrior?: { value: number; weight: number };
  /** Shrink each team toward this pre-season mean instead of toward zero. */
  priorMean?: (id: string) => number;
}

/** Ridge least-squares ratings: margin ≈ r_home − r_away + hfa. */
export function masseyRatings(history: History, date: string, opts: MasseyOptions): { rating: (id: string) => number; hfa: number } {
  const idx = teamIndex(history);
  const t = idx.size;
  const n = t + 1;
  const A = new Float64Array(n * n);
  const b = new Float64Array(n);
  const today = dayNumber(date);
  for (const g of history.games) {
    const h = idx.get(g.homeId)!;
    const a = idx.get(g.awayId)!;
    const w = opts.halfLifeDays ? 0.5 ** ((today - dayNumber(g.date)) / opts.halfLifeDays) : 1;
    const raw = g.homeGoals - g.awayGoals;
    const capped = Math.max(-opts.cap, Math.min(opts.cap, raw));
    const m = opts.target === "result" ? Math.sign(raw) : opts.target === "sqrt" ? Math.sign(capped) * Math.sqrt(Math.abs(capped)) : capped;
    A[h * n + h]! += w;
    A[a * n + a]! += w;
    A[h * n + a]! -= w;
    A[a * n + h]! -= w;
    A[t * n + t]! += w;
    A[h * n + t]! += w;
    A[t * n + h]! += w;
    A[a * n + t]! -= w;
    A[t * n + a]! -= w;
    b[h]! += w * m;
    b[a]! -= w * m;
    b[t]! += w * m;
  }
  for (let i = 0; i < t; i++) A[i * n + i]! += opts.lambda;
  if (opts.priorMean) for (const [id, i] of idx) b[i]! += opts.lambda * opts.priorMean(id);
  A[t * n + t]! += 1e-3 + (opts.hfaPrior?.weight ?? 0);
  b[t]! += (opts.hfaPrior?.weight ?? 0) * (opts.hfaPrior?.value ?? 0);
  const x = t ? solveSpd(A, b, n) : new Float64Array(1);
  return { rating: (id) => (idx.has(id) ? x[idx.get(id)!]! : (opts.priorMean?.(id) ?? 0)), hfa: x[t] ?? 0 };
}


export interface KalmanOptions {
  /** Strength drift variance per day (goals²). 0 means strengths are fixed all season. */
  q: number;
  /** Observation noise variance of a capped goal margin (goals²). */
  r: number;
  /** Starting variance for a team with no prior. */
  v0: number;
  cap: number;
  /** Pre-season mean and its variance for teams that have one. */
  prior?: (id: string) => { mean: number; variance: number } | undefined;
}

/**
 * Kalman-filter team ratings: each team's strength is a random walk and every game is a noisy look at the gap.
 * Runs incrementally, so feed it games in date order and ask for ratings between dates.
 */
export class KalmanRatings {
  private readonly idx = new Map<string, number>();
  private readonly max: number;
  private x: Float64Array;
  private P: Float64Array;
  private n = 1;
  private lastDay: number | undefined;
  processed = 0;

  constructor(private readonly opts: KalmanOptions, maxTeams = 400) {
    this.max = maxTeams + 1;
    this.x = new Float64Array(this.max);
    this.P = new Float64Array(this.max * this.max);
    this.P[0] = 0.25; // home-ice term, index 0
  }

  private ensure(id: string): number {
    let i = this.idx.get(id);
    if (i !== undefined) return i;
    i = this.n++;
    if (i >= this.max) throw new Error("KalmanRatings: too many teams");
    this.idx.set(id, i);
    const p = this.opts.prior?.(id);
    this.x[i] = p?.mean ?? 0;
    this.P[i * this.max + i] = p?.variance ?? this.opts.v0;
    return i;
  }

  private advance(day: number): void {
    if (this.lastDay !== undefined && day > this.lastDay && this.opts.q > 0) {
      const add = this.opts.q * (day - this.lastDay);
      for (let i = 1; i < this.n; i++) this.P[i * this.max + i]! += add;
    }
    this.lastDay = day;
  }

  update(homeId: string, awayId: string, margin: number, day: number): void {
    const h = this.ensure(homeId);
    const a = this.ensure(awayId);
    this.advance(day);
    const m = this.max;
    const n = this.n;
    const P = this.P;
    const ph = new Float64Array(n);
    for (let i = 0; i < n; i++) ph[i] = P[i * m + h]! - P[i * m + a]! + P[i * m]!;
    const s = ph[h]! - ph[a]! + ph[0]! + this.opts.r;
    const y = Math.max(-this.opts.cap, Math.min(this.opts.cap, margin));
    const innov = y - (this.x[h]! - this.x[a]! + this.x[0]!);
    for (let i = 0; i < n; i++) this.x[i]! += (ph[i]! / s) * innov;
    for (let i = 0; i < n; i++) {
      const ki = ph[i]! / s;
      if (ki === 0) continue;
      for (let j = 0; j < n; j++) P[i * m + j]! -= ki * ph[j]!;
    }
  }

  rating(id: string): number {
    return this.x[this.ensure(id)]!;
  }

  variance(id: string): number {
    const i = this.ensure(id);
    return this.P[i * this.max + i]!;
  }

  get hfa(): number {
    return this.x[0]!;
  }
}
