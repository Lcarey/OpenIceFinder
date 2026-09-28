/**
 * Matchup-only prediction: how well can you call a game knowing nothing but how these two teams did against
 * each other? Compared on the same games against the rating, walk-forward (past meetings only) and in hindsight
 * (every other meeting of the season). Also checks for matchup effects the rating misses.
 */
import { History } from "./games.js";
import { scoreGames, walkForward, type FeatureTable, type Score, type Split } from "./harness.js";
import { fitLogistic, predictLogistic } from "./linalg.js";
import { masseyRatings } from "./ratings.js";

function pairKey(a: string, b: string): string {
  return a < b ? `${a}|${b}` : `${b}|${a}`;
}

/** Result for `homeId` from a stored game's point of view. */
function resultFor(table: FeatureTable, j: number, homeId: string): number {
  const g = table.games[j]!;
  return g.homeId === homeId ? table.y[j]! : 1 - table.y[j]!;
}

function marginFor(table: FeatureTable, j: number, homeId: string): number {
  const g = table.games[j]!;
  const m = g.homeGoals - g.awayGoals;
  return g.homeId === homeId ? m : -m;
}

/** Share of points from meetings, pulled toward 0.5 by one phantom tie. */
function pairProb(results: number[]): number {
  return (results.reduce((a, b) => a + b, 0) + 0.5) / (results.length + 1);
}

function corr(x: number[], y: number[]): number {
  const n = x.length;
  const mx = x.reduce((a, b) => a + b, 0) / n;
  const my = y.reduce((a, b) => a + b, 0) / n;
  let sxy = 0;
  let sxx = 0;
  let syy = 0;
  for (let i = 0; i < n; i++) {
    sxy += (x[i]! - mx) * (y[i]! - my);
    sxx += (x[i]! - mx) ** 2;
    syy += (y[i]! - my) ** 2;
  }
  return sxy / Math.sqrt(sxx * syy);
}

export interface PairStudy {
  eligible: number;
  meetingsPerPair: Record<string, number>;
  walkForward: { games: number; coverage: number; pairOnly: Score; rating: Score; ratingAllEligible: Score };
  hindsight: { games: number; coverage: number; pairOnly: Score; rating: Score };
  repeat: { pairs: number; consecutive: number; sameWinner: number; flipped: number; involvedTie: number };
  matchupEffect: { games: number; correlation: number; slope: number };
}

export function pairStudy(table: FeatureTable, split: Split, ratingName: string): PairStudy {
  const n = table.games.length;
  const byPair = new Map<string, number[]>();
  for (let i = 0; i < n; i++) {
    const g = table.games[i]!;
    const k = pairKey(g.homeId, g.awayId);
    const list = byPair.get(k) ?? [];
    list.push(i);
    byPair.set(k, list);
  }
  const meetingsPerPair: Record<string, number> = {};
  for (const list of byPair.values()) meetingsPerPair[String(list.length)] = (meetingsPerPair[String(list.length)] ?? 0) + 1;

  // Walk-forward: only meetings on earlier dates.
  const ratingP = walkForward(table, [table.signals.get(ratingName)!]);
  const pairPast = new Float64Array(n).fill(NaN);
  const wfIdx: number[] = [];
  for (const i of split.eligible) {
    const g = table.games[i]!;
    const past = byPair.get(pairKey(g.homeId, g.awayId))!.filter((j) => table.games[j]!.date < g.date);
    if (!past.length) continue;
    pairPast[i] = pairProb(past.map((j) => resultFor(table, j, g.homeId)));
    wfIdx.push(i);
  }

  // Hindsight: every other meeting of the season, against leave-one-out ratings on the same games.
  const pairOther = new Float64Array(n).fill(NaN);
  const hsIdx: number[] = [];
  const looSignal = new Float64Array(n).fill(NaN);
  const last = table.games[n - 1]!.date;
  const resid: number[] = [];
  const otherResid: number[] = [];
  for (const i of split.eligible) {
    const g = table.games[i]!;
    const others = byPair.get(pairKey(g.homeId, g.awayId))!.filter((j) => j !== i);
    if (!others.length) continue;
    pairOther[i] = pairProb(others.map((j) => resultFor(table, j, g.homeId)));
    hsIdx.push(i);
    const m = masseyRatings(new History(table.games.filter((_, j) => j !== i)), last, { cap: 8, lambda: 1, target: "margin" });
    const predictFor = (homeId: string, awayId: string) => m.rating(homeId) - m.rating(awayId) + m.hfa;
    looSignal[i] = predictFor(g.homeId, g.awayId);
    // Matchup effect: does this pair's miss in other meetings predict the miss in this one?
    resid.push(g.homeGoals - g.awayGoals - looSignal[i]!);
    const om = others.map((j) => {
      const o = table.games[j]!;
      const expected = o.homeId === g.homeId ? predictFor(o.homeId, o.awayId) : -predictFor(o.homeId, o.awayId);
      return marginFor(table, j, g.homeId) - expected;
    });
    otherResid.push(om.reduce((a, b) => a + b, 0) / om.length);
  }
  const X = Float64Array.from(hsIdx, (i) => looSignal[i]!);
  const Y = Float64Array.from(hsIdx, (i) => table.y[i]!);
  const cal = fitLogistic(X, Y, hsIdx.length, 1, 1);
  const looP = new Float64Array(n).fill(NaN);
  for (const i of hsIdx) looP[i] = predictLogistic(cal, [looSignal[i]!]);

  // Repeat winners across consecutive meetings of the same pair.
  let consecutive = 0;
  let same = 0;
  let flipped = 0;
  let tie = 0;
  let pairs = 0;
  for (const list of byPair.values()) {
    if (list.length < 2) continue;
    pairs++;
    const ref = table.games[list[0]!]!.homeId;
    for (let k = 1; k < list.length; k++) {
      const a = resultFor(table, list[k - 1]!, ref);
      const b = resultFor(table, list[k]!, ref);
      consecutive++;
      if (a === 0.5 || b === 0.5) tie++;
      else if (a === b) same++;
      else flipped++;
    }
  }

  let sxy = 0;
  let sxx = 0;
  const mo = otherResid.reduce((a, b) => a + b, 0) / otherResid.length;
  const mr = resid.reduce((a, b) => a + b, 0) / resid.length;
  for (let k = 0; k < resid.length; k++) {
    sxy += (otherResid[k]! - mo) * (resid[k]! - mr);
    sxx += (otherResid[k]! - mo) ** 2;
  }

  return {
    eligible: split.eligible.length,
    meetingsPerPair,
    walkForward: {
      games: wfIdx.length,
      coverage: wfIdx.length / split.eligible.length,
      pairOnly: scoreGames(pairPast, table.y, wfIdx),
      rating: scoreGames(ratingP, table.y, wfIdx),
      ratingAllEligible: scoreGames(ratingP, table.y, split.eligible),
    },
    hindsight: { games: hsIdx.length, coverage: hsIdx.length / split.eligible.length, pairOnly: scoreGames(pairOther, table.y, hsIdx), rating: scoreGames(looP, table.y, hsIdx) },
    repeat: { pairs, consecutive, sameWinner: same / consecutive, flipped: flipped / consecutive, involvedTie: tie / consecutive },
    matchupEffect: { games: resid.length, correlation: corr(otherResid, resid), slope: sxy / sxx },
  };
}
