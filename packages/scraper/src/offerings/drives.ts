import type { OfferingsFeed } from "@openice/shared";
import venues from "../../../../data/stinkysocks-venues.json" with { type: "json" };
import { type DriveDestination, type DriveTimes } from "../drive-times.js";
import { mapStinkysocksRink } from "./stinkysocks.js";

/** Reuse the event cache for offerings, including venues outside the open-ice catalog. */
export async function attachStinkysocksDrives(feed: OfferingsFeed, rinks: DriveDestination[], drives: DriveTimes): Promise<void> {
  const destinations = new Map([...rinks, ...venues].map((rink) => [rink.id, rink]));
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(4, feed.offerings.length) }, async () => {
    while (next < feed.offerings.length) {
      const offering = feed.offerings[next++]!;
      // Remap old published feeds too; generic "Veterans" used to choose Somerville
      // for Everett, and LoConte is a different Medford rink from Flynn.
      offering.rinkId = mapStinkysocksRink(offering.location);
      const rink = offering.rinkId ? destinations.get(offering.rinkId) : undefined;
      offering.drive = rink ? await drives.get(rink, offering.start) : undefined;
    }
  }));
}
