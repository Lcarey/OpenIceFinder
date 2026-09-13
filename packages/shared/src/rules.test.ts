import { describe, expect, it } from "vitest";
import { classifyByRules, normalizeTitle } from "./rules.js";

describe("normalizeTitle", () => {
  it("strips myrec escaping and collapses whitespace", () => {
    expect(normalizeTitle("Mens\\' Stick &  Puck")).toBe("mens' stick & puck");
    expect(normalizeTitle("Kids\\' Stick & Puck (Grades K-5)")).toBe("kids' stick & puck (grades k-5)");
  });
});

describe("classifyByRules", () => {
  it.each([
    ["Family Stick & Puck", "stick_puck_family"],
    ["Mens\\' Stick & Puck", "stick_puck_adult"],
    ["Womens' Stick & Puck", "stick_puck_adult"],
    ["Kids\\' Stick & Puck (Grades K-5)", "stick_puck_kids"],
    ["Kids' Stick & Puck (Grades 6-12)", "stick_puck_kids"],
    ["Stick and Puck", "stick_puck"],
    ["Adult Stick & Puck 18+", "stick_puck_adult"],
    ["ADULT STICK PRACTICE *YOU MUST PRE-REGISTER SPACE LIMITED*", "stick_puck_adult"],
    ["Stick Practice", "stick_puck"],
    ["Stick and Puck | Ages 18 and Up", "stick_puck_adult"],
    ["Public Stick Time", "stick_puck"],
    ["Public Hockey", "public_hockey"],
    ["Adult Pickup Hockey", "public_hockey"],
    ["Coaches Ice", "coach_ice"],
    ["Coach's Ice", "coach_ice"],
    ["Freestyle", "freestyle"],
    ["Public Skate", "public_skate"],
    ["Public Skate (Special Time)", "public_skate"],
    ["FMC Ice Sports - Public Skating", "public_skate"],
    ["Learn to Skate - 7467", "learn_to_skate"],
    ["Tot Skating Lessons: Tuesday's Session 1", "learn_to_skate"],
    ["Hockey Lesson Walk-On", "learn_to_skate"],
    ["Unavailable", "closed"],
    ["Holiday", "closed"],
    ["Cambridge Youth Hockey", "private_rental"],
    ["Valley Hockey League", "private_rental"],
    ["Thapa Party", "private_rental"],
  ])("classifies %s as %s", (title, expected) => {
    expect(classifyByRules(title)?.category).toBe(expected);
  });

  it("returns null for opaque renter names", () => {
    expect(classifyByRules("AHC")).toBeNull();
    expect(classifyByRules("penguins")).toBeNull();
    expect(classifyByRules("Stinkysocks Hockey")).toBeNull();
  });
});
