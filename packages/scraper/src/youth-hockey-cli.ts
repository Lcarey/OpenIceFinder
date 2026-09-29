#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { fileURLToPath } from "node:url";
import type { YouthHockeyFeed } from "@openice/shared";
import { refreshYouthHockey, type LocatedVenue } from "./youth-hockey/core.js";
import { collectElite9 } from "./youth-hockey/elite9.js";
import { EXPOSURE_URL, GameSheetCollector, type VerifiedYouthRoster } from "./youth-hockey/gamesheet.js";
import { DriveTimes } from "./drive-times.js";
import { LocalStore, S3Store } from "./storage.js";

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../../..");
const arg = (name: string) => { const i = process.argv.indexOf(name); return i < 0 ? undefined : process.argv[i + 1]; };
async function main() {
  const now = new Date();
  const outDir = path.resolve(root, arg("--out") ?? "data");
  const feedFile = path.join(outDir, "youth-hockey.json");
  const venues = JSON.parse(await readFile(path.join(root, "data/youth-hockey-venues.json"), "utf8")) as LocatedVenue[];
  const rosters = JSON.parse(await readFile(path.join(root, "data/youth-hockey-teams.json"), "utf8")) as VerifiedYouthRoster[];
  const bucket = arg("--bucket");
  const drives = new DriveTimes(bucket ? new S3Store(bucket) : new LocalStore(path.join(root, ".cache/youth-hockey")), { now, log: console.log });
  let previous: YouthHockeyFeed | undefined;
  try { previous = JSON.parse(await readFile(feedFile, "utf8")); } catch { /* initial feed */ }
  const browser = new GameSheetCollector();
  try {
    const feed = await refreshYouthHockey({
      now, previous, venues, drive: (v, start) => drives.get(v, start), log: console.log,
      sources: [
        { id: "fed-2015", name: "FED Elite · 2015", league: "FED Elite", url: "https://fedhockey.com/club/elite2015", collect: () => browser.fed(2015, now) },
        { id: "fed-2016", name: "FED Elite · 2016", league: "FED Elite", url: "https://fedhockey.com/club/elite2016", collect: () => browser.fed(2016, now) },
        { id: "elite9", name: "Elite 9 · 2015 & 2016", league: "Elite 9", url: "https://www.elite9hockey.com/pages/schedules/boys-2026-27-schedule/", collect: () => collectElite9(now) },
        { id: "exposure", name: "Eastern Exposure Cup", league: "AAA tournaments", url: EXPOSURE_URL, collect: () => browser.exposure(now, rosters) },
      ],
    });
    if (drives.stats.failed && !drives.stats.cached && !drives.stats.calculated) throw new Error("No driving estimates could be resolved; leaving the published feed unchanged.");
    await mkdir(outDir, { recursive: true });
    await writeFile(feedFile, `${JSON.stringify(feed, null, 2)}\n`);
    console.log(`Youth hockey: ${feed.games.length} nearby games; ${drives.stats.cached} cached arrival estimates, ${drives.stats.calculated} new estimates, ${drives.stats.failed} failed.`);
    if (process.argv.includes("--require-fed") && feed.sources.some((s) => s.id.startsWith("fed-") && s.status !== "ok")) throw new Error("FED release check failed. The diagnostic feed was written, but must not be released as verified.");
  } finally { await browser.close(); }
}
main().catch((error: unknown) => { console.error(error instanceof Error ? error.message : "Youth hockey refresh failed."); process.exitCode = 1; });
