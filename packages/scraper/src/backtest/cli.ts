#!/usr/bin/env node
/**
 * Belief backtest: walk-forward evaluation of every candidate metric on last season's Elite 9 results.
 *
 * Usage: npm run backtest:belief [-- --top 25]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { analyze } from "./analysis.js";
import type { BtSnapshot } from "./games.js";
import { computeFeatures, evaluateCombo, evaluateMetric, splitEligible, type FeatureTable, type MetricResult } from "./harness.js";
import { fitLogistic } from "./linalg.js";
import { baselineMetrics, candidateMetrics, comboSpecs } from "./metrics.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

const pct = (x: number) => `${(100 * x).toFixed(1)}%`;
const f3 = (x: number) => x.toFixed(4);

function row(r: MetricResult): string {
  return `${r.name.padEnd(46)} ${pct(r.train.accuracy).padStart(6)} ${f3(r.train.logLoss)}   ${pct(r.holdout.accuracy).padStart(6)} ${f3(r.holdout.logLoss)} ${f3(r.holdout.brier)}`;
}

/** Full-season calibration of one signal: P(home points share) = sigmoid(intercept + slope · signal). */
export function finalCalibration(table: FeatureTable, name: string, minPrior = 2): { intercept: number; slope: number; games: number } {
  const x = table.signals.get(name)!;
  const idx: number[] = [];
  for (let i = 0; i < table.games.length; i++) if (table.priorHome[i]! >= minPrior && table.priorAway[i]! >= minPrior) idx.push(i);
  const X = Float64Array.from(idx, (i) => x[i]!);
  const y = Float64Array.from(idx, (i) => table.y[i]!);
  const m = fitLogistic(X, y, idx.length, 1, 1);
  const slope = m.beta[1]! / m.sd[0]!;
  return { intercept: m.beta[0]! - slope * m.mean[0]!, slope, games: idx.length };
}

export async function runBacktest(log: (m: string) => void = () => {}) {
  const snapshot = JSON.parse(await readFile(path.join(repoRoot, "data", "backtest", "elite9-2025-26.json"), "utf8")) as BtSnapshot;
  const baselines = baselineMetrics();
  const candidates = candidateMetrics();
  const metrics = [...baselines, ...candidates];
  const started = Date.now();
  const table = computeFeatures(snapshot.games, metrics, (date, i) => {
    if (i % 20 === 0) log(`  features through ${date} (${((Date.now() - started) / 1000).toFixed(0)}s)`);
  });
  const split = splitEligible(table);
  const results: MetricResult[] = [];
  for (const m of metrics) results.push(...evaluateMetric(table, split, m));
  const complexity = new Map(metrics.map((m) => [m.name, m.complexity]));
  for (const spec of comboSpecs()) results.push(evaluateCombo(table, split, spec, (n) => complexity.get(n) ?? 1));
  return { snapshot, table, split, results, candidates: candidates.length };
}

async function main() {
  const top = Number(arg("--top") ?? "25");
  const log = (m: string) => process.stderr.write(`${m}\n`);
  const { snapshot, table, split, results, candidates } = await runBacktest(log);
  const isBaseline = (r: MetricResult) => r.family === "baseline";
  const ranked = results.filter((r) => !isBaseline(r)).sort((a, b) => a.train.logLoss - b.train.logLoss);
  const finalists = ranked.slice(0, 10);
  const best = Math.min(...finalists.map((r) => r.holdout.logLoss));
  const winner = finalists
    .filter((r) => r.holdout.logLoss <= best + 0.002)
    .sort((a, b) => a.complexity - b.complexity || a.holdout.logLoss - b.holdout.logLoss)[0]!;

  log(`\n${snapshot.games.length} games, ${split.eligible.length} eligible (both teams ≥5 prior games): ${split.train.length} train, ${split.holdout.length} holdout`);
  log(`holdout starts ${table.games[split.holdout[0]!]!.date}; ${results.length} scored variants from ${candidates} candidate metrics\n`);
  log(`${"metric".padEnd(46)} ${"train acc".padStart(6)} logloss   ${"hold acc".padStart(6)} logloss brier`);
  for (const r of results.filter(isBaseline)) log(row(r));
  log("");
  for (const r of ranked.slice(0, top)) log(row(r));
  log(`\nwinner: ${winner.name} (complexity ${winner.complexity})`);
  for (const [yr, s] of Object.entries(winner.byBirthYear)) log(`  ${yr}: holdout ${pct(s.holdout.accuracy)} n=${s.holdout.n} · all ${pct(s.all.accuracy)} ll ${f3(s.all.logLoss)} n=${s.all.n}`);

  const calibration = finalCalibration(table, winner.name);
  log(`shipped calibration for ${winner.name}: intercept ${calibration.intercept.toFixed(4)}, slope ${calibration.slope.toFixed(4)} (${calibration.games} games)`);

  const out = path.join(repoRoot, "data", "backtest", "results.json");
  await writeFile(
    out,
    `${JSON.stringify(
      {
        generatedAt: new Date().toISOString(),
        season: snapshot.seasonLabel,
        games: snapshot.games.length,
        eligible: split.eligible.length,
        train: split.train.length,
        holdout: split.holdout.length,
        holdoutStarts: table.games[split.holdout[0]!]!.date,
        candidateMetrics: candidates,
        scoredVariants: results.length,
        winner: winner.name,
        calibration,
        finalists: finalists.map((r) => r.name),
        results: [...results].sort((a, b) => a.train.logLoss - b.train.logLoss),
      },
      null,
      1,
    )}\n`,
  );
  log(`wrote ${path.relative(repoRoot, out)}`);

  const analysis = analyze(table, split, winner.name, results);
  const analysisOut = path.join(repoRoot, "data", "backtest", "analysis.json");
  await writeFile(analysisOut, `${JSON.stringify(analysis, null, 1)}\n`);
  log(`wrote ${path.relative(repoRoot, analysisOut)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
