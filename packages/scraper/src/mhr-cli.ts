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
    const page = await context.newPage();
    page.setDefaultTimeout(35_000);
    const snapshot = await refreshMhrSnapshot({ previous, log: console.log, fetchTable: async (url) => {
      const category = new URL(url).searchParams.get("v")!;
      const choice = page.locator(`#rank-alt-select option[value$="&v=${category}"]`);
      if (await choice.count()) {
        // Follow the site's own age selector and Alphabetic link, retaining its
        // ordinary same-origin navigation/session rather than opening a new tab.
        const value = await choice.getAttribute("value");
        await Promise.all([
          page.waitForURL((u) => u.searchParams.get("v") === category),
          page.locator("#rank-alt-select").selectOption(value!),
        ]);
        await Promise.all([
          page.waitForURL((u) => u.searchParams.get("view") === "alphabetic"),
          page.getByRole("link", { name: "Alphabetic", exact: true }).click(),
        ]);
      } else {
        await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
      }
      // Read the ordinary public table; challenges are failures, never bypassed.
      await page.locator('table.rankings a[href*="team_info"], table.rankings a[href*="team-info"]').first().waitFor({ state: "attached", timeout: 35_000 }).catch(async () => {
        throw new Error(`MHR listing did not load (${await page.title()}).`);
      });
      return await page.locator("table.rankings").evaluate((table) => table.outerHTML);
    } });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(snapshot)}\n`);
    if (snapshot.sources.some((s) => s.error)) process.exitCode = 1;
  } finally { await browser.close(); }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
