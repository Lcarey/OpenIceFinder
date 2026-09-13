import { mkdir, readFile, writeFile } from "node:fs/promises";
import path from "node:path";
import { GetObjectCommand, PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import type { ClassificationTable, OfferingsFeed, ProgramFeed, RinkFeed, RinkIndex } from "@openice/shared";

export interface FeedStore {
  readClassifications(): Promise<ClassificationTable | undefined>;
  writeClassifications(table: ClassificationTable): Promise<void>;
  writeFeed(feed: RinkFeed): Promise<void>;
  writeProgramFeed(feed: ProgramFeed): Promise<void>;
  readProgramFeed(programId: string): Promise<ProgramFeed | undefined>;
  writeIndex(index: RinkIndex): Promise<void>;
  writeOfferings(feed: OfferingsFeed): Promise<void>;
}

const JSON_INDENT = 2;

export class LocalStore implements FeedStore {
  constructor(private readonly dir: string) {}

  private async write(rel: string, value: unknown): Promise<void> {
    const file = path.join(this.dir, rel);
    await mkdir(path.dirname(file), { recursive: true });
    await writeFile(file, `${JSON.stringify(value, null, JSON_INDENT)}\n`);
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
}

export class S3Store implements FeedStore {
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
}

export async function persistResult(
  store: FeedStore,
  feeds: RinkFeed[],
  index: RinkIndex,
  table: ClassificationTable,
  programFeeds: ProgramFeed[] = [],
  offeringFeeds: OfferingsFeed[] = [],
): Promise<void> {
  for (const feed of feeds) await store.writeFeed(feed);
  for (const feed of programFeeds) await store.writeProgramFeed(feed);
  for (const feed of offeringFeeds) await store.writeOfferings(feed);
  await store.writeIndex(index);
  await store.writeClassifications(table);
}
