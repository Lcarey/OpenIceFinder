/**
 * Descriptive analysis for the backtest report: how predictable each age group and tier is, calibration of the
 * winning metric, how fast it learns, and which signals add anything on top of it.
 */
import { birthYear, divisionTier, History, homeResult } from "./games.js";
import { scoreGames, walkForward, type FeatureTable, type MetricResult, type Split } from "./harness.js";
import { masseyRatings } from "./metrics.js";

function sd(values: number[]): number {
  if (values.length < 2) return 0;
  const m = values.reduce((a, b) => a + b, 0) / values.length;
  return Math.sqrt(values.reduce((a, b) => a + (b - m) ** 2, 0) / (values.length - 1));
}

const mean = (values: number[]) => (values.length ? values.reduce((a, b) => a + b, 0) / values.length : NaN);

export interface GroupStats {
  group: string;
  games: number;
  eligible: number;
  accuracy: number;
  logLoss: number;
  tieRate: number;
  homePointsPct: number;
  meanAbsMargin: number;
  blowoutRate: number;
  /** Favourite (p > 0.5) lost a decisive game. */
  upsetRate: number;
  /** RMSE of actual goal margin vs the pre-game Massey prediction. Game-to-game noise. */
  marginNoise: number;
  /** Mean within-division SD of end-of-season Massey ratings. Talent spread. */
  talentSpread: number;
  /** Spread divided by noise: higher means outcomes are more determined by who is better. */
  signalToNoise: number;
}

export function analyze(table: FeatureTable, split: Split, winner: string, results: MetricResult[]) {
  const signal = table.signals.get(winner)!;
  const p = walkForward(table, [signal]);
  const n = table.games.length;

  // End-of-season ratings for talent spread.
  const full = new History(table.games);
  const lastDate = table.games[n - 1]!.date;
  const final = masseyRatings(full, lastDate, { cap: 8, lambda: 1, target: "margin" });
  const teamDiv = new Map<string, string>();
  for (const g of table.games) {
    teamDiv.set(g.homeId, g.homeDiv);
    teamDiv.set(g.awayId, g.awayDiv);
  }
  const byDivision = new Map<string, number[]>();
  for (const [id, div] of teamDiv) {
    const list = byDivision.get(div) ?? [];
    list.push(final.rating(id));
    byDivision.set(div, list);
  }

  const groupStats = (label: (div: string) => string): GroupStats[] => {
    const groups = new Map<string, number[]>();
    for (let i = 0; i < n; i++) {
      const key = label(table.games[i]!.homeDiv);
      const list = groups.get(key) ?? [];
      list.push(i);
      groups.set(key, list);
    }
    const eligibleSet = new Set(split.eligible);
    return [...groups]
      .sort(([a], [b]) => a.localeCompare(b))
      .map(([group, idx]) => {
        const elig = idx.filter((i) => eligibleSet.has(i));
        const score = scoreGames(p, table.y, elig);
        const margins = idx.map((i) => table.games[i]!.homeGoals - table.games[i]!.awayGoals);
        let upsets = 0;
        let decisive = 0;
        const resid: number[] = [];
        for (const i of elig) {
          const g = table.games[i]!;
          const m = g.homeGoals - g.awayGoals;
          resid.push(m - signal[i]!);
          if (m === 0 || p[i] === 0.5) continue;
          decisive++;
          if (p[i]! > 0.5 !== m > 0) upsets++;
        }
        const spreads = [...byDivision].filter(([div]) => label(div) === group).map(([, r]) => sd(r));
        const noise = Math.sqrt(mean(resid.map((r) => r * r)));
        const spread = mean(spreads);
        return {
          group,
          games: idx.length,
          eligible: elig.length,
          accuracy: score.accuracy,
          logLoss: score.logLoss,
          tieRate: margins.filter((m) => m === 0).length / idx.length,
          homePointsPct: mean(idx.map((i) => homeResult(table.games[i]!))),
          meanAbsMargin: mean(margins.map(Math.abs)),
          blowoutRate: margins.filter((m) => Math.abs(m) >= 5).length / idx.length,
          upsetRate: decisive ? upsets / decisive : NaN,
          marginNoise: noise,
          talentSpread: spread,
          signalToNoise: spread / noise,
        };
      });
  };

  // Calibration on eligible games.
  const bins = Array.from({ length: 10 }, (_, b) => ({ lo: b / 10, hi: (b + 1) / 10, n: 0, predicted: 0, actual: 0 }));
  for (const i of split.eligible) {
    const pi = p[i]!;
    if (!Number.isFinite(pi)) continue;
    const bin = bins[Math.min(9, Math.floor(pi * 10))]!;
    bin.n++;
    bin.predicted += pi;
    bin.actual += table.y[i]!;
  }
  const calibration = bins.filter((b) => b.n > 0).map((b) => ({ ...b, predicted: b.predicted / b.n, actual: b.actual / b.n }));

  // Confidence: accuracy by how lopsided the favourite is.
  const confidence = [
    [0.5, 0.6],
    [0.6, 0.7],
    [0.7, 0.8],
    [0.8, 0.9],
    [0.9, 1.01],
  ].map(([lo, hi]) => {
    const idx = split.eligible.filter((i) => {
      const fav = Math.max(p[i]!, 1 - p[i]!);
      return fav >= lo! && fav < hi!;
    });
    const s = scoreGames(p, table.y, idx);
    const ties = idx.filter((i) => table.y[i] === 0.5).length;
    return { lo, hi: Math.min(1, hi!), n: idx.length, accuracy: s.accuracy, tieRate: idx.length ? ties / idx.length : NaN };
  });

  // Learning curve: accuracy by the fewer games either team had played.
  const learning = [
    [2, 4],
    [5, 9],
    [10, 14],
    [15, 19],
    [20, 40],
  ].map(([lo, hi]) => {
    const idx: number[] = [];
    for (let i = 0; i < n; i++) {
      const k = Math.min(table.priorHome[i]!, table.priorAway[i]!);
      if (k >= lo! && k <= hi!) idx.push(i);
    }
    return { lo, hi, ...scoreGames(p, table.y, idx) };
  });

  // Direction and raw strength of each single signal: home points share when the signal favours home vs away.
  const direction = [...table.signals.keys()].map((name) => {
    const x = table.signals.get(name)!;
    let posN = 0;
    let posY = 0;
    let negN = 0;
    let negY = 0;
    for (const i of split.eligible) {
      if (x[i]! > 1e-9) {
        posN++;
        posY += table.y[i]!;
      } else if (x[i]! < -1e-9) {
        negN++;
        negY += table.y[i]!;
      }
    }
    return { name, favoursHomeN: posN, homeWhenFavoured: posN ? posY / posN : NaN, favoursAwayN: negN, homeWhenNotFavoured: negN ? negY / negN : NaN };
  });

  // Incremental value of adding one signal to the winner.
  const base = results.find((r) => r.name === winner)!;
  const incremental = results
    .filter((r) => r.kind === "combo" && r.features?.length === 2 && r.features[0] === winner)
    .map((r) => ({
      feature: r.features![1]!,
      deltaHoldoutLogLoss: r.holdout.logLoss - base.holdout.logLoss,
      deltaAllLogLoss: r.all.logLoss - base.all.logLoss,
      deltaAllAccuracy: r.all.accuracy - base.all.accuracy,
    }))
    .sort((a, b) => a.deltaAllLogLoss - b.deltaAllLogLoss);

  // Best single metric per family.
  const families = new Map<string, MetricResult>();
  for (const r of results) {
    if (r.kind === "combo") continue;
    const cur = families.get(r.family);
    if (!cur || r.all.logLoss < cur.all.logLoss) families.set(r.family, r);
  }

  return {
    winner,
    byBirthYear: groupStats(birthYear),
    byTier: groupStats(divisionTier),
    calibration,
    confidence,
    learning,
    direction,
    incremental,
    familyBest: [...families.values()].sort((a, b) => a.all.logLoss - b.all.logLoss).map((r) => ({ name: r.name, family: r.family, all: r.all, holdout: r.holdout, train: r.train })),
    homeRatingEdge: final.hfa,
  };
}
