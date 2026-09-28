import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { BELIEF_MODEL, fitBeliefModel } from "../belief-model.js";
import { finalCalibration } from "./cli.js";
import { History, type BtGame, type BtSnapshot } from "./games.js";
import { computeFeatures, scoreGames, splitEligible, walkForward } from "./harness.js";
import { fitLogistic, predictLogistic } from "./linalg.js";
import { candidateMetrics, eloRatings, poissonOutcome, type Metric } from "./metrics.js";
import { masseyRatings } from "./ratings.js";

let seq = 0;
function g(date: string, homeId: string, awayId: string, homeGoals: number, awayGoals: number): BtGame {
  seq++;
  return { id: `${date}|${seq}`, date, time: "10:00", homeId, awayId, homeName: homeId, awayName: awayId, homeGoals, awayGoals, homeDiv: "2016 Red", awayDiv: "2016 Red" };
}

/** Sixteen dates, every team plays once per date; A is strongest. */
function season(): BtGame[] {
  const out: BtGame[] = [];
  for (let w = 0; w < 8; w++) {
    const day = `2025-10-${String(1 + w * 2).padStart(2, "0")}`;
    out.push(g(day, "A", "B", 4, 2), g(day, "C", "D", 1, 3));
    const day2 = `2025-10-${String(2 + w * 2).padStart(2, "0")}`;
    out.push(g(day2, "B", "C", 3, 1), g(day2, "D", "A", 1, 5));
  }
  return out;
}

const peek: Metric = {
  name: "peek:last-game-winner",
  family: "test",
  complexity: 0,
  prepare(history) {
    return (home) => {
      const games = history.team(home);
      return games.length ? games[games.length - 1]!.result - 0.5 : 0;
    };
  },
};

describe("walk-forward harness", () => {
  it("never shows a metric games from the target date or later", () => {
    const games = season();
    const seen: Array<{ date: string; latest: string }> = [];
    const spy: Metric = {
      name: "spy",
      family: "test",
      complexity: 0,
      prepare(history, date) {
        seen.push({ date, latest: history.games[history.games.length - 1]?.date ?? "" });
        return () => 0;
      },
    };
    computeFeatures(games, [spy]);
    expect(seen.length).toBe(16);
    for (const s of seen) expect(s.latest < s.date).toBe(true);
  });

  it("keeps predictions fixed when a future result is flipped", () => {
    const games = season();
    const before = computeFeatures(games, [peek]).signals.get(peek.name)!;
    const flipped = games.map((x) => (x.date === "2025-10-16" ? { ...x, homeGoals: x.awayGoals, awayGoals: x.homeGoals } : x));
    const after = computeFeatures(flipped, [peek]).signals.get(peek.name)!;
    const table = computeFeatures(games, [peek]);
    for (let i = 0; i < table.games.length; i++) {
      if (table.games[i]!.date <= "2025-10-16") expect(after[i]).toBe(before[i]);
    }
  });

  it("scores only games where both teams have five prior games, split on a date boundary", () => {
    const table = computeFeatures(season(), [peek]);
    const split = splitEligible(table, 5, 0.6);
    for (const i of split.eligible) {
      expect(table.priorHome[i]).toBeGreaterThanOrEqual(5);
      expect(table.priorAway[i]).toBeGreaterThanOrEqual(5);
    }
    expect(split.eligible.length).toBe(22);
    const lastTrain = table.games[split.train[split.train.length - 1]!]!.date;
    const firstHold = table.games[split.holdout[0]!]!.date;
    expect(lastTrain < firstHold).toBe(true);
  });

  it("counts ties and 50/50 calls as half right", () => {
    const p = Float64Array.from([0.9, 0.2, 0.5, 0.7]);
    const y = Float64Array.from([1, 1, 0, 0.5]);
    expect(scoreGames(p, y, [0, 1, 2, 3]).accuracy).toBeCloseTo((1 + 0 + 0.5 + 0.5) / 4);
  });

  it("calibrates only on earlier dates", () => {
    const table = computeFeatures(season(), [peek]);
    const p = walkForward(table, [table.signals.get(peek.name)!], { calibMinPrior: 0 });
    expect(Number.isNaN(p[0])).toBe(true);
  });
});

describe("metrics", () => {
  it("Massey recovers margins on a consistent schedule", () => {
    const h = new History([g("2025-10-01", "A", "B", 3, 1), g("2025-10-02", "B", "A", 1, 3), g("2025-10-03", "B", "C", 4, 2), g("2025-10-04", "C", "B", 2, 4)]);
    const m = masseyRatings(h, "2025-10-05", { cap: 8, lambda: 1e-6, target: "margin" });
    expect(m.hfa).toBeCloseTo(0, 5);
    expect(m.rating("A") - m.rating("B")).toBeCloseTo(2, 4);
    expect(m.rating("B") - m.rating("C")).toBeCloseTo(2, 4);
  });

  it("Elo moves ratings by K times the surprise", () => {
    const r = eloRatings(new History([g("2025-10-01", "A", "B", 3, 1)]), { k: 20, hfa: 0, mov: "none" });
    expect(r("A")).toBeCloseTo(1510);
    expect(r("B")).toBeCloseTo(1490);
  });

  it("Poisson outcome probabilities sum to one and favour the stronger side", () => {
    const o = poissonOutcome(4, 2);
    expect(o.win + o.tie + o.loss).toBeCloseTo(1, 6);
    expect(o.win).toBeGreaterThan(o.loss);
  });

  it("logistic regression learns a clean signal", () => {
    const X = Float64Array.from({ length: 200 }, (_, i) => (i % 2 ? 1 : -1) * (1 + (i % 7)));
    const y = Float64Array.from(X, (x) => (x > 0 ? 1 : 0));
    const m = fitLogistic(X, y, 200, 1, 1);
    expect(predictLogistic(m, [3])).toBeGreaterThan(0.9);
    expect(predictLogistic(m, [-3])).toBeLessThan(0.1);
  });

  it("offers at least 100 distinct candidates", () => {
    const names = candidateMetrics().map((m) => m.name);
    expect(new Set(names).size).toBe(names.length);
    expect(names.length).toBeGreaterThanOrEqual(100);
  });
});

describe("shipped belief model", () => {
  const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
  const snapshot = JSON.parse(readFileSync(path.join(repoRoot, "data", "backtest", "elite9-2025-26.json"), "utf8")) as BtSnapshot;

  it("uses the calibration fitted on the 2025-26 snapshot", () => {
    const winner = candidateMetrics().find((m) => m.name === BELIEF_MODEL.metric)!;
    const cal = finalCalibration(computeFeatures(snapshot.games, [winner]), winner.name);
    expect(cal.intercept).toBeCloseTo(BELIEF_MODEL.intercept, 3);
    expect(cal.slope).toBeCloseTo(BELIEF_MODEL.slope, 3);
  });

  it("predicts from games before the date and favours the stronger team", () => {
    const model = fitBeliefModel(season(), "2025-10-17");
    const ab = model.predict("A", "B");
    expect(ab.pHome).toBeGreaterThan(0.5);
    expect(ab.homeGames).toBe(16);
    expect(fitBeliefModel(season(), "2025-10-01").predict("A", "B").homeGames).toBe(0);
  });
});
