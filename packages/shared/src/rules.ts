import type { IceCategory } from "./categories.js";

/** Lowercase, collapse whitespace, strip escaping artifacts from myrec titles. */
export function normalizeTitle(title: string): string {
  return title
    .replace(/\\+'/g, "'")
    .replace(/\\+"/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\u201c\u201d]/g, '"')
    .replace(/\s+/g, " ")
    .trim()
    .toLowerCase();
}

const STICK_PUCK = /\b(stick\s*(&|and|n|')?\s*puck|sticks?\s*(&|and)\s*pucks?|stick\s+(practice|time|session|&\s*shoot)|shooting\s+practice|drop[-\s]?in\s+(hockey\s+)?practice)\b/;
const KIDS = /\b(kids?|youth|junior|jr\.?|grades?|k-\d|mites?|squirts?|pee\s*wees?|bantams?|under\s*\d+|u\d{1,2}|ages?\s*\d+\s*(-|to|&)\s*\d+|children|tots?|family\s*&\s*kids)\b/;
const ADULT = /\b(adult|adults|men'?s|mens|women'?s|womens|ladies|18\+|21\+|over\s*\d{2}|\d{2}\+|\d{2}\s*(and|&)\s*(up|over|older)|senior|old\s*timers?|masters?)\b/;
const FAMILY = /\b(family|parent\s*(&|and|\/)\s*(child|kid|tot))\b/;
const PUBLIC_HOCKEY = /\b(public\s+hockey|pick[-\s]?up\s+hockey|pickup|drop[-\s]?in\s+hockey|open\s+hockey|rat\s+hockey|shinny|adult\s+open\s+hockey|lunch(time)?\s+hockey|noon\s+hockey)\b/;
const COACH = /\b(coach(es|'s|s')?\s+ice|coaches?\s+(open\s+)?ice|open\s+ice|bring\s+your\s+own\s+coach|private\s+lesson\s+ice|instructional\s+ice)\b/;
const FREESTYLE = /\b(freestyle|free\s*style|figure\s+skating\s+(practice|ice|session)|fs\s+ice|dance\s+ice)\b/;
const PUBLIC_SKATE = /\b(public\s+skat(e|ing)|open\s+skat(e|ing)|family\s+skat(e|ing)|general\s+skat(e|ing)|skating\s+session|free\s+skate)\b/;
const LESSONS = /\b(learn\s+to\s+(skate|play)|lessons?|skating\s+school|clinic|camp|class(es)?|lts|ltp|intro\s+to|beginner|tot\s+skating|hockey\s+school|skills)\b/;
const CLOSED = /\b(closed|unavailable|holiday|maintenance|no\s+ice|ice\s+out|blocked|conflict)\b/;
const RENTAL = /\b(hockey\s+(club|league|association|assoc)|youth\s+hockey|high\s+school|hs\s|college|university|varsity|jv\b|party|birthday|tournament|game|practice|league|club|school|team|rental|private)\b/;

export interface RuleResult {
  category: IceCategory;
  rule: string;
}

/**
 * Keyword classification. Returns null when no rule confidently applies so the
 * caller can fall back to a lookup table or a model.
 */
export function classifyByRules(rawTitle: string): RuleResult | null {
  const title = normalizeTitle(rawTitle);
  if (!title) return null;

  if (CLOSED.test(title) && !STICK_PUCK.test(title) && !PUBLIC_HOCKEY.test(title)) {
    return { category: "closed", rule: "closed" };
  }
  if (STICK_PUCK.test(title)) {
    if (FAMILY.test(title)) return { category: "stick_puck_family", rule: "stick_puck+family" };
    if (KIDS.test(title)) return { category: "stick_puck_kids", rule: "stick_puck+kids" };
    if (ADULT.test(title)) return { category: "stick_puck_adult", rule: "stick_puck+adult" };
    return { category: "stick_puck", rule: "stick_puck" };
  }
  if (PUBLIC_HOCKEY.test(title)) return { category: "public_hockey", rule: "public_hockey" };
  if (COACH.test(title)) return { category: "coach_ice", rule: "coach_ice" };
  if (FREESTYLE.test(title)) return { category: "freestyle", rule: "freestyle" };
  if (PUBLIC_SKATE.test(title)) return { category: "public_skate", rule: "public_skate" };
  if (LESSONS.test(title)) return { category: "learn_to_skate", rule: "lessons" };
  if (RENTAL.test(title)) return { category: "private_rental", rule: "rental" };
  return null;
}
