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
  A[t * n + t]! += 1e-3 + (opts.hfaPrior?.weight ?? 0);
  b[t]! += (opts.hfaPrior?.weight ?? 0) * (opts.hfaPrior?.value ?? 0);
  const x = t ? solveSpd(A, b, n) : new Float64Array(1);
  return { rating: (id) => (idx.has(id) ? x[idx.get(id)!]! : 0), hfa: x[t] ?? 0 };
}

