import type { BookableOffering, OfferingsFeed, RinkIndex } from "@openice/shared";
import { useMemo } from "react";
import { OfferingsView } from "./OfferingsView";

export function isNearbyStinkysocks(offering: BookableOffering): boolean {
  const drive = offering.drive;
  return drive?.provider === "amazon-location" && Number.isFinite(drive.durationSeconds)
    && drive.durationSeconds > 0 && drive.durationSeconds < 30 * 60;
}

export function StinkySocksView({ index, feed }: { index: RinkIndex; feed: OfferingsFeed | null }) {
  const nearby = useMemo(() => feed ? { ...feed, offerings: feed.offerings.filter(isNearbyStinkysocks) } : null, [feed]);
  const locations = useMemo(() => [...new Map((nearby?.offerings ?? []).filter((o) => o.rinkId).map((o) => [o.rinkId!, {
    id: o.rinkId!, label: o.location.split(/\s+-\s+/)[0]!,
  }])).values()].sort((a, b) => a.label.localeCompare(b.label)), [nearby]);
  return (
    <OfferingsView
      title="StinkySocks pickup"
      intro="Adult pickup hockey and skills clinics under a 30-minute drive from 107 Webster St, Arlington, MA, using typical traffic for arrival at the session’s start time. Register on StinkySocks."
      feed={nearby}
      index={index}
      locationFilters={locations}
      kindFilters={[
        { id: "adult_pickup", label: "Pickup games" },
        { id: "skills", label: "Skills" },
        { id: "clinic", label: "Clinics" },
      ]}
    />
  );
}
