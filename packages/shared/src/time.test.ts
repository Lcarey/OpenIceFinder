import { describe, expect, it } from "vitest";
import { localDateKey, localToIso, parseClock, parseDateOnly, parseUsDateTime } from "./time.js";

describe("time helpers", () => {
  it("converts Boston wall-clock times with the right DST offset", () => {
    expect(localToIso({ year: 2026, month: 9, day: 15, hour: 14, minute: 0 })).toBe("2026-09-15T14:00:00-04:00");
    expect(localToIso({ year: 2026, month: 12, day: 15, hour: 14, minute: 0 })).toBe("2026-12-15T14:00:00-05:00");
  });

  it("parses clock strings in several formats", () => {
    expect(parseClock("2:00 PM")).toEqual({ hour: 14, minute: 0 });
    expect(parseClock("3:50P")).toEqual({ hour: 15, minute: 50 });
    expect(parseClock("12:00 AM")).toEqual({ hour: 0, minute: 0 });
    expect(parseClock("12:30 pm")).toEqual({ hour: 12, minute: 30 });
    expect(parseClock("14:00")).toEqual({ hour: 14, minute: 0 });
    expect(parseClock("nope")).toBeNull();
  });

  it("parses date-only strings", () => {
    expect(parseDateOnly("Sep 15 2026")).toEqual({ year: 2026, month: 9, day: 15 });
    expect(parseDateOnly("09/19/2026")).toEqual({ year: 2026, month: 9, day: 19 });
    expect(parseDateOnly("9/13/26")).toEqual({ year: 2026, month: 9, day: 13 });
    expect(parseDateOnly("2026-09-15")).toEqual({ year: 2026, month: 9, day: 15 });
  });

  it("parses myrec timestamps", () => {
    expect(parseUsDateTime("9/1/2026 5:10:00 PM")).toBe("2026-09-01T17:10:00-04:00");
    expect(parseUsDateTime("9/7/2026 12:00:00 AM")).toBe("2026-09-07T00:00:00-04:00");
  });

  it("derives local date keys", () => {
    expect(localDateKey("2026-09-15T03:30:00Z")).toBe("2026-09-14");
  });
});
