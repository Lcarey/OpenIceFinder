import type { DriveEstimate, RinkIndexEntry } from "./types.js";

/** Address matched by Amazon Location on 2026-09-29. Coordinates are longitude, latitude. */
export const DRIVE_ORIGIN = {
  label: "107 Webster St, Arlington, MA",
  position: [-71.14375, 42.41674] as [number, number],
};

export function driveMinutes(drive: DriveEstimate): number {
  return Math.ceil(drive.durationSeconds / 60);
}

export function driveMiles(drive: DriveEstimate): string {
  return (drive.distanceMeters / 1609.344).toFixed(1);
}

/** Rink lists describe the next open session, since there is no single traffic-adjusted rink time. */
export function compareRinkDrives(a: RinkIndexEntry, b: RinkIndexEntry): number {
  return (a.nextOpenIce?.drive?.durationSeconds ?? Infinity) - (b.nextOpenIce?.drive?.durationSeconds ?? Infinity)
    || a.rink.name.localeCompare(b.rink.name);
}
