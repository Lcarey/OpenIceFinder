#!/usr/bin/env node
/**
 * Local refresh: writes data/rinks/<id>.json, data/index.json, data/classifications.json
 * and appends newly learned classifications to data/classifications.seed.json.
 *
 * Usage: npm run refresh:local -- [--out data] [--rink <id>[,<id>]] [--days 35] [--no-model] [--no-seed]
 */
import { readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { ClassificationTable, RinkIndex } from "@openice/shared";
import { Classifier, mergeTables } from "./classify.js";
import { PROGRAMS, RINKS, SEED_CLASSIFICATIONS } from "./data.js";
import { DEFAULT_OPENAI_MODEL, openAiClientProvider } from "./openai-client.js";
import { refreshAll } from "./refresh.js";
import { LocalStore, persistResult } from "./storage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const outDir = path.resolve(repoRoot, arg("--out") ?? "data");
  const rinkFilter = arg("--rink")?.split(",").map((s) => s.trim()).filter(Boolean);
  const days = Number(arg("--days") ?? "35");
  const useModel = !process.argv.includes("--no-model");
  const updateSeed = !process.argv.includes("--no-seed");
  const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;

  const rinks = rinkFilter ? RINKS.filter((r) => rinkFilter.includes(r.id)) : RINKS;
  const programs = rinkFilter ? PROGRAMS.filter((p) => rinkFilter.includes(p.rinkId)) : PROGRAMS;
  if (rinks.length === 0) throw new Error(`No rinks matched ${rinkFilter?.join(",")}`);

  const store = new LocalStore(outDir);
  const table = mergeTables(SEED_CLASSIFICATIONS, await store.readClassifications());
  const openai = openAiClientProvider();
  const log = (message: string) => process.stderr.write(`${message}\n`);
  const classifier = new Classifier(table, { model, log, ...(useModel ? { openai } : {}) });

  const result = await refreshAll({ rinks, programs, classifier, openai, openaiModel: model, rangeDays: days, log, previousProgramFeed: (id) => store.readProgramFeed(id) });
  if (rinkFilter) {
    // Partial run: keep the other rinks' index entries.
    try {
      const existing = JSON.parse(await readFile(path.join(outDir, "index.json"), "utf8")) as RinkIndex;
      const refreshed = new Set(result.index.rinks.map((r) => r.rink.id));
      result.index.rinks = [...existing.rinks.filter((r) => !refreshed.has(r.rink.id)), ...result.index.rinks].sort(
        (a, b) => a.rink.driveMinutes - b.rink.driveMinutes || a.rink.name.localeCompare(b.rink.name),
      );
      const refreshedPrograms = new Set((result.index.programs ?? []).map((p) => p.program.id));
      const keptPrograms = (existing.programs ?? []).filter((p) => !refreshedPrograms.has(p.program.id));
      const allPrograms = [...keptPrograms, ...(result.index.programs ?? [])];
      if (allPrograms.length > 0) result.index.programs = allPrograms;
    } catch {
      /* no existing index */
    }
  }
  await persistResult(store, result.feeds, result.index, classifier.table, result.programFeeds);

  if (updateSeed && classifier.added.length > 0) {
    const seedFile = path.join(repoRoot, "data", "classifications.seed.json");
    const current = JSON.parse(await readFile(seedFile, "utf8")) as ClassificationTable;
    const merged = mergeTables(current, { version: 1, entries: classifier.added.map((e) => ({ ...e, source: e.source === "model" ? "seed" : e.source })) });
    await writeFile(seedFile, `${JSON.stringify(merged, null, 2)}\n`);
    log(`seed: appended ${classifier.added.length} classifications to ${path.relative(repoRoot, seedFile)}`);
  }

  for (const entry of result.index.rinks) {
    const status = entry.ok ? "ok " : "ERR";
    const next = entry.nextOpenIce ? `${entry.nextOpenIce.start.slice(0, 16)} ${entry.nextOpenIce.title}` : "-";
    process.stdout.write(`${status} ${entry.rink.id.padEnd(28)} ${String(entry.eventCount).padStart(4)} ev ${String(entry.openIceCount).padStart(3)} open  next: ${next}${entry.errors.length ? `  [${entry.errors[0]}]` : ""}\n`);
  }
  for (const entry of result.index.programs ?? []) {
    process.stdout.write(`${entry.ok ? "ok " : "ERR"} program:${entry.program.id.padEnd(20)} ${String(entry.eventCount).padStart(4)} ev ${String(entry.homeEventCount).padStart(4)} at ${entry.program.rinkId} (${entry.teamCount} teams)${entry.errors.length ? `  [${entry.errors[0]}]` : ""}\n`);
  }
  process.stdout.write(`\nWrote ${result.feeds.length} feeds to ${path.relative(repoRoot, outDir) || "."}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
