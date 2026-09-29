import { mkdtemp, rm } from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { type DriveEstimate, type Rink } from "@openice/shared";
import { afterEach, describe, expect, it, vi } from "vitest";
import { DriveTimes, driveCacheKey, driveSlot, predictionArrival, routeRequest } from "./drive-times.js";
import { LocalStore, S3Store } from "./storage.js";
import { Classifier } from "./classify.js";
import { refreshAll } from "./refresh.js";
import type { S3Client } from "@aws-sdk/client-s3";

const rink: Rink = { id: "flynn-medford", name: "Flynn", town: "Medford", address: "", lat: 42.443, lng: -71.09, driveMinutes: 3, driveMiles: 1, source: { kind: "ical", url: "https://example.org" } };
const now = new Date("2026-09-29T14:00:00Z");
const start = "2026-09-29T14:00:00-04:00";
const winter = "2027-01-05T14:00:00-05:00";
const sample: DriveEstimate = { provider: "amazon-location", weekday: 2, arrivalTime: "14:00", durationSeconds: 901, distanceMeters: 5000, calculatedAt: now.toISOString(), sampleArrival: "2026-10-06T14:00:00-04:00" };
const directories: string[] = [];
async function localStore() {
  const dir = await mkdtemp(path.join(os.tmpdir(), "openice-drives-test-"));
  directories.push(dir);
  return { dir, store: new LocalStore(dir) };
}
afterEach(async () => { await Promise.all(directories.splice(0).map((dir) => rm(dir, { recursive: true, force: true }))); });

describe("recurring drive cache", () => {
  it("uses Boston weekday and minute, not the date, UTC offset, or UTC weekday", () => {
    expect(driveCacheKey(rink, start)).toBe(driveCacheKey(rink, winter));
    expect(driveCacheKey(rink, start)).toBe(driveCacheKey(rink, "2026-09-29T18:00:00Z"));
    expect(driveSlot("2026-09-30T02:00:00Z")).toEqual({ weekday: 2, arrivalTime: "22:00" });
    expect(driveSlot("2026-09-29T04:00:00Z")).toEqual({ weekday: 2, arrivalTime: "00:00" });
  });

  it("requests predicted traffic for arrival at the matching local time at least a week ahead", () => {
    expect(routeRequest(rink, start, now)).toMatchObject({
      Origin: [-71.14375, 42.41674], Destination: [-71.09, 42.443],
      ArrivalTime: "2026-10-06T14:00:00-04:00", TravelMode: "Car",
      Traffic: { Usage: "UseTrafficData", FlowEventThresholdOverride: 0 },
    });
    expect(routeRequest(rink, start, now)).not.toHaveProperty("DepartureTime");
    expect(predictionArrival(start, new Date("2026-10-27T15:00:00Z"))).toBe("2026-11-03T14:00:00-05:00");
  });

  it("deduplicates concurrent weekly sessions and reuses disk cache years later with no expiry", async () => {
    const { dir, store } = await localStore();
    const calculate = vi.fn().mockResolvedValue({ durationSeconds: 901, distanceMeters: 5000 });
    const drives = new DriveTimes(store, { now, calculate });
    const [first, repeated] = await Promise.all([drives.get(rink, start), drives.get(rink, winter)]);
    expect(first).toEqual(sample);
    expect(repeated).toEqual(first);
    expect(calculate).toHaveBeenCalledTimes(1);
    const later = new DriveTimes(new LocalStore(dir), { now: new Date("2030-01-01T12:00:00Z"), calculate });
    expect(await later.get(rink, winter)).toEqual(first);
    expect(later.stats).toEqual({ cached: 1, calculated: 0, failed: 0 });
    expect(calculate).toHaveBeenCalledTimes(1);
    expect(await store.writeDriveTime(driveCacheKey(rink, start), { ...sample, durationSeconds: 999 })).toEqual(first);
  });

  it("calculates only misses when weekday, minute, rink, or destination changes", async () => {
    const { store } = await localStore();
    const calculate = vi.fn().mockResolvedValue({ durationSeconds: 901, distanceMeters: 5000 });
    const drives = new DriveTimes(store, { now, calculate });
    await drives.get(rink, start);
    await drives.get(rink, "2026-09-30T14:00:00-04:00");
    await drives.get(rink, "2026-09-29T14:01:00-04:00");
    await drives.get({ ...rink, id: "other" }, start);
    await drives.get({ ...rink, lng: -71.1 }, start);
    expect(calculate).toHaveBeenCalledTimes(5);
  });

  it("does not permanently cache failures or invalid route results", async () => {
    const { store } = await localStore();
    const calculate = vi.fn().mockRejectedValueOnce(new Error("temporary outage"))
      .mockResolvedValueOnce({ durationSeconds: 0, distanceMeters: 5000 })
      .mockResolvedValue({ durationSeconds: 901, distanceMeters: 5000 });
    for (let attempt = 0; attempt < 2; attempt++) {
      const failed = new DriveTimes(store, { now, calculate });
      expect(await failed.get(rink, start)).toBeUndefined();
      expect(await store.readDriveTime(driveCacheKey(rink, start))).toBeUndefined();
      expect(failed.stats.failed).toBe(1);
    }
    expect(await new DriveTimes(store, { now, calculate }).get(rink, start)).toEqual(sample);
    expect(calculate).toHaveBeenCalledTimes(3);
  });

  it("preserves the winning S3 cache entry on a concurrent write and distinguishes access failures from misses", async () => {
    const send = vi.fn().mockRejectedValueOnce(Object.assign(new Error(), { name: "PreconditionFailed" }))
      .mockResolvedValueOnce({ Body: { transformToString: async () => JSON.stringify(sample) } })
      .mockRejectedValueOnce(Object.assign(new Error(), { name: "AccessDenied" }))
      .mockRejectedValueOnce(Object.assign(new Error(), { name: "NoSuchKey" }));
    const store = new S3Store("bucket", "data/", { send } as unknown as S3Client);
    expect(await store.writeDriveTime("key", { ...sample, durationSeconds: 999 })).toEqual(sample);
    expect(send.mock.calls[0]![0].input).toMatchObject({ Key: "data/drive-times/key.json", IfNoneMatch: "*" });
    await expect(store.readDriveTime("key")).rejects.toMatchObject({ name: "AccessDenied" });
    expect(await store.readDriveTime("missing")).toBeUndefined();
  });

  it("attaches one shared estimate to differently named weekly events and the index's next session", async () => {
    const { store } = await localStore();
    const calculate = vi.fn().mockResolvedValue({ durationSeconds: 901, distanceMeters: 5000 });
    const drives = new DriveTimes(store, { now, calculate });
    const result = await refreshAll({
      rinks: [rink], drives, now, classifier: new Classifier({ version: 1, entries: [] }, { model: "test" }),
      openai: async () => { throw new Error("not used"); }, openaiModel: "test",
      fetchEvents: async () => [
        { title: "Adult Stick & Puck", start, end: "2026-09-29T15:00:00-04:00" },
        { title: "Family Stick & Puck", start: "2026-10-06T14:00:00-04:00", end: "2026-10-06T15:00:00-04:00" },
        { title: "Closed", start, end: "2026-09-30T00:00:00-04:00", allDay: true },
      ],
    });
    expect(result.feeds[0]!.events.filter((event) => !event.allDay).map((event) => event.drive)).toEqual([sample, sample]);
    expect(result.feeds[0]!.events.find((event) => event.allDay)?.drive).toBeUndefined();
    expect(result.index.rinks[0]!.nextOpenIce?.drive).toEqual(sample);
    expect(calculate).toHaveBeenCalledTimes(1);
  });
});
