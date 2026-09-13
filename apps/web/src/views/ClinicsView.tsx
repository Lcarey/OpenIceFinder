import type { OfferingsFeed, RinkIndex } from "@openice/shared";
import { OfferingsView } from "./OfferingsView";

export function ClinicsView({ index, feed }: { index: RinkIndex; feed: OfferingsFeed | null }) {
  return (
    <OfferingsView
      title="Clinics & skills"
      intro="Bookable skills sessions and learn-to-play from Warrior, FMC, and StinkySocks. Each listing links to the provider’s registration page."
      feed={feed}
      index={index}
      kindFilters={[
        { id: "skills", label: "Skills" },
        { id: "learn_to_play", label: "Learn to play" },
        { id: "clinic", label: "Clinics" },
        { id: "fmc_class", label: "FMC classes" },
      ]}
    />
  );
}
