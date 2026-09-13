import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import type { Context, ScheduledEvent } from "aws-lambda";
import { Classifier, mergeTables } from "./classify.js";
import { PROGRAMS, RINKS, SEED_CLASSIFICATIONS } from "./data.js";
import { DEFAULT_OPENAI_MODEL, openAiClientProvider } from "./openai-client.js";
import { refreshAll } from "./refresh.js";
import { S3Store, persistResult } from "./storage.js";

interface RefreshEvent {
  rinkIds?: string[];
  rangeDays?: number;
}

export interface RefreshSummary {
  generatedAt: string;
  rinks: number;
  events: number;
  programs: number;
  programEvents: number;
  failures: string[];
  learnedClassifications: number;
  invalidated: boolean;
}

export async function handler(event: Partial<ScheduledEvent> & RefreshEvent = {}, context?: Context): Promise<RefreshSummary> {
  const bucket = process.env.BUCKET_NAME;
  if (!bucket) throw new Error("BUCKET_NAME is required");
  const distributionId = process.env.DISTRIBUTION_ID;
  const model = process.env.OPENAI_MODEL ?? DEFAULT_OPENAI_MODEL;
  const log = (message: string) => console.log(message);

  const rinks = event.rinkIds?.length ? RINKS.filter((r) => event.rinkIds!.includes(r.id)) : RINKS;
  const store = new S3Store(bucket);
  const table = mergeTables(SEED_CLASSIFICATIONS, await store.readClassifications());
  const openai = openAiClientProvider();
  const classifier = new Classifier(table, { model, log, openai });

  const programs = event.rinkIds?.length ? PROGRAMS.filter((p) => event.rinkIds!.includes(p.rinkId)) : PROGRAMS;
  const result = await refreshAll({
    rinks,
    programs,
    classifier,
    openai,
    openaiModel: model,
    rangeDays: event.rangeDays ?? Number(process.env.RANGE_DAYS ?? "35"),
    concurrency: Number(process.env.CONCURRENCY ?? "4"),
    log,
    previousProgramFeed: (id) => store.readProgramFeed(id),
  });
  await persistResult(store, result.feeds, result.index, classifier.table, result.programFeeds);

  let invalidated = false;
  if (distributionId) {
    const cf = new CloudFrontClient({});
    await cf.send(
      new CreateInvalidationCommand({
        DistributionId: distributionId,
        InvalidationBatch: { CallerReference: `${context?.awsRequestId ?? "local"}-${Date.now()}`, Paths: { Quantity: 1, Items: ["/data/*"] } },
      }),
    );
    invalidated = true;
  }

  const summary: RefreshSummary = {
    generatedAt: result.index.generatedAt,
    rinks: result.feeds.length,
    events: result.feeds.reduce((sum, f) => sum + f.events.length, 0),
    programs: result.programFeeds.length,
    programEvents: result.programFeeds.reduce((sum, f) => sum + f.events.length, 0),
    failures: [
      ...result.index.rinks.filter((r) => !r.ok).map((r) => `${r.rink.id}: ${r.errors.join("; ")}`),
      ...(result.index.programs ?? []).filter((p) => !p.ok).map((p) => `${p.program.id}: ${p.errors.join("; ")}`),
    ],
    learnedClassifications: classifier.added.length,
    invalidated,
  };
  log(JSON.stringify(summary));
  return summary;
}
