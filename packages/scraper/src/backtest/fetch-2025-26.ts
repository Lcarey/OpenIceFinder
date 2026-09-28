#!/usr/bin/env node
/**
 * Snapshot last season's Elite 9 results for the 2013–2016 birth years into data/backtest/elite9-2025-26.json.
 *
 * Usage: node --import tsx packages/scraper/src/backtest/fetch-2025-26.ts
 */
import { mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import {
  RANGERS_WIDGETS,
  flattenSchedule,
  gamesFromRows,
  rangersPostWithCookie,
  scheduleBody,
  widgetSessionCookie,
  widgetToken,
  type VaGameRow,
  type VaScheduleResponse,
} from "../rangers.js";
import type { BtSnapshot } from "./games.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..", "..");
const SEASON = "2026";
const BIRTH_YEARS = /\b(2013|2014|2015|2016)\b/;

async function main() {
  const log = (m: string) => process.stderr.write(`${m}\n`);
  const post = rangersPostWithCookie(await widgetSessionCookie(log));
  const token = await widgetToken(post, log);
  const res = await post<VaScheduleResponse>("/schedules/get", scheduleBody("", token, SEASON));
  const groups = Object.entries(res.Games ?? {}).filter(([division]) => BIRTH_YEARS.test(division));
  const rows: VaGameRow[] = [];
  for (const [division, group] of groups) {
    for (const r of flattenSchedule({ [division]: group })) rows.push({ ...r, DivisionName: r.DivisionName ?? division });
  }
  const { games, skipped } = gamesFromRows(rows, Number(SEASON));
  const snapshot: BtSnapshot = {
    season: SEASON,
    seasonLabel: "2025–26",
    fetchedAt: new Date().toISOString(),
    source: `${RANGERS_WIDGETS}/schedules/get (Season ${SEASON}, league e9bhl)`,
    divisions: groups.map(([d]) => d),
    games,
  };
  const out = path.join(repoRoot, "data", "backtest", "elite9-2025-26.json");
  await mkdir(path.dirname(out), { recursive: true });
  await writeFile(out, `${JSON.stringify(snapshot, null, 1)}\n`);
  log(`${rows.length} team-rows from ${groups.length} divisions → ${games.length} games (${skipped} rows skipped) → ${path.relative(repoRoot, out)}`);
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch((error) => {
    console.error(error);
    process.exit(1);
  });
}
