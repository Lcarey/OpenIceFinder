#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { MhrSnapshot } from "@openice/shared";
import { refreshMhrSnapshot } from "./mhr-cache.js";

async function main() {
  const outArg = process.argv.indexOf("--out");
  const out = path.resolve(outArg < 0 ? "data/mhr.json" : process.argv[outArg + 1]!);
  let previous: MhrSnapshot | undefined;
  try { previous = JSON.parse(await readFile(out, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const browser = await chromium.launch({ channel: process.env.MHR_BROWSER_CHANNEL ?? "chromium", headless: process.env.MHR_BROWSER_HEADED !== "1" });
  try {
    // Keep the ordinary browsing session across age lists. browser.newPage()
    // would create an isolated context and discard the site's session each time.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const snapshot = await refreshMhrSnapshot({ previous, log: console.log, fetchTable: async (url) => {
      const page = await context.newPage();
      try {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        // Read the ordinary public table; challenges are failures, never bypassed.
        await page.locator('table.rankings a[href*="team_info"], table.rankings a[href*="team-info"]').first().waitFor({ state: "attached", timeout: 35_000 }).catch(async () => {
          throw new Error(`MHR listing did not load (${await page.title()}).`);
        });
        return await page.locator("table.rankings").evaluate((table) => table.outerHTML);
      } finally { await page.close(); }
    } });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(snapshot)}\n`);
    if (snapshot.sources.some((s) => s.error)) process.exitCode = 1;
  } finally { await browser.close(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
