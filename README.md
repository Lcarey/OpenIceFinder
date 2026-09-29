# OpenIceFinder

OpenIceFinder finds open ice (kids', adult, and family stick & puck, public hockey, coach's ice) at the 20 rinks closest by driving time to Arlington, MA. A scheduled Lambda scrapes each rink's public calendar every 6 hours, classifies the raw event titles, and writes one JSON file per rink to S3. A small React app served from CloudFront shows either the next open ice across all rinks or the full calendar for a single rink.

Live: `https://dtwj09ada0yt7.cloudfront.net`

## Architecture

- `packages/shared` — `Rink`, `RinkSource`, `IceEvent`, and `IceCategory` types, keyword classification rules, America/New_York time helpers.
- `packages/scraper` — one adapter per calendar platform (`myrec-calendar`, `myrec-program`, `frontline`, `halix`, `finnly`, `ical`, `civicengage`, `rectimes`, `document-vision`), the OpenAI-backed classifier with a persisted lookup table, `refresh.ts` (runs every rink, tolerates per-rink failures), `lambda.ts` (S3 writes + CloudFront invalidation), and `cli.ts` for local runs.
- `apps/web` — Vite + React 19. **Open ice** view (all rinks, category/drive-time/day filters) and **Rink** view (week and month grids). Reads `/data/index.json` and `/data/rinks/<id>.json`.
- `infra` — AWS CDK stack: private S3 origin, CloudFront (`/assets/*` immutable, `/data/*` 60 s TTL, SPA rewrite), Node.js 24 ARM64 refresh Lambda, EventBridge `rate(6 hours)`, Secrets Manager entry for the OpenAI key.
- `scripts/build-rinks.ts` — geocodes candidate rinks with Nominatim, ranks them by OSRM driving time from Arlington Center, and writes the top 20 with their source configs to `data/rinks.json`.
- `data/programs.json` — hockey programs whose team schedules annotate a rink. The `crossbar` source scrapes every team's `/team/<id>/schedule` list on a Crossbar club site (Arlington Hockey Club at arlingtonice.com), merges shared slots, and writes `data/programs/<id>.json`; the **Who's on the ice** view overlays those teams on the rink's generic rental blocks.
- `data/classifications.seed.json` — committed `(rinkId, title) -> category` lookup table; unknown titles are classified by OpenAI and appended in S3 (and locally on CLI runs).

## Local development

```bash
npm install
npm run refresh:local            # scrape every rink into data/ (uses OPENAI_API_KEY if set)
npm run refresh:local -- --rink flynn-medford --no-model
npm run refresh:rangers          # Elite 9 tape for /rangers (used by the GitHub Action)
npm run dev                      # Vite dev server reading local data/
```

## Adding or fixing a rink

1. Edit the candidate list or the `source` config in `scripts/build-rinks.ts` and run `npm run rinks:build` (or edit `data/rinks.json` directly).
2. Run `npm run refresh:local -- --rink <id>` and inspect `data/rinks/<id>.json`.
3. Fix mislabeled titles by adding a `manual` entry to `data/classifications.seed.json`.

Rinks whose schedules are only published as PDFs, images, or prose use the `document-vision` source, which sends the documents to an OpenAI vision model with a structured output schema. Rinks with no public schedule are `link-only` and appear in the index with an error note.

Known limitation: `mass.gov` (DCR rinks: Emmons, Steriti, Reilly) returns HTTP 403 to AWS egress IPs, so those rinks only populate from local refreshes. Elite 9 also hides unpublished upcoming games from AWS, so `/rangers` upcoming games are scraped by `.github/workflows/refresh-rangers.yml` on a GitHub-hosted runner. The workflow assumes IAM role `OpenIceFinderGitHubRangersRefresh` via GitHub OIDC (no access keys in the repo).

## Validation

```bash
npm run typecheck
npm test
npm run synth
```

## Deploy

```bash
./deploy.sh
```

Builds everything, deploys `OpenIceFinderStack`, stores `OPENAI_API_KEY` in Secrets Manager when set, uploads the web bundle (never touching `data/*`), and invokes the refresh Lambda once so data exists immediately. Set `SKIP_REFRESH=1` to skip that last step.

## Youth hockey

`#/youth-hockey` loads its own `/data/youth-hockey.json`. It shows games involving a verified 2015/2016 FED Elite roster, an E9 roster explicitly named Elite (including color divisions), or an allowlisted top AAA roster. Eligibility belongs to the roster; proximity belongs to the game's rink. Calendar buttons open a Google Calendar draft without connecting an account to this app. A saved entry is not a subscription; check the official schedule again before leaving.

```bash
npx playwright install chromium
# Supply YOUTH_HOCKEY_ORIGIN privately as a JSON [longitude, latitude] pair.
npm run refresh:youth-hockey -- --require-fed
```

The origin is a repository Actions secret, never a committed constant or part of the public feed. OSRM routes exclude traffic; raw duration must be below 1,800 seconds. Successful routes are cached under ignored `.cache/youth-hockey/`, keyed by origin and destination coordinates. Unknown venues/routes are excluded. Venue addresses, coordinates, aliases, and public evidence live in `data/youth-hockey-venues.json`; supplemental roster evidence is in `data/youth-hockey-teams.json`.

Collection uses a standard Chromium window (Linux runners use Xvfb). Headless Chromium may receive browser-verification pages; `YOUTH_BROWSER_HEADED=0` is only an explicit diagnostic option. FED season 15008 and Elite division IDs 80179/80161 are validated against the 2026–27 season. Update the configuration at season rollover. The browser paginates GameSheet's public schedule using its own session. A challenge, non-success response, or incomplete pagination fails that source instead of publishing a partial snapshot.

Each source refreshes independently over a rolling 90-day window. A successful response replaces that source's snapshot, including cancellations/reschedules. Failures preserve future games for at most 48 hours from the last successful fetch, with a stale warning; the browser also expires old games if refresh stops entirely. Eastern Exposure Cup discovery requires a link explicitly labeled with the current calendar year and never uses a previous year's schedule. Its 2026 game schedule was not published at implementation time.

`.github/workflows/refresh-youth-hockey.yml` runs every six hours. Its dedicated OIDC role can put only `data/youth-hockey.json` and invalidate this CloudFront distribution. Feature-branch runs verify FED collection and upload a diagnostic feed without publishing. Before enabling the page in production, pass that runner check, deploy the role, and publish the initial feed. The origin secret is required for both branch verification and main publishing.

Current release blocker (2026-09-29): both FED divisions collect successfully on local Chromium, but GitHub-hosted Ubuntu returns HTTP 403 for GameSheet's paginated schedule requests. The branch verification job intentionally fails. Do not enable/publish this page until that runner check succeeds with a supported, authorized source session. No verification challenge is bypassed or solved automatically. Production also has uncommitted drive-time work in the main checkout; integrate this feature with those changes before deployment so they are preserved.
