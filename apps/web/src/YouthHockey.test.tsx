import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { App } from "./App";
import { YouthHockeyView } from "./views/YouthHockeyView";
import type { YouthHockeyFeed } from "@openice/shared";
const fixture = (): YouthHockeyFeed => {
  const now = new Date();
  return { version: 1, generatedAt: now.toISOString(), rangeStart: now.toISOString(), rangeEnd: new Date(now.getTime() + 90 * 86400000).toISOString(), sources: [{ id: "e9", name: "Elite 9", url: "https://official.example", status: "ok", attemptedAt: now.toISOString(), fetchedAt: now.toISOString(), gameCount: 1 }], games: [{ id: "1", sourceId: "e9", birthYear: 2016, league: "Elite 9", division: "2016 White", home: { id: "h", name: "Rangers Elite", eligible: true, division: "2016 White" }, away: { id: "a", name: "Opponent", eligible: false, division: "2016 White" }, start: new Date(now.getTime() + 48 * 3600000).toISOString(), venue: { id: "edge", name: "The Edge", town: "Bedford", address: "191 Hartwell Rd, Bedford, MA 01730" }, iceSheet: "Upper", sourceUrl: "https://official.example", verifiedAt: now.toISOString(), driveSeconds: 1400, driveMeters: 12000 }] };
};
afterEach(() => { window.location.hash = ""; vi.unstubAllGlobals(); });
describe("youth hockey page", () => {
  it("shows cached MHR ratings beside the correct birth-year teams, preserving unrated Rangers", async () => {
    const data = fixture();
    data.games[0]!.home.name = "Boston Jr. Rangers 16 - Elite";
    data.games[0]!.away.name = "Junior Railers 16 - Elite";
    const mhr = { version: 1, season: 2026, sources: [{ birthYear: 2016, fetchedAt: new Date().toISOString() }], teams: [
      { id: 1116, name: "Boston Junior Rangers 10U AAA", birthYear: 2016, url: "https://myhockeyrankings.com/team-info/1116/2026" },
      { id: 1321, name: "Worcester Jr Railers (Elite) 10U AAA", birthYear: 2016, rating: 88.9, url: "https://myhockeyrankings.com/team-info/1321/2026" },
      { id: 99, name: "Worcester Jr Railers (Elite) 11U AAA", birthYear: 2015, rating: 77.04, rank: 174, url: "https://myhockeyrankings.com/team-info/99/2026" },
    ] };
    vi.stubGlobal("fetch", vi.fn(async (url: string) => new Response(JSON.stringify(url.endsWith("/mhr.json") ? mhr : data))));
    render(<YouthHockeyView />);
    const rating = await screen.findByRole("link", { name: /MYHockey.*Railers.*89/ });
    expect(rating).toHaveAttribute("href", mhr.teams[1]!.url);
    expect(rating).toHaveTextContent(/^89$/);
    expect(screen.getByRole("link", { name: /MYHockey.*Rangers.*Not rated yet/ })).toHaveAttribute("href", mhr.teams[0]!.url);
    expect(screen.queryByText(/77.04/)).not.toBeInTheDocument();
  });
  it("loads independently when the rink index fails; nav follows Clinics", async () => {
    window.location.hash = "#/youth-hockey";
    const data = fixture();
    vi.stubGlobal("fetch", vi.fn(async (url: string) => url.includes("youth-hockey.json") ? new Response(JSON.stringify(data)) : new Response("unavailable", { status: 503 })));
    render(<App />);
    await screen.findByText("Qualifying team: Rangers Elite");
    const links = screen.getByRole("navigation", { name: "Views" }).querySelectorAll("a");
    expect([...links].slice(-3).map(a => a.textContent?.trim())).toEqual(["Clinics", "High level youth hockey", "Rangers"]);
    const calendar = screen.getByRole("link", { name: /Add Opponent vs Rangers Elite/ });
    expect(calendar).toHaveAttribute("target", "_blank");
    expect(calendar.getAttribute("href")).toContain("calendar.google.com");
    expect(screen.getByRole("link", { name: /Directions/ }).getAttribute("href")).not.toContain("origin=");
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "2015" } });
    expect(screen.queryByRole("link", { name: /Add Opponent/ })).not.toBeInTheDocument();
    expect(screen.getByText(/No matching games/)).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("Birth year"), { target: { value: "2016" } });
    expect(screen.getByRole("link", { name: /Add Opponent/ })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText("League"), { target: { value: "FED Elite" } });
    expect(screen.queryByRole("link", { name: /Add Opponent/ })).not.toBeInTheDocument();
  });
  it("shows loading, a recoverable feed error, and retries", async () => {
    let resolve!: (r: Response) => void;
    const fetchMock = vi.fn().mockImplementationOnce(() => new Promise<Response>(r => { resolve = r; })).mockResolvedValue(new Response(JSON.stringify(fixture())));
    vi.stubGlobal("fetch", fetchMock);
    render(<YouthHockeyView />);
    expect(screen.getByText(/Loading.*games/)).toBeInTheDocument();
    resolve(new Response("unavailable", { status: 503 }));
    await screen.findByRole("alert");
    fireEvent.click(screen.getByRole("button", { name: /Retry/ }));
    await screen.findByRole("link", { name: /Add Opponent/ });
    expect(fetchMock).toHaveBeenCalledTimes(3);
  });
  it("distinguishes stale data from unavailable coverage and expires stale games", async () => {
    const data = fixture();
    data.sources[0]!.status = "stale";
    data.sources[0]!.fetchedAt = new Date(Date.now() - 24 * 3600000).toISOString();
    data.games[0]!.verifiedAt = data.sources[0]!.fetchedAt;
    vi.stubGlobal("fetch", vi.fn(async () => new Response(JSON.stringify(data))));
    const rendered = render(<YouthHockeyView />);
    await screen.findByRole("link", { name: /Add Opponent/ });
    expect(screen.getByText(/stale/i)).toBeInTheDocument();
    rendered.unmount();
    data.sources[0]!.status = "unavailable";
    data.sources[0]!.fetchedAt = new Date(Date.now() - 49 * 3600000).toISOString();
    data.games[0]!.verifiedAt = data.sources[0]!.fetchedAt;
    render(<YouthHockeyView />);
    await waitFor(() => expect(screen.getByText(/Schedule unavailable/)).toBeInTheDocument());
    expect(screen.queryByRole("link", { name: /Add Opponent/ })).not.toBeInTheDocument();
  });
});
