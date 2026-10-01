# OpenIceFinder

OpenIceFinder finds open ice (kids', adult, and family stick & puck, public hockey, coach's ice) at the 20 rinks closest by driving time to Arlington, MA. A scheduled Lambda scrapes each rink's public calendar every 24 hours, classifies the raw event titles, and writes one JSON file per rink to S3. A small React app served from CloudFront shows either the next open ice across all rinks or the full calendar for a single rink.

Live: `https://dtwj09ada0yt7.cloudfront.net`

## Architecture

- `packages/shared` — `Rink`, `RinkSource`, `IceEvent`, and `IceCategory` types, keyword classification rules, America/New_York time helpers.
- `packages/scraper` — one adapter per calendar platform (`myrec-calendar`, `myrec-program`, `frontline`, `halix`, `finnly`, `ical`, `civicengage`, `rectimes`, `document-vision`), the OpenAI-backed classifier with a persisted lookup table, `refresh.ts` (runs every rink, tolerates per-rink failures), `lambda.ts` (S3 writes + CloudFront invalidation), and `cli.ts` for local runs.
- `apps/web` — Vite + React 19. **Open ice** view (all rinks, category/drive-time/day filters) and **Rink** view (week and month grids). Reads `/data/index.json` and `/data/rinks/<id>.json`.
- `infra` — AWS CDK stack: private S3 origin, CloudFront (`/assets/*` immutable, `/data/*` 60 s TTL, SPA rewrite), Node.js 24 ARM64 refresh Lambda, EventBridge `rate(1 day)`, Secrets Manager entry for the OpenAI key.
- `scripts/build-rinks.ts` — geocodes candidate rinks with Nominatim, ranks candidates by OSRM free-flow driving time from 107 Webster St (catalog selection only; displayed session times use Amazon Location), and writes the top 20 with their source configs to `data/rinks.json`.
- `data/programs.json` — hockey programs whose team schedules annotate a rink. The `crossbar` source scrapes every team's `/team/<id>/schedule` list on a Crossbar club site (Arlington Hockey Club at arlingtonice.com), merges shared slots, and writes `data/programs/<id>.json`; the **Who's on the ice** view overlays those teams on the rink's generic rental blocks.
- `data/classifications.seed.json` — committed `(rinkId, title) -> category` lookup table; unknown titles are classified by OpenAI and appended in S3 (and locally on CLI runs).

## Driving estimates

Each timed rink session has an Amazon Location `CalculateRoutes` car estimate from **107 Webster St, Arlington, MA** (longitude -71.14375, latitude 42.41674), with traffic enabled and arrival at the session's start time. The first lookup samples the same local weekday/time 7–13 days ahead to use predicted traffic rather than permanently saving a live traffic jam. No parking or early-arrival buffer is included.

Successful estimates are stored **forever, with no TTL or refresh-on-age**, in S3 under `data/drive-times/v1/` (locally: `data/drive-times/`). Keys include origin, rink/destination, weekday, and exact `HH:mm` in `America/New_York`; they exclude event title, calendar date, and UTC/DST offset. Two sessions at the same rink on Tuesday at 14:00 share an estimate across weeks and DST. Different weekdays and times get separate estimates. Writes are insert-only and saved immediately; failed requests are not cached. Concurrent requests in one refresh are deduplicated; conditional writes preserve the original estimate if refreshes overlap. Deploys preserve `data/*`, including the cache.

The drive filter and session badges use these per-session estimates, rounded up to minutes. Missing estimates display as unavailable and are excluded only when a drive limit is selected. Rink lists show the estimate for the next open session. The legacy `Rink.driveMinutes`/`driveMiles` fields only support catalog building; they are not used by the UI. Future road or traffic-pattern changes do not update an existing cache entry automatically.

To fill missing estimates on already-published schedules without scraping again:

```bash
npm run refresh:drives -- --bucket <web-bucket-name>
```

This command and local refreshes need AWS credentials with `geo-routes:CalculateRoutes`; production uses the Lambda role. A second identical run uses only saved estimates.

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
# Use AWS credentials with routing and drive-cache permissions.
npm run refresh:youth-hockey -- --bucket <web-bucket>
# Optional diagnostic: require both FED divisions to succeed.
npm run refresh:youth-hockey -- --bucket <web-bucket> --require-fed
```

Youth hockey uses the same Amazon Location calculator and permanent cache as open ice. Each game's Eastern weekday and start time selects the traffic prediction; raw duration must be strictly below 1,800 seconds. Cached schedules are re-routed too, so old OSRM estimates cannot bypass the cutoff. `--bucket` reuses the production `data/drive-times/` cache; without it, successful estimates persist under ignored `.cache/youth-hockey/`. The origin stays out of browser bundles, public feeds, calendar and directions links. CloudFront denies public drive-cache requests. Unknown venues/routes are excluded. Venue addresses, coordinates, aliases, and public evidence live in `data/youth-hockey-venues.json`; supplemental roster evidence is in `data/youth-hockey-teams.json`.

Collection uses a standard Chromium window (Linux runners use Xvfb). Headless Chromium may receive browser-verification pages; `YOUTH_BROWSER_HEADED=0` is only an explicit diagnostic option. FED season 15008 and Elite division IDs 80179/80161 are validated against the 2026–27 season. Update the configuration at season rollover. The browser paginates GameSheet's public schedule using its own session. A challenge, non-success response, or incomplete pagination fails that source instead of publishing a partial snapshot.

Each source refreshes independently over a rolling 90-day window. A successful response replaces that source's snapshot, including cancellations/reschedules. Failures preserve future games for at most 48 hours from the last successful fetch, with a stale warning; the browser also expires old games if refresh stops entirely. Eastern Exposure Cup discovery requires a link explicitly labeled with the current calendar year and never uses a previous year's schedule. Its 2026 game schedule was not published at implementation time.

`.github/workflows/refresh-youth-hockey.yml` runs once every 24 hours on main. Its dedicated OIDC role can publish only `data/youth-hockey.json`, read/write the shared drive cache, calculate routes with the AWS default provider, and invalidate this CloudFront distribution. Each source reports its own status; unavailable coverage does not stop healthy sources from publishing.

Known source limitation (2026-09-29): both FED divisions collect successfully on local Chromium, but GitHub-hosted Ubuntu returns HTTP 403 for GameSheet's paginated schedule requests. FED games remain visible with a stale warning for up to 48 hours after a successful collection, then disappear until a verified refresh succeeds. E9 refreshes independently. Verification challenges are never bypassed or solved automatically.

### MYHockey ratings and browser caching

The daily `refresh-rangers.yml` workflow also collects the 2026–27 MYHockey USA 10U (2016) and 11U (2015) alphabetical lists in a normal Chrome session. It publishes one shared `data/mhr.json` snapshot; Rangers and youth games join that cached snapshot by birth year and exact normalized roster name. Elite, Select, and numbered squads remain distinct. Ratings require five recorded games and a positive published rating; ranks appear only when MHR explicitly supplies them. No rating is inferred from row order. Each failed age list retains its last successful data and timestamp, and the workflow reports the failure. Browser visits never scrape MYHockey.

Run `MHR_BROWSER_HEADED=1 MHR_BROWSER_CHANNEL=chrome npm run refresh:mhr` locally (install Chrome with `npx playwright install chrome` if needed). The scheduled rankings job uses standard macOS Chrome, matching the verified local collector. Update `MHR_SEASON` and age categories for a new season. The sync remains once every **24 hours**, alongside Rangers, with youth schedules refreshed by their existing daily workflow.

Production installs a service worker that precaches both HTML entry pages and all built app code/styles. Visited JSON feeds are saved on the phone, reused for five minutes, then conditionally revalidated using HTTP caching/ETags; network failures fall back to the saved response. Existing schedule freshness timestamps and youth stale-data limits still apply. App updates install a new versioned shell automatically. Only the current and previous app shells are retained in the browser; deployed hashed assets stay on S3 so open tabs can finish using an older version. Rink/program/offerings feeds are loaded only for views that need them. `/rangersa` is an alias for `/rangers`, which now appears in the main navigation.
