import type { RinkFeed, RinkIndex } from "@openice/shared";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { selectOpenIce } from "./views/OpenIceView";
import { opponentSlug } from "./views/RangersView";

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
  window.history.replaceState({}, "", "/");
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
    expect(screen.queryByRole("link", { name: /rangers/i })).not.toBeInTheDocument();
    expect(screen.queryByText(/Jr\. Rangers/)).not.toBeInTheDocument();
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

  it("renders the StinkySocks page from a hash route", async () => {
    window.location.hash = "#/stinkysocks";
    const offerings = {
      id: "stinkysocks" as const,
      fetchedAt: new Date().toISOString(),
      rangeStart: "",
      rangeEnd: "",
      errors: [],
      offerings: [
        {
          id: "ss-1",
          provider: "stinkysocks",
          kind: "adult_pickup" as const,
          title: "THU 9/17/26 - Medford - Mixed Mid",
          start: s1,
          end: e1,
          rinkId: rink.id,
          location: "Medford - LoConte Memorial Rink",
          registerUrl: "https://secure.stinkysocks.net/register/medford",
          status: "open" as const,
        },
      ],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        const body = url.endsWith("/index.json") ? index : url.includes("/offerings/stinkysocks") ? offerings : feed;
        return new Response(JSON.stringify(body), { status: 200, headers: { "Content-Type": "application/json" } });
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 2, name: "StinkySocks pickup" })).toBeInTheDocument());
    expect(screen.getByRole("link", { name: /Register/i })).toHaveAttribute("href", "https://secure.stinkysocks.net/register/medford");
    expect(screen.getByText(/Medford - Mixed Mid/)).toBeInTheDocument();
  });

  it("shows an error with retry when the index fails", async () => {
    vi.stubGlobal("fetch", vi.fn(async () => new Response("nope", { status: 500 })));
    render(<App />);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent("Couldn’t load rink data."));
  });

  it("renders the hidden rangers tape from /rangers without a main-nav link", async () => {
    window.history.replaceState({}, "", "/rangers");
    window.location.hash = "#winter-club";
    const writeText = vi.fn().mockResolvedValue(undefined);
    Object.defineProperty(navigator, "clipboard", { configurable: true, value: { writeText } });
    const scrollIntoView = vi.fn();
    Element.prototype.scrollIntoView = scrollIntoView;
    const rangers = {
      fetchedAt: new Date().toISOString(),
      sourceUrl: "https://www.elite9hockey.com/pages/standings/boys-2026-27/",
      scheduleUrl: "https://www.elite9hockey.com/pages/schedules/boys-2026-27-schedule/",
      seasonLabel: "2026–27",
      team: {
        teamId: "797",
        name: "Boston Jr. Rangers 16 - Elite",
        shortName: "Jr. Rangers 16 - Elite",
        division: "2016 White",
        rank: 5,
        isUs: true,
        record: { gp: 1, wins: 0, losses: 1, ties: 0, points: 0, gf: 0, ga: 7, gd: -7, streak: "L 1", lastFive: "0-1-0" },
      },
      standings: [
        {
          teamId: "902",
          name: "Winter Club 16 - Elite",
          shortName: "Winter Club 16 - Elite",
          division: "2016 White",
          rank: 1,
          isUs: false,
          record: { gp: 2, wins: 1, losses: 1, ties: 0, points: 2, gf: 13, ga: 3, gd: 10, streak: "L 1", lastFive: "1-1-0" },
        },
        {
          teamId: "797",
          name: "Boston Jr. Rangers 16 - Elite",
          shortName: "Jr. Rangers 16 - Elite",
          division: "2016 White",
          rank: 5,
          isUs: true,
          record: { gp: 1, wins: 0, losses: 1, ties: 0, points: 0, gf: 0, ga: 7, gd: -7, streak: "L 1", lastFive: "0-1-0" },
        },
      ],
      recent: [
        {
          date: "2026-09-13",
          opponentId: "814",
          opponentName: "Avalanche 16 - E 2",
          result: "L" as const,
          ourScore: 0,
          theirScore: 7,
          isHome: false,
          location: "Ice Den",
          rink: "Hooksett",
        },
      ],
      upcoming: [
        {
          opponent: {
            teamId: "902",
            name: "Winter Club 16 - Elite",
            shortName: "Winter Club 16 - Elite",
            division: "2016 White",
            rank: 1,
            isUs: false,
            record: { gp: 2, wins: 1, losses: 1, ties: 0, points: 2, gf: 13, ga: 3, gd: 10, streak: "L 1", lastFive: "1-1-0" },
          },
          game: { date: "2026-09-27", opponentId: "902", opponentName: "Winter Club 16 - Elite", isHome: false, location: "Pilgrim C", rink: "Hingham" },
          beaten: [
            { date: "2026-09-12", opponentId: "852", opponentName: "Railers 16 - S 1", result: "W" as const, ourScore: 11, theirScore: 0, isHome: true, location: "Pilgrim C", rink: "Hingham" },
          ],
          lostTo: [
            { date: "2026-09-13", opponentId: "975", opponentName: "Icemen 16 - E", result: "L" as const, ourScore: 2, theirScore: 3, isHome: false, location: "East Boston", rink: "East Boston" },
          ],
          tied: [],
          warmup: [{ date: "2026-09-19", opponentId: "814", opponentName: "Avalanche 16 - E 2", isHome: false, location: "Ice Den", rink: "Hooksett" }],
          belief: { level: "steal" as const, label: "Gettable", score: 59, why: [], blurb: "Winter Club dropped a one-goal game to Icemen.", gradedAt: "2026-09-14T16:00:00.000Z", sampleGp: 1 },
        },
      ],
      errors: [],
    };
    vi.stubGlobal(
      "fetch",
      vi.fn(async (url: string) => {
        if (String(url).includes("/rangers.json")) return new Response(JSON.stringify(rangers), { status: 200 });
        return new Response("nope", { status: 500 });
      }),
    );
    render(<App />);
    await waitFor(() => expect(screen.getByRole("heading", { level: 1, name: "2016 Jr. Rangers" })).toBeInTheDocument());
    expect(document.title).toBe("Jr. Rangers forecast");
    expect(document.querySelector('link[rel="icon"]')?.getAttribute("href")).toMatch(/rangers-logo\.png/);
    expect(screen.queryByText(/Hidden page/i)).not.toBeInTheDocument();
    expect(screen.queryByText(/Scouting tape for the next three/i)).not.toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 2, name: "Next five" })).toBeInTheDocument();
    expect(screen.getByText(/Last: L 0–7 @ Avalanche/i)).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: "Winter Club 16 - Elite" })).toBeInTheDocument();
    expect(document.getElementById("winter-club")).toBeTruthy();
    await waitFor(() => expect(scrollIntoView).toHaveBeenCalled());
    expect(screen.getByText(/Have lost to/i).closest("section")).toHaveTextContent("Icemen");
    expect(screen.getByText("Gettable")).toBeInTheDocument();
    expect(screen.getByText(/graded Sep 14 · 1 GP/i)).toBeInTheDocument();
    expect(screen.getByText("Before they see us").closest(".tape-warmup")).toHaveTextContent("Sep 19 @ Avalanche");
    expect(screen.queryByText(/Before they see us:.*Avalanche/)).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "Copy link" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledWith("http://localhost/rangers#winter-club"));
    expect(screen.getByRole("button", { name: "Copied" })).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /2016 White/i })).toBeInTheDocument();
    expect(screen.queryByRole("navigation", { name: "Views" })).not.toBeInTheDocument();
  });
});

describe("opponentSlug", () => {
  it("strips the 16 age tag for hash links", () => {
    expect(opponentSlug("Winter Club 16 - Elite")).toBe("winter-club");
    expect(opponentSlug("NH Avalanche 16 - Elite 2")).toBe("nh-avalanche");
    expect(opponentSlug("Jr. Bruins 16 - E")).toBe("jr-bruins");
  });
});
