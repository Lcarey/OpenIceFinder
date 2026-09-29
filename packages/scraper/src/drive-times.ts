import { CalculateRoutesCommand, GeoRoutesClient, type CalculateRoutesCommandInput } from "@aws-sdk/client-geo-routes";
import { DRIVE_ORIGIN, RINK_TIME_ZONE, localDateKey, localToIso, type DriveEstimate, type Rink, type RinkFeed } from "@openice/shared";

export interface DriveTimeStore {
  readDriveTime(key: string): Promise<DriveEstimate | undefined>;
  /** Insert only; if another writer already saved this key, return that original value. */
  writeDriveTime(key: string, estimate: DriveEstimate): Promise<DriveEstimate>;
}

type Slot = { weekday: number; arrivalTime: string };
const clock = new Intl.DateTimeFormat("en-US", {
  timeZone: RINK_TIME_ZONE, weekday: "short", hour: "2-digit", minute: "2-digit", hourCycle: "h23",
});
const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function driveSlot(start: string): Slot {
  const parts = clock.formatToParts(new Date(start));
  const value = (key: string) => parts.find((part) => part.type === key)!.value;
  return { weekday: WEEKDAYS.indexOf(value("weekday")), arrivalTime: `${value("hour")}:${value("minute")}` };
}

export function driveCacheKey(rink: Rink, start: string): string {
  const slot = driveSlot(start);
  // Version covers provider, car/fastest routing, arrival semantics, timezone, and prediction policy.
  // Origin/destination coordinates prevent reuse if a location is corrected. No date or event title.
  return `v1/${DRIVE_ORIGIN.position.join(",")}/${encodeURIComponent(rink.id)}/${rink.lng},${rink.lat}/${slot.weekday}/${slot.arrivalTime.replace(":", "")}`;
}

/** Use a matching weekday 7–13 days ahead so a one-off live traffic jam is not saved forever. */
export function predictionArrival(start: string, now: Date): string {
  const slot = driveSlot(start);
  const date = new Date(`${localDateKey(now)}T12:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 7 + (slot.weekday - date.getUTCDay() + 7) % 7);
  const [hour, minute] = slot.arrivalTime.split(":").map(Number) as [number, number];
  return localToIso({ year: date.getUTCFullYear(), month: date.getUTCMonth() + 1, day: date.getUTCDate(), hour, minute });
}

export function routeRequest(rink: Rink, start: string, now: Date): CalculateRoutesCommandInput {
  return {
    Origin: [...DRIVE_ORIGIN.position],
    Destination: [rink.lng, rink.lat],
    TravelMode: "Car",
    OptimizeRoutingFor: "FastestRoute",
    ArrivalTime: predictionArrival(start, now),
    Traffic: { Usage: "UseTrafficData", FlowEventThresholdOverride: 0 },
    MaxAlternatives: 0,
  };
}

type RouteSummary = { durationSeconds: number; distanceMeters: number };
export type CalculateDrive = (request: CalculateRoutesCommandInput) => Promise<RouteSummary>;

export function amazonDriveCalculator(): CalculateDrive {
  // Local runs use the same region as the deployed app; Lambda sets AWS_REGION itself.
  const client = new GeoRoutesClient({ region: process.env.AWS_REGION ?? "us-east-1", maxAttempts: 3 });
  return async (request) => {
    const response = await client.send(new CalculateRoutesCommand(request), { abortSignal: AbortSignal.timeout(20_000) });
    const summary = response.Routes?.[0]?.Summary;
    if (!summary || response.Notices?.some((notice) => notice.Impact === "High")) {
      throw new Error("Amazon Location could not calculate a usable route");
    }
    return { durationSeconds: summary.Duration!, distanceMeters: summary.Distance! };
  };
}

export class DriveTimes {
  readonly stats = { cached: 0, calculated: 0, failed: 0 };
  private readonly pending = new Map<string, Promise<DriveEstimate | undefined>>();
  private readonly now: Date;
  private readonly calculate: CalculateDrive;
  private readonly log: (message: string) => void;

  constructor(private readonly store: DriveTimeStore, options: { now?: Date; calculate?: CalculateDrive; log?: (message: string) => void } = {}) {
    this.now = options.now ?? new Date();
    this.calculate = options.calculate ?? amazonDriveCalculator();
    this.log = options.log ?? (() => {});
  }

  get(rink: Rink, start: string): Promise<DriveEstimate | undefined> {
    const key = driveCacheKey(rink, start);
    let promise = this.pending.get(key);
    if (!promise) {
      promise = this.lookup(key, rink, start).catch((error) => {
        this.stats.failed++;
        this.log(`[drive:${rink.id}] ${driveSlot(start).weekday}/${driveSlot(start).arrivalTime}: ${error instanceof Error ? error.message : String(error)}`);
        // Failure is not written to the persistent cache; a later refresh can retry.
        return undefined;
      });
      this.pending.set(key, promise);
    }
    return promise;
  }

  private async lookup(key: string, rink: Rink, start: string): Promise<DriveEstimate> {
    const cached = await this.store.readDriveTime(key);
    if (cached) {
      this.stats.cached++;
      return cached; // Deliberately no age check or expiry.
    }
    const request = routeRequest(rink, start, this.now);
    const summary = await this.calculate(request);
    if (!Number.isFinite(summary.durationSeconds) || summary.durationSeconds <= 0
      || !Number.isFinite(summary.distanceMeters) || summary.distanceMeters <= 0) {
      throw new Error("Amazon Location returned an invalid duration or distance");
    }
    const estimate: DriveEstimate = {
      provider: "amazon-location", ...driveSlot(start), ...summary,
      calculatedAt: this.now.toISOString(), sampleArrival: request.ArrivalTime!,
    };
    // Save each success immediately, so a later scrape error or Lambda timeout cannot lose it.
    const saved = await this.store.writeDriveTime(key, estimate);
    this.stats.calculated++;
    return saved;
  }
}

/** All timed calendar sessions share the same cache, even across event titles and later weeks. */
export async function attachDriveTimes(feeds: RinkFeed[], drives: DriveTimes): Promise<void> {
  const items = feeds.flatMap((feed) => feed.events.filter((event) => !event.allDay).map((event) => ({ rink: feed.rink, event })));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, items.length) }, async () => {
    while (next < items.length) {
      const { rink, event } = items[next++]!;
      event.drive = await drives.get(rink, event.start);
    }
  }));
}
