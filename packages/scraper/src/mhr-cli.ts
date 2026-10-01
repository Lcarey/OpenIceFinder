#!/usr/bin/env node
import { readFile, writeFile, mkdir } from "node:fs/promises";
import path from "node:path";
import { chromium } from "playwright";
import type { MhrSnapshot } from "@openice/shared";
import { refreshMhrSnapshot } from "./mhr-cache.js";
import { MhrAccessBlockedError, paceMhrRequests } from "./mhr-request-policy.js";

async function main() {
  const outArg = process.argv.indexOf("--out");
  const out = path.resolve(outArg < 0 ? "data/mhr.json" : process.argv[outArg + 1]!);
  let previous: MhrSnapshot | undefined;
  try { previous = JSON.parse(await readFile(out, "utf8")); } catch (e) { if ((e as NodeJS.ErrnoException).code !== "ENOENT") throw e; }
  const browser = await chromium.launch({ channel: process.env.MHR_BROWSER_CHANNEL ?? "chromium", headless: process.env.MHR_BROWSER_HEADED !== "1" });
  let listAttempts = 0, mhrRequests = 0, mhrDocuments = 0;
  try {
    // Keep the ordinary browsing session across age lists. browser.newPage()
    // would create an isolated context and discard the site's session each time.
    const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
    const page = await context.newPage();
    context.on("request", (request) => {
      const hostname = new URL(request.url()).hostname;
      if (hostname === "myhockeyrankings.com" || hostname.endsWith(".myhockeyrankings.com")) {
        mhrRequests++;
        if (request.isNavigationRequest() && request.frame() === page.mainFrame()) mhrDocuments++;
      }
    });
    page.setDefaultTimeout(35_000);
    const fetchTable = paceMhrRequests(async (url) => {
      listAttempts++;
      console.log(`MHR: age-list request ${listAttempts}: ${url}`);
      try {
        // One direct list navigation per age; no per-team or intermediate pages.
        const response = await page.goto(url, { waitUntil: "domcontentloaded", timeout: 45_000 });
        if (response && ([403, 429].includes(response.status()) || response.headers()["cf-mitigated"] === "challenge")) {
          throw new MhrAccessBlockedError(`MHR rejected the page (HTTP ${response.status()}); stopping until the next scheduled run.`);
        }
        // Read the public table. Challenges are failures, never bypassed.
        await page.locator('table.rankings a[href*="team_info"], table.rankings a[href*="team-info"]').first().waitFor({ state: "attached", timeout: 35_000 }).catch(async () => {
          const title = await page.title();
          const message = `MHR listing did not load (${title}).`;
          if (/just a moment|attention required|access denied|verify you are human/i.test(title)) throw new MhrAccessBlockedError(message);
          throw new Error(message);
        });
        return await page.locator("table.rankings").evaluate((table) => table.outerHTML);
      } finally {
        // Stop ads/background requests while pacing, keeping the browser context.
        await page.goto("about:blank").catch(() => {});
      }
    }, { log: console.log });
    const snapshot = await refreshMhrSnapshot({ previous, log: console.log, fetchTable });
    await mkdir(path.dirname(out), { recursive: true });
    await writeFile(out, `${JSON.stringify(snapshot)}\n`);
    if (snapshot.sources.some((s) => s.error)) process.exitCode = 1;
  } finally {
    await browser.close();
    console.log(`MHR requests initiated: ${listAttempts} age-list attempts; ${mhrDocuments} top-level document requests including redirects; ${mhrRequests} total requests to MYHockey including assets.`);
  }
}
main().catch((error: unknown) => { console.error(error); process.exitCode = 1; });
