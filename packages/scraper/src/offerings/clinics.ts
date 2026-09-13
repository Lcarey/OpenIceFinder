import type { BookableOffering, IceEvent, RawEvent } from "@openice/shared";
import type { FmcClassEvent } from "../adapters/halix.js";
import { offeringId } from "./ids.js";

const WARRIOR_YOUTH_SKILLS = "https://www.warrioricearena.com/skating-hockey-programs/youth-hockey-skills-program/";
const WARRIOR_PROGRAMS = "https://www.warrioricearena.com/skating-hockey-programs/";
const WARRIOR_REGISTER = "https://warrior.finnlyconnect.com/registration/activityitemv2/35606";
const FMC_REGISTER = "https://fmc.myhalix.io/pages/allprograms";

export function isWarriorClinicTitle(title: string): boolean {
  const t = title.toLowerCase();
  if (/blocked|conflict|adult programming/.test(t)) return false;
  if (/public hockey|public skat/.test(t)) return false;
  return /skills|learn to play|\bltp\b|hockey programs/.test(t);
}

export function warriorRegisterUrl(title: string): string {
  const t = title.toLowerCase();
  if (/friday skills|squirt|peewee|bantam|mite/.test(t)) return WARRIOR_YOUTH_SKILLS;
  if (/adult skills|adult learn/.test(t)) return WARRIOR_PROGRAMS;
  if (/learn to play|\bltp\b/.test(t)) return WARRIOR_PROGRAMS;
  return WARRIOR_REGISTER;
}

export function warriorKind(title: string): BookableOffering["kind"] {
  const t = title.toLowerCase();
  if (/learn to play|\bltp\b/.test(t)) return "learn_to_play";
  if (/skills/.test(t)) return "skills";
  return "clinic";
}

export function clinicsFromWarrior(events: Array<RawEvent | IceEvent>, rinkId = "warrior-brighton"): BookableOffering[] {
  return events.filter((e) => isWarriorClinicTitle(e.title)).map((e) => {
    const registerUrl = warriorRegisterUrl(e.title);
    return {
      id: offeringId({ provider: "warrior", title: e.title, start: e.start, registerUrl }),
      provider: "warrior",
      kind: warriorKind(e.title),
      title: e.title.replace(/^hockey programs & classes\s*-\s*/i, ""),
      start: e.start,
      end: e.end,
      rinkId,
      location: "Warrior Ice Arena, Brighton",
      registerUrl,
      audience: /adult/.test(e.title.toLowerCase()) ? "adult" : "youth",
    };
  });
}

export function isFmcHockeyClass(title: string): boolean {
  const t = title.toLowerCase();
  if (/learn to skate|figure|freestyle|club ice/.test(t) && !/hockey|stick/.test(t)) return false;
  return /hockey|stick\s*(&|and)?\s*puck|skills|ltp|learn to play/.test(t);
}

export function clinicsFromFmc(classes: FmcClassEvent[]): BookableOffering[] {
  return classes.filter((e) => e.rinkId && isFmcHockeyClass(e.title)).map((e) => ({
    id: offeringId({ provider: "fmc", title: e.title, start: e.start, registerUrl: FMC_REGISTER }),
    provider: "fmc",
    kind: /learn to play|ltp/.test(e.title.toLowerCase()) ? "learn_to_play" : /skills/.test(e.title.toLowerCase()) ? "skills" : "fmc_class",
    title: e.title,
    start: e.start,
    end: e.end,
    rinkId: e.rinkId,
    location: e.description ?? e.surface ?? "FMC Ice Sports",
    registerUrl: FMC_REGISTER,
    audience: /adult/.test(e.title.toLowerCase()) ? "adult" : "youth",
  }));
}

export function clinicsFromStinkysocks(offerings: BookableOffering[]): BookableOffering[] {
  return offerings.filter((o) => o.kind === "skills" || o.kind === "clinic" || o.kind === "learn_to_play");
}

export function mergeClinicOfferings(...groups: BookableOffering[][]): BookableOffering[] {
  const seen = new Set<string>();
  const out: BookableOffering[] = [];
  for (const group of groups) {
    for (const item of group) {
      const key = `${item.provider}|${item.start}|${item.title.toLowerCase()}`;
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(item);
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}
