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
import { ceilings } from "./ceiling.js";
import { pairStudy } from "./pairs.js";
import type { BtSnapshot } from "./games.js";
import { computeFeatures, evaluateCombo, evaluateMetric, scoreGames, splitEligible, type FeatureTable, type MetricResult, type Split } from "./harness.js";
import { fitLogistic } from "./linalg.js";
import { fitOrderedLogit, sigmoid } from "./linalg.js";
import { baselineMetrics, candidateMetrics, comboSpecs } from "./metrics.js";
import { buildPriors, compactPriorSources, mergeMhr, type MhrSnapshot } from "./priors.js";
import { tieStudy } from "./ties.js";

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

const MARGIN_FAMILIES = new Set(["massey", "massey+prior", "kalman", "kalman+prior"]);

async function readData<T>(name: string): Promise<T | undefined> {
  try {
    return JSON.parse(await readFile(path.join(repoRoot, "data", "backtest", name), "utf8")) as T;
  } catch {
    return undefined;
  }
}

/** Walk-forward-free calibration from the previous season, used to score early-season games honestly. */
export function priorSeasonCalibration(prev: BtSnapshot) {
  const winner = candidateMetrics().find((m) => m.name === "massey:cap8:l1")!;
  return finalCalibration(computeFeatures(prev.games, [winner]), winner.name);
}

export async function runBacktest(log: (m: string) => void = () => {}) {
  const snapshot = (await readData<BtSnapshot>("elite9-2025-26.json"))!;
  const prev = await readData<BtSnapshot>("elite9-2024-25.json");
  const mhr = mergeMhr(await readData<MhrSnapshot>("mhr-e9-2024-25.json"), await readData<MhrSnapshot>("mhr-usa-2024-25.json"));
  const priorBuild = buildPriors(snapshot.games, prev?.games, mhr);
  log(`priors: ${JSON.stringify(priorBuild.coverage)}`);
  const baselines = baselineMetrics();
  const candidates = candidateMetrics({ priors: priorBuild.priors });
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

  // Early season: games before both teams have five results, scored with last season's calibration.
  const cal = prev ? priorSeasonCalibration(prev) : { intercept: 0, slope: 0.52, games: 0 };
  const early: number[] = [];
  const all: number[] = [];
  for (let i = 0; i < table.games.length; i++) {
    all.push(i);
    if (Math.min(table.priorHome[i]!, table.priorAway[i]!) < 5) early.push(i);
  }
  const earlyResults = metrics
    .filter((m) => MARGIN_FAMILIES.has(m.family))
    .map((m) => {
      const x = table.signals.get(m.name)!;
      const p = Float64Array.from(x, (v) => sigmoid(cal.intercept + cal.slope * v));
      return { name: m.name, family: m.family, early: scoreGames(p, table.y, early), season: scoreGames(p, table.y, all) };
    })
    .sort((a, b) => a.early.logLoss - b.early.logLoss);
  return { snapshot, table, split, results, candidates: candidates.length, priorBuild, earlyResults, earlyCalibration: cal, earlyGames: early.length };
}

/** The scout cards ship the prior-seeded rating: it ties the winner once teams have five games and wins before that. */
export const SHIPPED_METRIC = "massey+prior:blend:rho0.25:l1";

async function writeShippedModel(
  table: FeatureTable,
  results: MetricResult[],
  winner: MetricResult,
  earlyResults: Array<{ name: string; early: { logLoss: number } }>,
  snapshot: BtSnapshot,
) {
  const ship = results.find((r) => r.name === SHIPPED_METRIC)!;
  const shipEarly = earlyResults.find((r) => r.name === SHIPPED_METRIC)!;
  const plainEarly = earlyResults.find((r) => r.name === winner.name)!;
  if (ship.train.logLoss > winner.train.logLoss + 0.001 || shipEarly.early.logLoss >= plainEarly.early.logLoss) {
    throw new Error(`${SHIPPED_METRIC} no longer ties the winner after five games and beats it early; revisit the shipped metric`);
  }
  const calibration = finalCalibration(table, SHIPPED_METRIC);
  const x = table.signals.get(SHIPPED_METRIC)!;
  const idx: number[] = [];
  for (let i = 0; i < table.games.length; i++) if (table.priorHome[i]! >= 2 && table.priorAway[i]! >= 2) idx.push(i);
  const ordered = fitOrderedLogit(x, table.y, idx);
  // 80% band for the goal differential: 10th and 90th percentiles of (actual − predicted), early and later games.
  const band = (keep: (i: number) => boolean) => {
    const res: number[] = [];
    for (let i = 0; i < table.games.length; i++) {
      if (!keep(i)) continue;
      const g = table.games[i]!;
      res.push(g.homeGoals - g.awayGoals - x[i]!);
    }
    res.sort((a, b) => a - b);
    const q = (p: number) => res[Math.min(res.length - 1, Math.floor(p * res.length))]!;
    return { q10: q(0.1), q90: q(0.9), games: res.length };
  };
  const minGames = (i: number) => Math.min(table.priorHome[i]!, table.priorAway[i]!);
  const marginBand = { early: band((i) => minGames(i) < 5), later: band((i) => minGames(i) >= 5) };
  const mhr = mergeMhr(await readData<MhrSnapshot>("mhr-e9-2025-26.json"), await readData<MhrSnapshot>("mhr-usa-2025-26.json"));
  const sources = compactPriorSources(snapshot.seasonLabel, snapshot.games, mhr);
  const r4 = (v: number) => Math.round(v * 1e4) / 1e4;
  const body = `// Generated by \`npm run backtest:belief\` (packages/scraper/src/backtest/cli.ts). Do not edit by hand.
import type { PriorSources } from "./backtest/priors.js";

export const SHIPPED_MODEL = {
  metric: ${JSON.stringify(SHIPPED_METRIC)},
  rho: 0.25,
  lambda: 1,
  cap: 8,
  calibration: { intercept: ${r4(calibration.intercept)}, slope: ${r4(calibration.slope)}, games: ${calibration.games} },
  ordered: { slope: ${r4(ordered.slope)}, c1: ${r4(ordered.c1)}, c2: ${r4(ordered.c2)} },
  /** 80% range of (actual − predicted) goal differential; "early" is before either team has five results. */
  marginBand: {
    early: { q10: ${r4(marginBand.early.q10)}, q90: ${r4(marginBand.early.q90)}, games: ${marginBand.early.games} },
    later: { q10: ${r4(marginBand.later.q10)}, q90: ${r4(marginBand.later.q90)}, games: ${marginBand.later.games} },
  },
  trainedOn: ${JSON.stringify(`Elite 9 ${snapshot.seasonLabel}, 2013–2016 birth years`)},
} as const;

/** Last season's ratings, used as quarter-weight pre-season priors for this season's teams. */
export const PRIOR_SOURCES: PriorSources = ${JSON.stringify(sources)};
`;
  await writeFile(path.join(repoRoot, "packages", "scraper", "src", "belief-model.generated.ts"), body);
}

/** CSV of every walk-forward signal per game, for the Python model sweep in scripts/belief_ml.py. */
async function exportFeatures(table: FeatureTable, split: Split, priors: ReturnType<typeof buildPriors>) {
  const names = [...table.signals.keys()];
  const hold = new Set(split.holdout);
  const train = new Set(split.train);
  const header = ["game", "date", "birth_year", "home", "away", "y", "prior_home", "prior_away", "split", "prior_home_e9", "prior_away_e9", "prior_home_mhr", "prior_away_mhr", ...names];
  const rows = [header.join(",")];
  table.games.forEach((g, i) => {
    const ph = priors.priors.get(g.homeId) ?? {};
    const pa = priors.priors.get(g.awayId) ?? {};
    const splitName = train.has(i) ? "train" : hold.has(i) ? "holdout" : "early";
    const cell = (v: number | undefined) => (v == null || !Number.isFinite(v) ? "" : String(Math.round(v * 1e6) / 1e6));
    rows.push(
      [i, g.date, g.homeDiv.slice(0, 4), g.homeId, g.awayId, table.y[i], table.priorHome[i], table.priorAway[i], splitName, cell(ph.e9), cell(pa.e9), cell(ph.mhr), cell(pa.mhr), ...names.map((n) => cell(table.signals.get(n)![i]))].join(","),
    );
  });
  await writeFile(path.join(repoRoot, "data", "backtest", "features.csv"), `${rows.join("\n")}\n`);
}

async function main() {
  const top = Number(arg("--top") ?? "25");
  const log = (m: string) => process.stderr.write(`${m}\n`);
  const { snapshot, table, split, results, candidates, priorBuild, earlyResults, earlyCalibration, earlyGames } = await runBacktest(log);
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

  log(`\nearly season (${earlyGames} games before both teams have 5 results; last season's calibration):`);
  for (const r of earlyResults.slice(0, 12)) log(`  ${r.name.padEnd(46)} early ${pct(r.early.accuracy)} ll ${f3(r.early.logLoss)} · whole season ${pct(r.season.accuracy)} ll ${f3(r.season.logLoss)}`);
  const plain = earlyResults.find((r) => r.name === "massey:cap8:l1");
  if (plain) log(`  ${"(massey:cap8:l1, no prior)".padEnd(46)} early ${pct(plain.early.accuracy)} ll ${f3(plain.early.logLoss)} · whole season ${pct(plain.season.accuracy)} ll ${f3(plain.season.logLoss)}`);

  const ties = tieStudy(table, split, winner.name);
  log("\nwin / tie / loss (3-way log-loss on eligible games):");
  for (const t of ties) log(`  ${t.name.padEnd(30)} ${f3(t.eligible.logLoss)} · holdout ${f3(t.holdout.logLoss)} · predicted ties ${pct(t.eligible.predictedTies)} vs actual ${pct(t.eligible.actualTies)}`);

  await exportFeatures(table, split, priorBuild);
  await writeShippedModel(table, results, winner, earlyResults, snapshot);

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

  const ceiling = ceilings(table, split);
  log("\nceilings (use future games on purpose):");
  for (const c of ceiling) log(`  ${c.name.padEnd(24)} eligible ${pct(c.eligible.accuracy)} ll ${f3(c.eligible.logLoss)} · holdout ${pct(c.holdout.accuracy)}`);
  const pairs = pairStudy(table, split, winner.name);
  log(`\nmatchup only: walk-forward ${pct(pairs.walkForward.pairOnly.accuracy)} vs rating ${pct(pairs.walkForward.rating.accuracy)} on ${pairs.walkForward.games} games (${pct(pairs.walkForward.coverage)} had met before)`);
  log(`  hindsight ${pct(pairs.hindsight.pairOnly.accuracy)} vs leave-one-out rating ${pct(pairs.hindsight.rating.accuracy)} on ${pairs.hindsight.games} games; repeat winner ${pct(pairs.repeat.sameWinner)}, flipped ${pct(pairs.repeat.flipped)}, tie involved ${pct(pairs.repeat.involvedTie)}; matchup effect r=${pairs.matchupEffect.correlation.toFixed(3)}`);
  const analysis = {
    pairs,
    ...analyze(table, split, winner.name, results),
    ceiling,
    priors: { coverage: priorBuild.coverage, matches: priorBuild.matches },
    early: { games: earlyGames, calibration: earlyCalibration, results: earlyResults },
    ties,
  };
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
