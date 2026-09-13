import { describe, expect, it, vi } from "vitest";
import type OpenAI from "openai";
import { Classifier, mergeTables } from "./classify.js";

describe("Classifier", () => {
  it("prefers the lookup table over rules, then rules, then null", () => {
    const classifier = new Classifier(
      { version: 1, entries: [{ rinkId: "ed-burns-arlington", title: "AHC", category: "private_rental", source: "seed" }, { rinkId: "*", title: "Open Ice", category: "coach_ice", source: "manual" }] },
      { model: "test" },
    );
    expect(classifier.classify("ed-burns-arlington", "ahc")).toEqual({ category: "private_rental", classifiedBy: "lookup" });
    expect(classifier.classify("other", "OPEN ICE")).toEqual({ category: "coach_ice", classifiedBy: "lookup" });
    expect(classifier.classify("other", "Family Stick & Puck")).toEqual({ category: "stick_puck_family", classifiedBy: "rule" });
    expect(classifier.classify("other", "penguins")).toBeNull();
  });

  it("asks the model for unknown titles and remembers the answers", async () => {
    const create = vi.fn().mockResolvedValue({
      status: "completed",
      output_text: JSON.stringify({ items: [{ title: "penguins", category: "private_rental", reason: "team name" }, { title: "Stick Time", category: "stick_puck", reason: "" }] }),
    });
    const fakeClient = { responses: { create } } as unknown as OpenAI;
    const classifier = new Classifier({ version: 1, entries: [] }, { model: "test", openai: async () => fakeClient });
    await classifier.resolveWithModel([
      { rinkId: "r1", rinkName: "Rink One", title: "penguins" },
      { rinkId: "r1", rinkName: "Rink One", title: "Stick Time" },
      { rinkId: "r1", rinkName: "Rink One", title: "PENGUINS" },
    ]);
    expect(create).toHaveBeenCalledTimes(1);
    expect(classifier.classify("r1", "Penguins")).toEqual({ category: "private_rental", classifiedBy: "model" });
    expect(classifier.classify("r1", "stick time")).toEqual({ category: "stick_puck", classifiedBy: "model" });
    expect(classifier.added.map((e) => e.title)).toEqual(["penguins", "stick time"]);
  });

  it("survives model failures", async () => {
    const fakeClient = { responses: { create: vi.fn().mockRejectedValue(new Error("boom")) } } as unknown as OpenAI;
    const log = vi.fn();
    const classifier = new Classifier({ version: 1, entries: [] }, { model: "test", openai: async () => fakeClient, log });
    await classifier.resolveWithModel([{ rinkId: "r1", rinkName: "Rink One", title: "penguins" }]);
    expect(classifier.classify("r1", "penguins")).toBeNull();
    expect(classifier.fallback()).toEqual({ category: "private_rental", classifiedBy: "default" });
    expect(log).toHaveBeenCalledWith(expect.stringContaining("boom"));
  });
});

describe("mergeTables", () => {
  it("normalizes titles and lets later tables win", () => {
    const merged = mergeTables(
      { version: 1, entries: [{ rinkId: "r", title: "Mens\\' Stick & Puck", category: "stick_puck", source: "seed" }] },
      { version: 1, entries: [{ rinkId: "r", title: "mens' stick & puck", category: "stick_puck_adult", source: "manual" }] },
    );
    expect(merged.entries).toEqual([{ rinkId: "r", title: "mens' stick & puck", category: "stick_puck_adult", source: "manual" }]);
  });
});
