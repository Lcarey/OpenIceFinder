/**
 * Deliberately cheating upper bounds for the backtest. These use future games, so they are never candidates;
 * they show how much room is left above the honest walk-forward score.
 */
import { History } from "./games.js";
import { scoreGames, type FeatureTable, type Score, type Split } from "./harness.js";
import { fitLogistic, predictLogistic } from "./linalg.js";
import { masseyRatings } from "./ratings.js";

export interface CeilingResult {
  name: string;
  description: string;
  eligible: Score;
  holdout: Score;
}

function calibrateInSample(signal: Float64Array, table: FeatureTable, idx: number[]): Float64Array {
  const X = Float64Array.from(idx, (i) => signal[i]!);
  const y = Float64Array.from(idx, (i) => table.y[i]!);
  const m = fitLogistic(X, y, idx.length, 1, 1);
  const p = new Float64Array(table.games.length).fill(NaN);
  for (const i of idx) p[i] = predictLogistic(m, [signal[i]!]);
  return p;
}

export function ceilings(table: FeatureTable, split: Split): CeilingResult[] {
  const n = table.games.length;
  const last = table.games[n - 1]!.date;
  const opts = { cap: 8, lambda: 1, target: "margin" as const };

  const full = masseyRatings(new History(table.games), last, opts);
  const hindsight = new Float64Array(n);
  for (let i = 0; i < n; i++) {
    const g = table.games[i]!;
    hindsight[i] = full.rating(g.homeId) - full.rating(g.awayId) + full.hfa;
  }

  const loo = new Float64Array(n);
  for (const i of split.eligible) {
    const others = table.games.filter((_, j) => j !== i);
    const m = masseyRatings(new History(others), last, opts);
    const g = table.games[i]!;
    loo[i] = m.rating(g.homeId) - m.rating(g.awayId) + m.hfa;
  }

  const ties = split.eligible.filter((i) => table.y[i] === 0.5).length / split.eligible.length;
  const perfect = Float64Array.from(table.y, (y) => (y === 0.5 ? 0.5 : y === 1 ? 1 - 1e-6 : 1e-6));
  const out: CeilingResult[] = [
    {
      name: "ceiling:leave-one-out",
      description: "Ratings from every other game of the season, past and future. Knows each team's true strength but not this result.",
      ...pair(calibrateInSample(loo, table, split.eligible)),
    },
    {
      name: "ceiling:hindsight",
      description: "Ratings from the whole season including this game, calibrated on the same games.",
      ...pair(calibrateInSample(hindsight, table, split.eligible)),
    },
    {
      name: "ceiling:oracle",
      description: `Knows every result. Ties still count half, so the most any predictor can score is ${(100 * (1 - ties / 2)).toFixed(1)}%.`,
      ...pair(perfect),
    },
  ];
  return out;

  function pair(p: Float64Array) {
    return { eligible: scoreGames(p, table.y, split.eligible), holdout: scoreGames(p, table.y, split.holdout) };
  }
}
