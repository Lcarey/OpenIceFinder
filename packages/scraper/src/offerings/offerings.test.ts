import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { clinicsFromStinkysocks, clinicsFromWarrior } from "./clinics.js";
import { parseStinkysocksPage } from "./stinkysocks.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");

describe("stinkysocks", () => {
  it("parses NCH listings with register and waitlist links", () => {
    const offerings = parseStinkysocksPage(readFileSync(path.join(fixturesDir, "stinkysocks-nch.html"), "utf8"));
    expect(offerings.map((o) => [o.title, o.rinkId, o.status, o.kind])).toEqual([
      ["SUN 9/13/26 - Cambridge - 8:40 PM - Mixed Lower (Levels 2-4)", "simoni-cambridge", "open", "adult_pickup"],
      ["THU 9/17/26 - Medford - 9:10 PM - Mixed Mid (Levels 3-5)", "flynn-medford", "open", "adult_pickup"],
      ["SAT 9/19/26 - Somerville - 4:00 PM - Skills Clinic", "veterans-somerville", "waitlist", "skills"],
    ]);
    expect(offerings[0]!.start).toBe("2026-09-13T20:40:00-04:00");
    expect(offerings[0]!.registerUrl).toContain("ADD=NCH-202609131840CAM");
    expect(offerings[1]!.registerUrl).toContain("ADD=NCH-202609172110MED");
    expect(offerings[2]!.registerUrl).toContain("waitlist");
    expect(clinicsFromStinkysocks(offerings)).toHaveLength(1);
  });
});

describe("warrior clinics", () => {
  it("keeps skills and LTP and drops public hockey", () => {
    const clinics = clinicsFromWarrior([
      { title: "Public Hockey", start: "2026-09-14T13:00:00-04:00", end: "2026-09-14T13:50:00-04:00" },
      { title: "Hockey Programs & Classes - WIA- Friday Skills", start: "2026-09-18T17:00:00-04:00", end: "2026-09-18T17:50:00-04:00" },
      { title: "Hockey Programs & Classes - WIA- Adult Learn To Play Hockey", start: "2026-09-16T20:00:00-04:00", end: "2026-09-16T21:00:00-04:00" },
    ]);
    expect(clinics.map((c) => [c.title, c.kind, c.audience])).toEqual([
      ["WIA- Friday Skills", "skills", "youth"],
      ["WIA- Adult Learn To Play Hockey", "learn_to_play", "adult"],
    ]);
    expect(clinics[0]!.registerUrl).toContain("youth-hockey-skills");
  });
});
