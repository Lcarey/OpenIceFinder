export const ICE_CATEGORIES = [
  "stick_puck_kids",
  "stick_puck_adult",
  "stick_puck_family",
  "stick_puck",
  "public_hockey",
  "coach_ice",
  "freestyle",
  "public_skate",
  "learn_to_skate",
  "private_rental",
  "closed",
  "other",
] as const;

export type IceCategory = (typeof ICE_CATEGORIES)[number];

export const OPEN_ICE_CATEGORIES: readonly IceCategory[] = [
  "stick_puck_kids",
  "stick_puck_adult",
  "stick_puck_family",
  "stick_puck",
  "public_hockey",
  "coach_ice",
];

export const CATEGORY_LABELS: Record<IceCategory, string> = {
  stick_puck_kids: "Kids' Stick & Puck",
  stick_puck_adult: "Adult Stick & Puck",
  stick_puck_family: "Family Stick & Puck",
  stick_puck: "Stick & Puck",
  public_hockey: "Public Hockey",
  coach_ice: "Coach's Ice",
  freestyle: "Freestyle",
  public_skate: "Public Skate",
  learn_to_skate: "Lessons",
  private_rental: "Private Rental",
  closed: "Closed",
  other: "Other",
};

export const CATEGORY_DESCRIPTIONS: Record<IceCategory, string> = {
  stick_puck_kids: "Stick & puck / open hockey practice session restricted to youth players (grades, ages, or 'kids' in the title).",
  stick_puck_adult: "Stick & puck / open hockey practice session restricted to adults (18+, men's, women's, over 30/40).",
  stick_puck_family: "Stick & puck session for parents and kids together, or explicitly 'family'.",
  stick_puck: "Stick & puck / shooting / drop-in hockey practice session with no clear age restriction.",
  public_hockey: "Drop-in pickup hockey game open to the public (public hockey, pickup, drop-in, adult open hockey, rat hockey).",
  coach_ice: "Coach's ice, coaches' ice, or paid open ice where players bring their own coach or run private lessons.",
  freestyle: "Figure skating freestyle / practice ice.",
  public_skate: "General public skating session (no sticks).",
  learn_to_skate: "Skating or hockey lessons, clinics, learn to play, learn to skate.",
  private_rental: "Ice rented by a team, league, club, school, or private party; not open to the public.",
  closed: "Rink closed, unavailable, holiday, maintenance.",
  other: "Anything else.",
};

export function isOpenIce(category: IceCategory): boolean {
  return OPEN_ICE_CATEGORIES.includes(category);
}

export function isIceCategory(value: unknown): value is IceCategory {
  return typeof value === "string" && (ICE_CATEGORIES as readonly string[]).includes(value);
}
