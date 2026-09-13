import { readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { parseCivicEngageList } from "./civicengage.js";
import { expandExtractedSchedule, type ExtractedSchedule } from "./document-vision.js";
import { parseFinnly } from "./finnly.js";
import { parseFrontlineMonth } from "./frontline.js";
import { parseHalixResponse } from "./halix.js";
import { expandVEvent, parseIcal } from "./ical.js";
import { parseMyRecCalendar } from "./myrec-calendar.js";
import { parseMyRecProgram } from "./myrec-program.js";
import { parseRecTimesBookings } from "./rectimes.js";
import { expandWeeklyHours } from "./weekly-hours.js";
import { overlayFmcClasses } from "./halix.js";

const fixturesDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..", "fixtures");
const fixture = (name: string) => readFileSync(path.join(fixturesDir, name), "utf8");

describe("myrec calendar", () => {
  it("parses Arlington facility events into rink-local ISO times", () => {
    const events = parseMyRecCalendar(fixture("myrec-calendar.json"), "https://arlingtonma.myrec.com/x");
    expect(events.length).toBeGreaterThan(200);
    const family = events.filter((e) => e.title === "Family Stick & Puck");
    expect(family.length).toBe(6);
    const mens = events.find((e) => e.title === "Mens' Stick & Puck");
    expect(mens).toBeDefined();
    expect(events.find((e) => e.title === "AHC" && e.start === "2026-09-01T17:10:00-04:00")?.end).toBe("2026-09-01T18:00:00-04:00");
    const unavailable = events.find((e) => e.title === "Unavailable");
    expect(unavailable?.allDay).toBe(true);
  });
});

describe("myrec program", () => {
  it("parses Belmont Stick and Puck activity rows", () => {
    const events = parseMyRecProgram(fixture("myrec-program.html"), "https://belmontma.myrec.com/p");
    expect(events.map((e) => [e.title, e.start, e.end, e.surface])).toEqual([
      ["Stick and Puck", "2026-09-19T15:30:00-04:00", "2026-09-19T17:30:00-04:00", "Belmont Sports Complex - Rink"],
      ["Stick and Puck", "2026-09-26T15:30:00-04:00", "2026-09-26T17:30:00-04:00", "Belmont Sports Complex - Rink"],
    ]);
  });
});

describe("frontline", () => {
  it("parses Flynn monthly walk-on sessions with surface and date", () => {
    const events = parseFrontlineMonth(fixture("frontline-month.html"), "Hockey Lesson Walk-On", "https://flynn.frontline-connect.com/m");
    expect(events.length).toBeGreaterThan(5);
    const sep15 = events.find((e) => e.start.startsWith("2026-09-15"));
    expect(sep15).toMatchObject({ title: "Hockey Lesson Walk-On", start: "2026-09-15T14:00:00-04:00", end: "2026-09-15T15:50:00-04:00", surface: "BIG RINK" });
    expect(events.every((e) => e.start < e.end)).toBe(true);
  });
});

describe("halix", () => {
  it("parses FMC bookings using usage times (excluding resurfacing)", () => {
    const events = parseHalixResponse(JSON.parse(fixture("halix-events.json")), "https://fmc.myhalix.io/pages/calendars.cambridge");
    expect(events.length).toBe(112);
    const first = events.find((e) => e.title === "Valley Hockey League");
    expect(first).toMatchObject({ start: "2026-09-13T07:00:00-04:00", end: "2026-09-13T08:00:00-04:00", surface: "Cambridge - Ice Sheet" });
    expect(events.some((e) => e.title === "FMC Ice Sports - Public Skating")).toBe(true);
  });
});

describe("finnly", () => {
  it("extracts the inline schedule and drops Conflict placeholders", () => {
    const events = parseFinnly(fixture("finnly-schedule.html"), "https://warrior.finnlyconnect.com/schedule/20");
    expect(events.length).toBe(12);
    expect(events.some((e) => e.title === "Public Hockey")).toBe(true);
    expect(events.some((e) => e.title.startsWith("Conflict"))).toBe(false);
    const sample = events[0]!;
    expect(sample.start).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}-0[45]:00$/);
  });
});

describe("civicengage", () => {
  it("parses Stoneham arena list items with end times", () => {
    const events = parseCivicEngageList(fixture("civicengage-list.html"), "https://www.stoneham-ma.gov");
    expect(events.length).toBeGreaterThan(20);
    const skate = events.find((e) => e.start === "2026-09-14T10:00:00-04:00");
    expect(skate).toMatchObject({ title: "PUBLIC SKATING", end: "2026-09-14T11:45:00-04:00" });
    expect(skate?.url).toContain("/Calendar.aspx?EID=");
    expect(events.some((e) => /ADULT STICK PRACTICE/.test(e.title))).toBe(true);
  });
});

describe("ical", () => {
  it("expands weekly RRULEs as rink-local times inside the window", () => {
    const vevents = parseIcal(fixture("daly.ics"));
    expect(vevents.length).toBe(4);
    const rangeStart = new Date("2026-09-13T04:00:00Z");
    const rangeEnd = new Date("2026-09-27T04:00:00Z");
    const events = vevents.flatMap((ev) => expandVEvent(ev, rangeStart, rangeEnd));
    expect(events.length).toBe(8);
    expect(events.every((e) => e.title === "Public Skating")).toBe(true);
    expect(events.map((e) => e.start)).toContain("2026-09-14T10:00:00-04:00");
    expect(events.find((e) => e.start === "2026-09-14T10:00:00-04:00")?.end).toBe("2026-09-14T12:00:00-04:00");
  });

  it("respects UNTIL", () => {
    const vevents = parseIcal(fixture("daly.ics"));
    const events = vevents.flatMap((ev) => expandVEvent(ev, new Date("2027-04-01T00:00:00Z"), new Date("2027-05-01T00:00:00Z")));
    expect(events).toEqual([]);
  });
});

describe("rectimes", () => {
  it("tolerates unknown field names", () => {
    const events = parseRecTimesBookings(
      [{ startTimeLocal: "2026-10-03T14:00:00Z", endTimeLocal: "2026-10-03T15:20:00Z", title: "Stick & Puck", venueName: "JAR" }],
      "https://app.rectimes.com/ryanarena",
    );
    expect(events).toEqual([{ title: "Stick & Puck", start: "2026-10-03T14:00:00-04:00", end: "2026-10-03T15:20:00-04:00", surface: "JAR", url: "https://app.rectimes.com/ryanarena" }]);
    expect(parseRecTimesBookings({ error: "nope" })).toEqual([]);
  });
});

describe("weekly hours", () => {
  it("expands weekly hours inside the season and skips school-vacation stick time", () => {
    const rangeStart = new Date("2026-11-27T05:00:00Z");
    const rangeEnd = new Date("2026-12-05T05:00:00Z");
    const events = expandWeeklyHours(
      [
        { title: "Public Skating", days: [0], start: "14:00", end: "15:50" },
        { title: "Public Stick Time", days: [3], start: "12:00", end: "13:50", skipSchoolVacations: true },
      ],
      rangeStart,
      rangeEnd,
      { seasonStart: "2026-11-28", seasonEnd: "2027-04-11" },
    );
    expect(events.map((e) => `${e.title}@${e.start}`)).toEqual([
      "Public Skating@2026-11-29T14:00:00-05:00",
      "Public Stick Time@2026-12-02T12:00:00-05:00",
    ]);
  });

  it("skips stick time during Thanksgiving week", () => {
    const events = expandWeeklyHours(
      [{ title: "Public Stick Time", days: [3], start: "12:00", end: "13:50", skipSchoolVacations: true }],
      new Date("2026-11-23T05:00:00Z"),
      new Date("2026-12-03T05:00:00Z"),
    );
    expect(events.map((e) => e.start)).toEqual(["2026-12-02T12:00:00-05:00"]);
  });
});

describe("fmc class overlay", () => {
  it("replaces generic FMC Programs titles when a class overlaps", () => {
    const bookings = [
      { title: "FMC Programs", start: "2026-09-15T16:00:00-04:00", end: "2026-09-15T16:50:00-04:00" },
      { title: "Valley Hockey League", start: "2026-09-15T17:00:00-04:00", end: "2026-09-15T18:00:00-04:00" },
    ];
    const classes = [
      { title: "Step 1: Learn to Skate", start: "2026-09-15T16:00:00-04:00", end: "2026-09-15T16:50:00-04:00", url: "https://fmc.myhalix.io/pages/allprograms" },
      { title: "Club Ice", start: "2026-09-15T18:10:00-04:00", end: "2026-09-15T19:00:00-04:00", url: "https://fmc.myhalix.io/pages/allprograms" },
    ];
    const out = overlayFmcClasses(bookings, classes);
    expect(out.map((e) => e.title)).toEqual(["Step 1: Learn to Skate", "Valley Hockey League", "Club Ice"]);
    expect(out[0]!.url).toContain("allprograms");
  });
});

describe("document-vision expansion", () => {
  const rangeStart = new Date("2026-09-14T04:00:00Z"); // Monday
  const rangeEnd = new Date("2026-09-28T04:00:00Z");

  it("expands weekly sessions, honouring validity and closures", () => {
    const extracted: ExtractedSchedule = {
      summary: "",
      confidence: "high",
      datedSessions: [{ title: "Public Skating", date: "2026-09-20", startTime: "14:00", endTime: "15:50", surface: null, notes: null }],
      weeklySessions: [
        { title: "Adult Stick & Puck", daysOfWeek: [2, 4], startTime: "12:00", endTime: "13:45", validFrom: "2026-09-15", validTo: "2026-09-24", surface: null, notes: null },
      ],
      closures: [{ from: "2026-09-22", to: "2026-09-22", reason: "holiday" }],
    };
    const events = expandExtractedSchedule(extracted, rangeStart, rangeEnd, "https://example.org/schedule");
    expect(events.map((e) => `${e.title}@${e.start}`)).toEqual([
      "Public Skating@2026-09-20T14:00:00-04:00",
      "Adult Stick & Puck@2026-09-15T12:00:00-04:00",
      "Adult Stick & Puck@2026-09-17T12:00:00-04:00",
      "Adult Stick & Puck@2026-09-24T12:00:00-04:00",
    ]);
  });

  it("drops sessions with invalid times", () => {
    const events = expandExtractedSchedule(
      { summary: "", confidence: "low", datedSessions: [{ title: "x", date: "2026-09-20", startTime: "bad", endTime: "15:00", surface: null, notes: null }], weeklySessions: [], closures: [] },
      rangeStart,
      rangeEnd,
      "",
    );
    expect(events).toEqual([]);
  });
});
