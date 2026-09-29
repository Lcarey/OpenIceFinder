import { link, mkdir, readFile, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ClassificationTable, DriveEstimate, OfferingsFeed, ProgramFeed, RangersFeed, RinkFeed, RinkIndex } from "@openice/shared";

import type { DriveTimeStore } from "./drive-times.js";

export interface FeedStore {
  readClassifications(): Promise<ClassificationTable | undefined>;
  writeClassifications(table: ClassificationTable): Promise<void>;
  writeFeed(feed: RinkFeed): Promise<void>;
  writeProgramFeed(feed: ProgramFeed): Promise<void>;
  readProgramFeed(programId: string): Promise<ProgramFeed | undefined>;
  writeIndex(index: RinkIndex): Promise<void>;
  writeOfferings(feed: OfferingsFeed): Promise<void>;
  writeRangers(feed: RangersFeed): Promise<void>;
  readRangers(): Promise<RangersFeed | undefined>;
}

const JSON_INDENT = 2;

export class LocalStore implements FeedStore, DriveTimeStore {
  constructor(private readonly dir: string) {}

  private async write(rel: string, value: unknown): Promise<void> {
    const file = path.join(this.dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
  }

  async readDriveTime(key: string): Promise<DriveEstimate | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, "drive-times", `${key}.json`), "utf8")) as DriveEstimate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") return undefined;
      throw error;
    }
  }

  async writeDriveTime(key: string, estimate: DriveEstimate): Promise<DriveEstimate> {
    const file = path.join(this.dir, "drive-times", `${key}.json`);
    await mkdir(path.dirname(file), { recursive: true });
    const temporary = `${file}.${randomUUID()}.tmp`;
    try {
      await writeFile(temporary, JSON.stringify(estimate));
      await link(temporary, file); // Atomic insert; never replaces a saved estimate.
      return estimate;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== "EEXIST") throw error;
      const existing = await this.readDriveTime(key);
      if (!existing) throw error;
      return existing;
    } finally {
      await rm(temporary, { force: true });
    }
  }

  async readClassifications(): Promise<ClassificationTable | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, "classifications.json"), "utf8")) as ClassificationTable;
    } catch {
      return undefined;
    }
  }

  writeClassifications(table: ClassificationTable): Promise<void> {
    return this.write("classifications.json", table);
  }

  writeFeed(feed: RinkFeed): Promise<void> {
    return this.write(`rinks/${feed.rink.id}.json`, feed);
  }

  writeProgramFeed(feed: ProgramFeed): Promise<void> {
    return this.write(`programs/${feed.program.id}.json`, feed);
  }

  async readProgramFeed(programId: string): Promise<ProgramFeed | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, "programs", `${programId}.json`), "utf8")) as ProgramFeed;
    } catch {
      return undefined;
    }
  }

  writeIndex(index: RinkIndex): Promise<void> {
    return this.write("index.json", index);
  }

  writeOfferings(feed: OfferingsFeed): Promise<void> {
    return this.write(`offerings/${feed.id}.json`, feed);
  }

  writeRangers(feed: RangersFeed): Promise<void> {
    return this.write("rangers.json", feed);
  }

  async readRangers(): Promise<RangersFeed | undefined> {
    try {
      return JSON.parse(await readFile(path.join(this.dir, "rangers.json"), "utf8")) as RangersFeed;
    } catch {
      return undefined;
    }
  }
}

export class S3Store implements FeedStore, DriveTimeStore {
  readonly writtenKeys: string[] = [];

  constructor(
    private readonly bucket: string,
    private readonly prefix = "data/",
    private readonly client: S3Client = new S3Client({}),
  ) {}

  private async put(rel: string, value: unknown, cacheControl: string): Promise<void> {
    const key = `${this.prefix}${rel}`;
    await this.client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: JSON.stringify(value),
        ContentType: "application/json; charset=utf-8",
        CacheControl: cacheControl,
      }),
    );
    this.writtenKeys.push(key);
  }

  async readDriveTime(key: string): Promise<DriveEstimate | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}drive-times/${key}.json` }));
      const body = await res.Body?.transformToString();
      if (!body) throw new Error(`Empty driving estimate: ${key}`);
      return JSON.parse(body) as DriveEstimate;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return undefined;
      throw error;
    }
  }

  async writeDriveTime(key: string, estimate: DriveEstimate): Promise<DriveEstimate> {
    try {
      await this.client.send(new PutObjectCommand({
        Bucket: this.bucket, Key: `${this.prefix}drive-times/${key}.json`,
        Body: JSON.stringify(estimate), ContentType: "application/json",
        CacheControl: "public, max-age=31536000, immutable", IfNoneMatch: "*",
      }));
      return estimate;
    } catch (error) {
      if ((error as { name?: string }).name !== "PreconditionFailed") throw error;
      const existing = await this.readDriveTime(key);
      if (!existing) throw error;
      return existing;
    }
  }

  async readClassifications(): Promise<ClassificationTable | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}classifications.json` }));
      const body = await res.Body?.transformToString();
      return body ? (JSON.parse(body) as ClassificationTable) : undefined;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return undefined;
      throw error;
    }
  }

  writeClassifications(table: ClassificationTable): Promise<void> {
    return this.put("classifications.json", table, "public, max-age=300");
  }

  writeFeed(feed: RinkFeed): Promise<void> {
    return this.put(`rinks/${feed.rink.id}.json`, feed, "public, max-age=60");
  }

  writeProgramFeed(feed: ProgramFeed): Promise<void> {
    return this.put(`programs/${feed.program.id}.json`, feed, "public, max-age=60");
  }

  async readProgramFeed(programId: string): Promise<ProgramFeed | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}programs/${programId}.json` }));
      const body = await res.Body?.transformToString();
      return body ? (JSON.parse(body) as ProgramFeed) : undefined;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return undefined;
      throw error;
    }
  }

  writeIndex(index: RinkIndex): Promise<void> {
    return this.put("index.json", index, "public, max-age=60");
  }

  writeOfferings(feed: OfferingsFeed): Promise<void> {
    return this.put(`offerings/${feed.id}.json`, feed, "public, max-age=60");
  }

  writeRangers(feed: RangersFeed): Promise<void> {
    return this.put("rangers.json", feed, "public, max-age=60");
  }

  async readRangers(): Promise<RangersFeed | undefined> {
    try {
      const res = await this.client.send(new GetObjectCommand({ Bucket: this.bucket, Key: `${this.prefix}rangers.json` }));
      const body = await res.Body?.transformToString();
      return body ? (JSON.parse(body) as RangersFeed) : undefined;
    } catch (error) {
      if ((error as { name?: string }).name === "NoSuchKey") return undefined;
      throw error;
    }
  }
}

export async function persistResult(
  store: FeedStore,
  feeds: RinkFeed[],
  index: RinkIndex,
  table: ClassificationTable,
  programFeeds: ProgramFeed[] = [],
  offeringFeeds: OfferingsFeed[] = [],
  rangersFeed: RangersFeed | null = null,
): Promise<void> {
  for (const feed of feeds) await store.writeFeed(feed);
  for (const feed of programFeeds) await store.writeProgramFeed(feed);
  for (const feed of offeringFeeds) await store.writeOfferings(feed);
  if (rangersFeed) await store.writeRangers(rangersFeed);
  await store.writeIndex(index);
  await store.writeClassifications(table);
}
