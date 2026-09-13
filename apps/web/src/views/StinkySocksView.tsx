import type { OfferingsFeed, RinkIndex } from "@openice/shared";
import { OfferingsView } from "./OfferingsView";

const LOCATIONS = [
  { id: "flynn-medford", label: "Medford" },
  { id: "veterans-somerville", label: "Somerville" },
  { id: "simoni-cambridge", label: "Cambridge" },
  { id: "cronin-revere", label: "Revere" },
  { id: "belmont-sports-complex", label: "Belmont" },
];

export function StinkySocksView({ index, feed }: { index: RinkIndex; feed: OfferingsFeed | null }) {
  return (
    <OfferingsView
      title="StinkySocks pickup"
      intro="Adult pickup hockey and skills clinics from StinkySocks. Register on their site — Medford Thursdays are at LoConte (Flynn)."
      feed={feed}
      index={index}
      locationFilters={LOCATIONS}
      kindFilters={[
        { id: "adult_pickup", label: "Pickup games" },
        { id: "skills", label: "Skills" },
        { id: "clinic", label: "Clinics" },
      ]}
    />
  );
}
