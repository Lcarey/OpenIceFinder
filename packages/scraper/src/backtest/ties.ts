/** Win / tie / loss probabilities: ordered logit versus spreading a flat tie rate over the binary model. */
import { birthYear } from "./games.js";
import { walkForward, type FeatureTable, type Split } from "./harness.js";
import { fitOrderedLogit, orderedProbs, type OrderedLogit } from "./linalg.js";

export interface ThreeWay {
  away: Float64Array;
  tie: Float64Array;
  home: Float64Array;
}

export interface ThreeWayScore {
  n: number;
  /** Mean −log P(actual outcome) over three classes. */
  logLoss: number;
  /** Mean predicted tie probability and actual tie rate. */
  predictedTies: number;
  actualTies: number;
  /** Tie calibration by predicted tie probability. */
  tieBins: Array<{ lo: number; hi: number; n: number; predicted: number; actual: number }>;
}

function blank(n: number): ThreeWay {
  return { away: new Float64Array(n).fill(NaN), tie: new Float64Array(n).fill(NaN), home: new Float64Array(n).fill(NaN) };
}

export function orderedWalkForward(table: FeatureTable, signal: Float64Array, byBirthYear = false, minPrior = 2): ThreeWay {
  const n = table.games.length;
  const out = blank(n);
  const past: number[] = [];
  const years = table.games.map((g) => birthYear(g.homeDiv));
  let pooled: OrderedLogit | undefined;
  for (let d = 0; d + 1 < table.dateStarts.length; d++) {
    const start = table.dateStarts[d]!;
    const end = table.dateStarts[d + 1]!;
    if (past.length >= 30) {
      pooled = fitOrderedLogit(signal, table.y, past, pooled);
      const groups = new Map<string, OrderedLogit>();
      if (byBirthYear) {
        for (const yr of new Set(years.slice(start, end))) {
          const idx = past.filter((i) => years[i] === yr);
          if (idx.length >= 150) groups.set(yr, fitOrderedLogit(signal, table.y, idx, pooled));
        }
      }
      for (let i = start; i < end; i++) {
        const p = orderedProbs(groups.get(years[i]!) ?? pooled, signal[i]!);
        out.away[i] = p.away;
        out.tie[i] = p.tie;
        out.home[i] = p.home;
      }
    }
    for (let i = start; i < end; i++) if (table.priorHome[i]! >= minPrior && table.priorAway[i]! >= minPrior) past.push(i);
  }
  return out;
}

/** Binary expected-points model plus the running tie rate from earlier games. */
export function flatTieWalkForward(table: FeatureTable, signal: Float64Array): ThreeWay {
  const p = walkForward(table, [signal]);
  const out = blank(table.games.length);
  let ties = 0;
  let seen = 0;
  for (let d = 0; d + 1 < table.dateStarts.length; d++) {
    const start = table.dateStarts[d]!;
    const end = table.dateStarts[d + 1]!;
    const rate = seen ? ties / seen : 0.1;
    for (let i = start; i < end; i++) {
      if (!Number.isFinite(p[i]!)) continue;
      const t = Math.min(rate, 2 * Math.min(p[i]!, 1 - p[i]!));
      out.tie[i] = t;
      out.home[i] = p[i]! - t / 2;
      out.away[i] = 1 - p[i]! - t / 2;
    }
    for (let i = start; i < end; i++) {
      seen++;
      if (table.y[i] === 0.5) ties++;
    }
  }
  return out;
}

export function scoreThreeWay(t: ThreeWay, table: FeatureTable, idx: number[]): ThreeWayScore {
  let n = 0;
  let ll = 0;
  let pt = 0;
  let at = 0;
  const bins = [0, 0.05, 0.1, 0.15, 0.2, 0.3].map((lo, k, arr) => ({ lo, hi: arr[k + 1] ?? 1, n: 0, predicted: 0, actual: 0 }));
  for (const i of idx) {
    if (!Number.isFinite(t.tie[i]!)) continue;
    const y = table.y[i]!;
    const p = y === 1 ? t.home[i]! : y === 0 ? t.away[i]! : t.tie[i]!;
    n++;
    ll += -Math.log(Math.max(p, 1e-9));
    pt += t.tie[i]!;
    at += y === 0.5 ? 1 : 0;
    const bin = bins.find((b) => t.tie[i]! >= b.lo && t.tie[i]! < b.hi) ?? bins[bins.length - 1]!;
    bin.n++;
    bin.predicted += t.tie[i]!;
    bin.actual += y === 0.5 ? 1 : 0;
  }
  return {
    n,
    logLoss: ll / n,
    predictedTies: pt / n,
    actualTies: at / n,
    tieBins: bins.filter((b) => b.n).map((b) => ({ ...b, predicted: b.predicted / b.n, actual: b.actual / b.n })),
  };
}

export function tieStudy(table: FeatureTable, split: Split, signalName: string) {
  const x = table.signals.get(signalName)!;
  const models = {
    "flat tie rate": flatTieWalkForward(table, x),
    "ordered logit": orderedWalkForward(table, x),
    "ordered logit by birth year": orderedWalkForward(table, x, true),
  };
  return Object.entries(models).map(([name, t]) => ({
    name,
    eligible: scoreThreeWay(t, table, split.eligible),
    holdout: scoreThreeWay(t, table, split.holdout),
    train: scoreThreeWay(t, table, split.train),
  }));
}
