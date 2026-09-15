import type { OfferingsFeed, RinkIndex } from "@openice/shared";
import { OfferingsView } from "./OfferingsView";

const BEGINNER_LEARN = /learn to (play|skate)|\bltp\b|\blts\b/i;

function skillsFeed(feed: OfferingsFeed | null): OfferingsFeed | null {
  if (!feed) return null;
  return {
    ...feed,
    offerings: feed.offerings.filter((o) => o.kind !== "learn_to_play" && !BEGINNER_LEARN.test(o.title)),
  };
}

export function ClinicsView({ index, feed }: { index: RinkIndex; feed: OfferingsFeed | null }) {
  return (
    <OfferingsView
      title="Clinics & skills"
      intro="Bookable skills sessions from Warrior, FMC, and StinkySocks. Each listing links to the provider’s registration page."
      feed={skillsFeed(feed)}
      index={index}
      kindFilters={[
        { id: "skills", label: "Skills" },
        { id: "clinic", label: "Clinics" },
        { id: "fmc_class", label: "FMC classes" },
      ]}
    />
  );
}
