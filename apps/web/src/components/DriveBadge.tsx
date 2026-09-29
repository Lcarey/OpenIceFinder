import { driveMiles, driveMinutes, type DriveEstimate } from "@openice/shared";
import { Car } from "lucide-react";

export function driveDescription(drive?: DriveEstimate): string {
  return drive
    ? `${driveMiles(drive)} mi from Arlington. Amazon Location estimate with typical traffic, arriving at session start.`
    : `Drive estimate from Arlington unavailable.`;
}

export function DriveBadge({ drive }: { drive?: DriveEstimate }) {
  return (
    <span className="drive-pill" title={driveDescription(drive)}>
      <Car size={13} /> {drive ? `${driveMinutes(drive)} min` : "Drive unavailable"}
    </span>
  );
}
