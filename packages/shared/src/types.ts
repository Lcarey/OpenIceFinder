import type { IceCategory } from "./categories.js";

/** How a rink publishes its schedule. Each variant maps to one scraper adapter. */
export type RinkSource =
  | {
      kind: "myrec-calendar";
      /** e.g. https://arlingtonma.myrec.com */
      baseUrl: string;
      facilityId: number;
      areaId?: number;
    }
  | {
      kind: "myrec-program";
      baseUrl: string;
      /** Program detail pages whose activity tables list dated sessions. */
      programIds: number[];
    }
  | {
      kind: "frontline";
      /** e.g. https://flynn.frontline-connect.com */
      baseUrl: string;
      fac: string;
      facId: number;
      /** Session id -> human label used as the event title. */
      sessions: Record<string, string>;
    }
  | {
      kind: "halix";
      /** e.g. https://fmc.myhalix.io */
      baseUrl: string;
      sandbox: string;
      businessKey: string;
      calendarKeys: string[];
    }
  | {
      kind: "finnly";
      /** e.g. https://warrior.finnlyconnect.com */
      baseUrl: string;
      scheduleIds: number[];
    }
  | {
      kind: "ical";
      url: string;
    }
  | {
      kind: "civicengage";
      /** e.g. https://www.stoneham-ma.gov */
      baseUrl: string;
      /** Calendar id (CID query param). */
      calendarId: number;
    }
  | {
      kind: "rectimes";
      /** e.g. https://api.rectimes.com */
      apiBaseUrl: string;
      facility: string;
      venueIds: number[];
    }
  | {
      kind: "document-vision";
      /** Public PDF or image URLs (or HTML pages that link to them) describing the schedule. */
      documentUrls: string[];
      /** Free-form hints for the model (e.g. season, what counts as stick & puck here). */
      hints?: string;
    }
  | {
      kind: "link-only";
      reason?: string;
    }
  | {
      kind: "weekly-hours";
      /** Inclusive local date the pattern starts (YYYY-MM-DD). */
      seasonStart?: string;
      /** Inclusive local date the pattern ends (YYYY-MM-DD). */
      seasonEnd?: string;
      sessions: WeeklyHoursSession[];
    };

export interface WeeklyHoursSession {
  title: string;
  /** 0 = Sunday … 6 = Saturday. */
  days: number[];
  /** 24h clock, e.g. "12:00" or "9:20". */
  start: string;
  end: string;
  /** Skip Massachusetts school-vacation weeks (DCR stick time). */
  skipSchoolVacations?: boolean;
}

export interface Rink {
  id: string;
  name: string;
  /** Single emoji used as the rink's visual marker in lists. */
  emoji?: string;
  /** Very light tint (hex) used as the row background for this rink's events. */
  color?: string;
  town: string;
  address: string;
  lat: number;
  lng: number;
  /** Driving minutes from Arlington Center (free-flow OSRM estimate). */
  driveMinutes: number;
  /** Driving distance in miles. */
  driveMiles: number;
  website?: string;
  /** Human-facing schedule page to link to. */
  scheduleUrl?: string;
  operator?: string;
  source: RinkSource;
  notes?: string;
}

export interface RawEvent {
  title: string;
  /** ISO 8601 with offset, e.g. 2026-09-15T14:00:00-04:00 */
  start: string;
  end: string;
  allDay?: boolean;
  surface?: string;
  url?: string;
  description?: string;
}

export interface IceEvent extends RawEvent {
  id: string;
  rinkId: string;
  category: IceCategory;
  /** How the category was determined. */
  classifiedBy: "rule" | "lookup" | "model" | "default";
}

export interface RinkFeed {
  rink: Rink;
  fetchedAt: string;
  rangeStart: string;
  rangeEnd: string;
  events: IceEvent[];
  errors: string[];
}

export interface RinkIndexEntry {
  rink: Rink;
  fetchedAt: string;
  eventCount: number;
  openIceCount: number;
  nextOpenIce?: IceEvent;
  ok: boolean;
  errors: string[];
}

export interface OfferingsIndexEntry {
  fetchedAt: string;
  eventCount: number;
  ok: boolean;
  errors: string[];
}

export interface RinkIndex {
  generatedAt: string;
  rinks: RinkIndexEntry[];
  programs?: ProgramIndexEntry[];
  offerings?: {
    stinkysocks?: OfferingsIndexEntry;
    clinics?: OfferingsIndexEntry;
  };
}

export type OfferingKind = "adult_pickup" | "clinic" | "skills" | "learn_to_play" | "fmc_class";
export type OfferingStatus = "open" | "waitlist" | "sold_out" | "canceled";
export type OfferingAudience = "adult" | "youth" | "both";
export type OfferingsCatalogId = "stinkysocks" | "clinics";

/** A bookable pickup game, clinic, or skills session from a third-party provider. */
export interface BookableOffering {
  id: string;
  provider: string;
  kind: OfferingKind;
  title: string;
  start: string;
  end: string;
  rinkId?: string;
  location: string;
  registerUrl: string;
  price?: string;
  level?: string;
  status?: OfferingStatus;
  audience?: OfferingAudience;
  notes?: string;
}

export interface OfferingsFeed {
  id: OfferingsCatalogId;
  fetchedAt: string;
  rangeStart: string;
  rangeEnd: string;
  offerings: BookableOffering[];
  errors: string[];
}

/**
 * A youth/adult hockey program whose team schedules reveal who is on the ice during a rink's
 * generic "rental" blocks (e.g. the "AHC" blocks on Ed Burns' town calendar).
 */
export type ProgramSource = {
  /** Crossbar-hosted club site (e.g. https://www.arlingtonice.com). */
  kind: "crossbar";
  baseUrl: string;
  /** Regex (case-insensitive) matched against a schedule row's location; matches mean "at the home rink". */
  homeLocationPattern: string;
};

export interface Program {
  id: string;
  name: string;
  /** Short label used in calendar blocks, e.g. "AHC". */
  shortName: string;
  /** The rink whose calendar this program's home-ice events annotate. */
  rinkId: string;
  website: string;
  source: ProgramSource;
}

export interface ProgramTeam {
  id: string;
  name: string;
  url: string;
}

export type ProgramEventType = "practice" | "game" | "meeting" | "other";

export interface ProgramEvent {
  id: string;
  type: ProgramEventType;
  /** ISO 8601 with offset. */
  start: string;
  end: string;
  /** Location text as published (e.g. "Arlington 1"). */
  location: string;
  atHomeRink: boolean;
  /** Every team or group using the ice in this slot, as published (own team + "sharing with"). */
  teams: string[];
  /** Program team ids for the entries in `teams` that map to a known team. */
  teamIds: string[];
  /** "vs." or "@" opponent for games. */
  opponent?: string;
  note?: string;
  url: string;
}

export interface ProgramFeed {
  program: Program;
  fetchedAt: string;
  rangeStart: string;
  rangeEnd: string;
  teams: ProgramTeam[];
  events: ProgramEvent[];
  errors: string[];
}

export interface ProgramIndexEntry {
  program: Program;
  fetchedAt: string;
  teamCount: number;
  eventCount: number;
  homeEventCount: number;
  ok: boolean;
  errors: string[];
}

/** Lookup table of (rinkId, normalized title) -> category. */
export interface ClassificationEntry {
  rinkId: string | "*";
  title: string;
  category: IceCategory;
  source: "seed" | "rule" | "model" | "manual";
  note?: string;
}

export interface ClassificationTable {
  version: 1;
  entries: ClassificationEntry[];
}

/** W-L-T plus goals for a youth hockey team in an Elite 9 standings group. */
export interface RangersRecord {
  gp: number;
  wins: number;
  losses: number;
  ties: number;
  points: number;
  gf: number;
  ga: number;
  gd: number;
  streak: string;
  lastFive: string;
}

export type RangersResult = "W" | "L" | "T";
export type RangersBeliefLevel = "steal" | "toss_up" | "uphill" | "long_shot";

export interface RangersStandingRow {
  teamId: string;
  name: string;
  shortName: string;
  division: string;
  logo?: string;
  rank: number;
  record: RangersRecord;
  isUs: boolean;
  /** USA 10U MyHockeyRankings listing rank, when published. */
  mhrRank?: number;
  /** Team page on myhockeyrankings.com for this Elite 9 club. */
  mhrUrl?: string;
}

export interface RangersPlayedGame {
  date: string;
  start?: string;
  opponentId: string;
  opponentName: string;
  result: RangersResult;
  ourScore: number;
  theirScore: number;
  isHome: boolean;
  location: string;
  rink: string;
}

export interface RangersUpcomingGame {
  date: string;
  start?: string;
  opponentId: string;
  opponentName: string;
  isHome: boolean;
  location: string;
  rink: string;
}

export interface RangersBelief {
  level: RangersBeliefLevel;
  /** Short label for the lamp, e.g. "Gettable". */
  label: string;
  /** 0–100 scouting score; not a prediction market. */
  score: number;
  why: string[];
  blurb: string;
  /** ISO time the grade was computed. */
  gradedAt?: string;
  /** Our GP when the grade was computed. */
  sampleGp?: number;
}

export interface RangersScoutCard {
  opponent: RangersStandingRow;
  game: RangersUpcomingGame;
  beaten: RangersPlayedGame[];
  lostTo: RangersPlayedGame[];
  tied: RangersPlayedGame[];
  /** Games this opponent plays before they see us. */
  warmup: RangersUpcomingGame[];
  prior?: RangersPlayedGame;
  belief: RangersBelief;
}

/** Hidden /rangers page feed: 2016 Boston Jr. Rangers scouting tape from Elite 9. */
export interface RangersFeed {
  fetchedAt: string;
  sourceUrl: string;
  scheduleUrl: string;
  seasonLabel: string;
  team: RangersStandingRow;
  standings: RangersStandingRow[];
  recent: RangersPlayedGame[];
  upcoming: RangersScoutCard[];
  errors: string[];
}
