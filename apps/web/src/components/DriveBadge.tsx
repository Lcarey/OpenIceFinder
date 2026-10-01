import { driveMiles, driveMinutes, type DriveEstimate } from "@openice/shared";
import { Car } from "lucide-react";

export function driveDescription(drive?: DriveEstimate): string {
  return drive
    ? `${driveMiles(drive)} mi from Arlington. Amazon Location estimate with typical traffic, arriving at session start.`
    : `Drive estimate from Arlington unavailable.`;
}

export function DriveBadge({ drive, maxMinutes }: { drive?: DriveEstimate; maxMinutes?: number }) {
  const minutes = drive ? driveMinutes(drive) : undefined;
  // Preserve a strict cutoff in the label: a 29m 59s estimate is "<30 min".
  const label = drive && maxMinutes != null && drive.durationSeconds < maxMinutes * 60 && minutes! >= maxMinutes
    ? `<${maxMinutes} min`
    : minutes != null ? `${minutes} min` : "Drive unavailable";
  return (
    <span className="drive-pill" title={driveDescription(drive)}>
      <Car size={13} aria-hidden="true" /> {label}
    </span>
  );
}
