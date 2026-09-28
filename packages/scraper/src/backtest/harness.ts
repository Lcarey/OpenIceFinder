/**
 * Walk-forward backtest harness.
 *
 * Games are replayed date by date. For each date, every metric sees a `History` holding only games from earlier
 * dates, so same-day games (doubleheaders) never see each other's results. Raw signals are turned into
 * probabilities by a logistic calibration refit each date on earlier games only.
 */
import { birthYear, History, homeResult, type BtGame } from "./games.js";
import { fitLogistic, predictLogistic } from "./linalg.js";
import type { ComboSpec, Metric } from "./metrics.js";

export interface FeatureTable {
  games: BtGame[];
  /** Outcome from the home side: 1, 0.5, 0. */
  y: Float64Array;
  /** Completed games each side had before this game's date. */
  priorHome: Int32Array;
  priorAway: Int32Array;
  /** Index of the first game on each distinct date, plus games.length at the end. */
  dateStarts: number[];
  /** Raw signal per metric name, one value per game. */
  signals: Map<string, Float64Array>;
}

export function sortGames(games: BtGame[]): BtGame[] {
  return [...games].sort((a, b) => a.date.localeCompare(b.date) || a.time.localeCompare(b.time) || a.id.localeCompare(b.id));
}

export function computeFeatures(input: BtGame[], metrics: Metric[], onDate?: (date: string, i: number, total: number) => void): FeatureTable {
  const games = sortGames(input);
  const n = games.length;
  const y = new Float64Array(n);
  const priorHome = new Int32Array(n);
  const priorAway = new Int32Array(n);
  const signals = new Map(metrics.map((m) => [m.name, new Float64Array(n)]));
  const dateStarts: number[] = [];
  const history = new History();
  let i = 0;
  while (i < n) {
    const date = games[i]!.date;
    let j = i;
    while (j < n && games[j]!.date === date) j++;
    dateStarts.push(i);
    onDate?.(date, dateStarts.length, n);
    for (const m of metrics) {
      const score = m.prepare(history, date);
      const out = signals.get(m.name)!;
      for (let g = i; g < j; g++) {
        const v = score(games[g]!.homeId, games[g]!.awayId);
        out[g] = Number.isFinite(v) ? v : 0;
      }
    }
    for (let g = i; g < j; g++) {
      const game = games[g]!;
      y[g] = homeResult(game);
      priorHome[g] = history.team(game.homeId).length;
      priorAway[g] = history.team(game.awayId).length;
    }
    for (let g = i; g < j; g++) history.add(games[g]!);
    i = j;
  }
  dateStarts.push(n);
  return { games, y, priorHome, priorAway, dateStarts, signals };
}

export interface CalibrationOptions {
  /** Past games enter the calibration fit once both sides had this many prior games. */
  calibMinPrior?: number;
  l2?: number;
  /** Separate fit per birth year when that year has at least `groupMin` calibration games. */
  byBirthYear?: boolean;
  groupMin?: number;
}

/**
 * Walk-forward probabilities for one or more signals. Games on date d use a model fit only on games before d.
 * Returns NaN where no fit is possible yet.
 */
export function walkForward(table: FeatureTable, features: Float64Array[], opts: CalibrationOptions = {}): Float64Array {
  const k = features.length;
  const n = table.games.length;
  const minPrior = opts.calibMinPrior ?? 2;
  const l2 = opts.l2 ?? 1;
  const groupMin = opts.groupMin ?? 150;
  const p = new Float64Array(n).fill(NaN);
  const groups = table.games.map((g) => birthYear(g.homeDiv));
  const pastIdx: number[] = [];
  const row = new Float64Array(k);
  for (let d = 0; d + 1 < table.dateStarts.length; d++) {
    const start = table.dateStarts[d]!;
    const end = table.dateStarts[d + 1]!;
    if (pastIdx.length >= 30) {
      const fit = (idx: number[]) => {
        const X = new Float64Array(idx.length * k);
        const y = new Float64Array(idx.length);
        idx.forEach((gi, r) => {
          for (let f = 0; f < k; f++) X[r * k + f] = features[f]![gi]!;
          y[r] = table.y[gi]!;
        });
        return fitLogistic(X, y, idx.length, k, l2);
      };
      const pooled = fit(pastIdx);
      const perGroup = new Map<string, ReturnType<typeof fit>>();
      if (opts.byBirthYear) {
        const byGroup = new Map<string, number[]>();
        for (const gi of pastIdx) {
          const list = byGroup.get(groups[gi]!) ?? [];
          list.push(gi);
          byGroup.set(groups[gi]!, list);
        }
        for (const [g, idx] of byGroup) if (idx.length >= groupMin) perGroup.set(g, fit(idx));
      }
      for (let gi = start; gi < end; gi++) {
        for (let f = 0; f < k; f++) row[f] = features[f]![gi]!;
        p[gi] = predictLogistic(perGroup.get(groups[gi]!) ?? pooled, row);
      }
    }
    for (let gi = start; gi < end; gi++) {
      if (table.priorHome[gi]! >= minPrior && table.priorAway[gi]! >= minPrior) pastIdx.push(gi);
    }
  }
  return p;
}

export interface Score {
  n: number;
  /** Correct side of 0.5; ties and exact 0.5 predictions count half. */
  accuracy: number;
  logLoss: number;
  brier: number;
}

export function scoreGames(p: Float64Array, y: Float64Array, idx: number[]): Score {
  let acc = 0;
  let ll = 0;
  let br = 0;
  let n = 0;
  for (const i of idx) {
    const pi = p[i]!;
    if (!Number.isFinite(pi)) continue;
    const yi = y[i]!;
    const q = Math.min(1 - 1e-6, Math.max(1e-6, pi));
    n++;
    acc += yi === 0.5 || pi === 0.5 ? 0.5 : (pi > 0.5) === (yi === 1) ? 1 : 0;
    ll += -(yi * Math.log(q) + (1 - yi) * Math.log(1 - q));
    br += (pi - yi) ** 2;
  }
  return n ? { n, accuracy: acc / n, logLoss: ll / n, brier: br / n } : { n: 0, accuracy: NaN, logLoss: NaN, brier: NaN };
}

export interface Split {
  eligible: number[];
  train: number[];
  holdout: number[];
}

/** Games where both teams had played at least `minPrior` games, split chronologically. */
export function splitEligible(table: FeatureTable, minPrior = 5, trainFraction = 0.6): Split {
  const eligible: number[] = [];
  for (let i = 0; i < table.games.length; i++) {
    if (table.priorHome[i]! >= minPrior && table.priorAway[i]! >= minPrior) eligible.push(i);
  }
  // Cut on a date boundary so no date straddles train and holdout.
  let cut = Math.floor(eligible.length * trainFraction);
  while (cut < eligible.length && cut > 0 && table.games[eligible[cut]!]!.date === table.games[eligible[cut - 1]!]!.date) cut++;
  return { eligible, train: eligible.slice(0, cut), holdout: eligible.slice(cut) };
}

export interface MetricResult {
  name: string;
  family: string;
  complexity: number;
  kind: "calibrated" | "raw" | "combo";
  features?: string[];
  train: Score;
  holdout: Score;
  all: Score;
  /** Holdout and full-eligible scores per birth year. */
  byBirthYear: Record<string, { holdout: Score; all: Score }>;
}

export function evaluate(
  table: FeatureTable,
  split: Split,
  name: string,
  meta: Pick<MetricResult, "family" | "complexity" | "kind" | "features">,
  p: Float64Array,
): MetricResult {
  const years = new Map<string, { holdout: number[]; all: number[] }>();
  const hold = new Set(split.holdout);
  for (const i of split.eligible) {
    const yr = birthYear(table.games[i]!.homeDiv);
    const entry = years.get(yr) ?? { holdout: [], all: [] };
    entry.all.push(i);
    if (hold.has(i)) entry.holdout.push(i);
    years.set(yr, entry);
  }
  const byBirthYear: MetricResult["byBirthYear"] = {};
  for (const [yr, e] of [...years].sort()) byBirthYear[yr] = { holdout: scoreGames(p, table.y, e.holdout), all: scoreGames(p, table.y, e.all) };
  return {
    name,
    ...meta,
    train: scoreGames(p, table.y, split.train),
    holdout: scoreGames(p, table.y, split.holdout),
    all: scoreGames(p, table.y, split.eligible),
    byBirthYear,
  };
}

export function evaluateMetric(table: FeatureTable, split: Split, metric: Metric, opts: CalibrationOptions = {}): MetricResult[] {
  const x = table.signals.get(metric.name)!;
  const results = [evaluate(table, split, metric.name, { family: metric.family, complexity: metric.complexity, kind: "calibrated" }, walkForward(table, [x], opts))];
  if (metric.rawProbability) {
    const raw = Float64Array.from(x, metric.rawProbability);
    results.push(evaluate(table, split, `${metric.name}:uncalibrated`, { family: metric.family, complexity: metric.complexity, kind: "raw" }, raw));
  }
  return results;
}

export function evaluateCombo(table: FeatureTable, split: Split, spec: ComboSpec, complexity: (name: string) => number): MetricResult {
  const features = spec.features.map((f) => {
    const s = table.signals.get(f);
    if (!s) throw new Error(`combo ${spec.name}: unknown feature ${f}`);
    return s;
  });
  const p = walkForward(table, features, { l2: spec.l2, byBirthYear: spec.byBirthYear });
  const cx = spec.features.reduce((sum, f) => sum + complexity(f), 0) + (spec.byBirthYear ? 2 : 1);
  return evaluate(table, split, spec.name, { family: "combo", complexity: cx, kind: "combo", features: spec.features }, p);
}
