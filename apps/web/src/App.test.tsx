import type { RinkFeed, RinkIndex } from "@openice/shared";
import { render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { selectOpenIce } from "./views/OpenIceView";

const rink = {
  id: "ed-burns-arlington",
  name: "Ed Burns Arena",
  town: "Arlington",
  address: "422 Summer St",
  lat: 0,
  lng: 0,
  driveMinutes: 3,
  driveMiles: 1.4,
  scheduleUrl: "https://example.org",
  source: { kind: "link-only" as const },
};

function futureIso(hoursFromNow: number, durationHours = 1): [string, string] {
  const start = new Date(Date.now() + hoursFromNow * 3_600_000);
  const end = new Date(start.getTime() + durationHours * 3_600_000);
  return [start.toISOString(), end.toISOString()];
}

const [s1, e1] = futureIso(2);
const [s2, e2] = futureIso(5);
const [s3, e3] = futureIso(-3, 1);

const feed: RinkFeed = {
  rink,
  fetchedAt: new Date().toISOString(),
  rangeStart: "",
  rangeEnd: "",
  errors: [],
  events: [
    { id: "a", rinkId: rink.id, title: "Family Stick & Puck", category: "stick_puck_family", classifiedBy: "rule", start: s1, end: e1 },
    { id: "b", rinkId: rink.id, title: "AHC", category: "private_rental", classifiedBy: "lookup", start: s2, end: e2 },
    { id: "c", rinkId: rink.id, title: "Mens' Stick & Puck", category: "stick_puck_adult", classifiedBy: "rule", start: s3, end: e3 },
  ],
};

const index: RinkIndex = {
  generatedAt: new Date().toISOString(),
  rinks: [{ rink, fetchedAt: feed.fetchedAt, eventCount: 3, openIceCount: 2, ok: true, errors: [] }],
};

afterEach(() => {
  window.location.hash = "";
  window.localStorage?.clear?.();
});

describe("selectOpenIce", () => {
  it("keeps upcoming open-ice sessions within the drive and day limits", () => {
    const rows = selectOpenIce([feed], { categories: ["stick_puck_family", "stick_puck_adult"], days: 7, maxDrive: 60, rinkIds: null }, new Date());
    expect(rows.map((r) => r.id)).toEqual(["a"]);
    expect(selectOpenIce([feed], { categories: ["stick_puck_family"], days: 7, maxDrive: 2, rinkIds: null }, new Date())).toEqual([]);
    expect(selectOpenIce([feed], { categories: ["stick_puck_family"], days: 7, maxDrive: 60, rinkIds: ["other"] }, new Date())).toEqual([]);
  });
});

describe("App", () => {
  it("renders the open ice list from /data JSON", async () => {
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.endsWith("/index.json") ? index : feed;
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole("list").querySelectorAll(".session")).toHaveLength(1));
    expect(screen.getByRole("list")).toHaveTextContent("Family Stick & Puck");
    expect(screen.queryByText("AHC")).not.toBeInTheDocument();
    expect(screen.getAllByText(/3 min/).length).toBeGreaterThan(0);
  });

  it("renders the rink calendar view for a hash route", async () => {
    window.location.hash = "#/rink/ed-burns-arlington";
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.endsWith("/index.json") ? index : feed;
        return new Response(JSON.stringify(body), { status: 200 });
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "Ed Burns Arena" })).toBeInTheDocument());
    await waitFor(() => expect(screen.getByRole("table", { name: "Week schedule" })).toBeInTheDocument());
    expect(screen.getByText("Official schedule")).toBeInTheDocument();
  });

  it("shows an error with retry when the index fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load rink data."));
  });
});
