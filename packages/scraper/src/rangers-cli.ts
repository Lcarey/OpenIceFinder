#!/usr/bin/env node
/**
 * Rangers-only refresh: writes data/rangers.json and exits non-zero if Elite 9 hid upcoming games.
 *
 * Usage: npm run refresh:rangers -- [--out data]
 */
import path from "node:path";
import { fileURLToPath } from "node:url";
import { refreshRangers } from "./rangers.js";
import { LocalStore } from "./storage.js";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "..", "..");

function arg(name: string): string | undefined {
  const idx = process.argv.indexOf(name);
  return idx >= 0 ? process.argv[idx + 1] : undefined;
}

async function main() {
  const outDir = path.resolve(repoRoot, arg("--out") ?? "data");
  const store = new LocalStore(outDir);
  const log = (message: string) => process.stderr.write(`${message}\n`);
  const feed = await refreshRangers({ log });
  const rec = `${feed.team.record.wins}-${feed.team.record.losses}-${feed.team.record.ties}`;
  if (feed.upcoming.length === 0) {
    log(`rangers: ${feed.team.name} ${rec} · 0 upcoming (Elite 9 hid future games from this IP); leaving ${path.relative(repoRoot, outDir)}/rangers.json unchanged`);
    process.exit(1);
  }
  await store.writeRangers(feed);
  process.stdout.write(`ok rangers:${feed.team.shortName} ${rec}  next:${feed.upcoming.length}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
