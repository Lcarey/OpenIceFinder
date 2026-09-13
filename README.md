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
npm run dev                      # Vite dev server reading local data/
```

## Adding or fixing a rink

1. Edit the candidate list or the `source` config in `scripts/build-rinks.ts` and run `npm run rinks:build` (or edit `data/rinks.json` directly).
2. Run `npm run refresh:local -- --rink <id>` and inspect `data/rinks/<id>.json`.
3. Fix mislabeled titles by adding a `manual` entry to `data/classifications.seed.json`.

Rinks whose schedules are only published as PDFs, images, or prose use the `document-vision` source, which sends the documents to an OpenAI vision model with a structured output schema. Rinks with no public schedule are `link-only` and appear in the index with an error note.

Known limitation: `mass.gov` (DCR rinks: Emmons, Steriti, Reilly) returns HTTP 403 to AWS egress IPs, so those rinks only populate from local refreshes.

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
