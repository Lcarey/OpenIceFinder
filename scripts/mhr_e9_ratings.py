# /// script
# requires-python = ">=3.11"
# dependencies = ["playwright==1.55.0"]
# ///
"""Snapshot MyHockeyRankings ratings for Elite 9 (E9HL) boys divisions in one MHR season.

MHR sits behind a Cloudflare challenge, so this drives the locally installed Chrome through Playwright.
MHR's `y` is the season start year (y=2025 is 2025-26) and its age label is `y - birth year` (a 2016 team is 9U in 2025-26).

Usage:
  uv run scripts/mhr_e9_ratings.py --year 2024 --ages 9,10,11,12            E9HL divisions → data/backtest/mhr-e9-<season>.json
  uv run scripts/mhr_e9_ratings.py --year 2024 --ages 9,10,11,12 --usa      USA age lists (New England + NY) → mhr-usa-<season>.json
"""
import argparse, asyncio, json, re, time
from pathlib import Path
from playwright.async_api import async_playwright

UA = "Mozilla/5.0 (Macintosh; Intel Mac OS X 14_0) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/140.0.0.0 Safari/537.36"
BASE = "https://myhockeyrankings.com"
ROOT = Path(__file__).resolve().parent.parent


async def load(page, url, need):
    await page.goto(url, wait_until="domcontentloaded", timeout=90_000)
    for _ in range(60):
        body = await page.inner_text("body")
        if "Just a moment" not in body and re.search(need, body):
            return body
        await page.wait_for_timeout(1000)
    raise RuntimeError(f"timed out waiting for {need!r} on {url}")


ROWS_JS = r"""() => [...document.querySelectorAll('tr')].map(tr => {
  const a = tr.querySelector("a[href*='team-info'], a[href*='team_info']");
  if (!a) return null;
  return { href: a.getAttribute('href'), name: a.textContent.trim(), cells: [...tr.querySelectorAll('td')].map(td => td.innerText.trim()) };
}).filter(Boolean)"""


async def division_rows(page, url):
    await load(page, url, r"W-L-T")
    for _ in range(30):
        rows = await page.evaluate(ROWS_JS)
        if rows:
            return rows
        await page.wait_for_timeout(1000)
    return []


USA_LISTS = {9: 121, 10: 122, 11: 123, 12: 124}
STATES = {"MA", "NH", "ME", "VT", "RI", "CT", "NY"}

LIST_JS = r"""() => [...document.querySelectorAll('tr')].map(tr => {
  const a = tr.querySelector("a[href*='team-info'], a[href*='team_info']");
  if (!a) return null;
  return { href: a.getAttribute('href'), name: a.textContent.trim(), text: tr.innerText };
}).filter(Boolean)"""


async def usa_lists(page, year, ages):
    out = {"source": BASE, "mhrYear": year, "season": f"{year}-{str(year + 1)[2:]}", "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "divisions": []}
    for age in sorted(ages):
        url = f"{BASE}/rank?y={year}&a=1&v={USA_LISTS[age]}"
        t = time.time()
        await load(page, url, r"Rankings")
        rows = []
        for _ in range(60):
            rows = await page.evaluate(LIST_JS)
            if len(rows) > 50:
                break
            await page.wait_for_timeout(1000)
        teams = []
        for r in rows:
            state = re.search(r"\(([A-Z]{2})\)", r["text"])
            if not state or state.group(1) not in STATES:
                continue
            tid = re.search(r"(?:team-info/|[?&]t=)(\d+)", r["href"])
            rec = re.search(r"\b(\d+-\d+-\d+)\b\s*([\d.]+)", r["text"])
            teams.append({"mhrId": int(tid.group(1)) if tid else None, "name": r["name"], "state": state.group(1), "record": rec.group(1) if rec else "", "rating": float(rec.group(2)) if rec else None})
        out["divisions"].append({"label": f"USA {age}U - All", "age": age, "url": url, "teams": teams})
        print(f"USA {age}U: {len(rows)} rows, {len(teams)} kept  {time.time() - t:5.1f}s", flush=True)
    return out


async def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("--year", type=int, required=True)
    ap.add_argument("--ages", default="9,10,11,12")
    ap.add_argument("--usa", action="store_true")
    args = ap.parse_args()
    ages = {int(a) for a in args.ages.split(",")}
    if args.usa:
        async with async_playwright() as p:
            browser = await p.chromium.launch(channel="chrome", headless=True, args=["--disable-blink-features=AutomationControlled"])
            page = await (await browser.new_context(user_agent=UA)).new_page()
            out = await usa_lists(page, args.year, ages)
            await browser.close()
        dest = ROOT / "data" / "backtest" / f"mhr-usa-{out['season']}.json"
        dest.write_text(json.dumps(out, indent=1) + "\n")
        print(f"wrote {dest.relative_to(ROOT)}: {sum(len(d['teams']) for d in out['divisions'])} teams")
        return
    out = {"source": BASE, "mhrYear": args.year, "season": f"{args.year}-{str(args.year + 1)[2:]}", "fetchedAt": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()), "divisions": []}
    async with async_playwright() as p:
        browser = await p.chromium.launch(channel="chrome", headless=True, args=["--disable-blink-features=AutomationControlled"])
        page = await (await browser.new_context(user_agent=UA)).new_page()
        await load(page, f"{BASE}/league-info?l=567&y={args.year}", r"E9HL")
        links = await page.eval_on_selector_all("a[href*='division-info']", "els => els.map(e => [e.getAttribute('href'), e.textContent.replace(/\\s+/g,' ').trim()])")
        seen = set()
        for href, label in links:
            m = re.search(r"\b(\d+)U\b", label)
            if not m or "Girls" in label or int(m.group(1)) not in ages or href in seen:
                continue
            seen.add(href)
            url = BASE + href
            t = time.time()
            rows = await division_rows(page, url)
            teams = []
            for r in rows:
                tid = re.search(r"(?:team-info/|[?&]t=)(\d+)", r["href"])
                cells = r["cells"]
                rating = next((float(c) for c in reversed(cells) if re.fullmatch(r"\d+(?:\.\d+)?", c) and "." in c), None)
                record = next((c for c in cells if re.fullmatch(r"\d+-\d+-\d+", c)), "")
                teams.append({"mhrId": int(tid.group(1)) if tid else None, "name": r["name"], "record": record, "rating": rating})
            out["divisions"].append({"label": label, "age": int(m.group(1)), "url": url, "teams": teams})
            print(f"{label:28} {len(teams):3} teams  {time.time() - t:5.1f}s", flush=True)
        await browser.close()
    dest = ROOT / "data" / "backtest" / f"mhr-e9-{out['season']}.json"
    dest.write_text(json.dumps(out, indent=1) + "\n")
    print(f"wrote {dest.relative_to(ROOT)}: {sum(len(d['teams']) for d in out['divisions'])} teams in {len(out['divisions'])} divisions")


asyncio.run(main())
