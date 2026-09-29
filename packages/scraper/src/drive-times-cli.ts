#!/usr/bin/env node
/** Fill only missing drive estimates on published feeds; does not scrape or classify anything. */
import { CloudFrontClient, CreateInvalidationCommand } from "@aws-sdk/client-cloudfront";
import { GetObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { compareRinkDrives, type RinkFeed, type RinkIndex } from "@openice/shared";
import { DriveTimes, attachDriveTimes } from "./drive-times.js";
import { S3Store } from "./storage.js";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const bucket = arg("--bucket");
  if (!bucket) throw new Error("Usage: npm run refresh:drives -- --bucket <bucket> [--distribution <id>] [--no-publish]");
  const client = new S3Client({ region: process.env.AWS_REGION ?? "us-east-1" });
  const read = async <T>(key: string): Promise<T> => {
    const response = await client.send(new GetObjectCommand({ Bucket: bucket, Key: key }));
    return JSON.parse((await response.Body!.transformToString())!) as T;
  };
  const index = await read<RinkIndex>("data/index.json");
  const feeds = await Promise.all(index.rinks.map((entry) => read<RinkFeed>(`data/rinks/${entry.rink.id}.json`)));
  const store = new S3Store(bucket, "data/", client);
  const drives = new DriveTimes(store, { log: console.log });
  for (const feed of feeds) {
    await attachDriveTimes([feed], drives);
    const entry = index.rinks.find((item) => item.rink.id === feed.rink.id)!;
    if (entry.nextOpenIce) entry.nextOpenIce = feed.events.find((event) => event.id === entry.nextOpenIce!.id);
    if (!process.argv.includes("--no-publish")) await store.writeFeed(feed);
    console.log(`${feed.rink.id}: ${feed.events.filter((event) => event.drive).length} estimates; ${JSON.stringify(drives.stats)}`);
  }
  index.rinks.sort(compareRinkDrives);
  if (!process.argv.includes("--no-publish")) {
    await store.writeIndex(index);
    const distribution = arg("--distribution");
    if (distribution) {
      await new CloudFrontClient({}).send(new CreateInvalidationCommand({
        DistributionId: distribution,
        InvalidationBatch: { CallerReference: `drives-${Date.now()}`, Paths: { Quantity: 1, Items: ["/data/*"] } },
      }));
    }
  }
  console.log(`Driving estimates: ${JSON.stringify(drives.stats)}`);
  if (drives.stats.failed) process.exitCode = 1;
}

main().catch((error) => { console.error(error); process.exitCode = 1; });
