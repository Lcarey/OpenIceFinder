import type { OfferingsFeed, ProgramFeed, RinkFeed, RinkIndex } from "@openice/shared";
import { CalendarDays, Dumbbell, RefreshCw, Shield, Shirt, Snowflake, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadAllFeeds, loadAllProgramFeeds, loadIndex, loadOfferings } from "./api";
import { formatRelativeFetched } from "./format";
import { ClinicsView } from "./views/ClinicsView";
import { IceUsageView } from "./views/IceUsageView";
import { OpenIceView } from "./views/OpenIceView";
import { RinkView } from "./views/RinkView";
import { StinkySocksView } from "./views/StinkySocksView";
import { YouthHockeyView } from "./views/YouthHockeyView";

export type MainRoute =
  | { view: "open" }
  | { view: "rink"; rinkId: string }
  | { view: "ice"; rinkId: string }
  | { view: "stinkysocks" }
  | { view: "clinics" }
  | { view: "youth-hockey" };

export function MainApp({ route }: { route: MainRoute }) {
  const [index, setIndex] = useState<RinkIndex | null>(null);
  const [feeds, setFeeds] = useState<RinkFeed[] | null>(null);
  const [programFeeds, setProgramFeeds] = useState<ProgramFeed[] | null>(null);
  const [stinkysocks, setStinkysocks] = useState<OfferingsFeed | null>(null);
  const [clinics, setClinics] = useState<OfferingsFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadIndex()
      .then(async (idx) => {
        if (cancelled) return;
        setIndex(idx);
        const [all, programs, socks, skills] = await Promise.all([
          ["open", "rink", "ice"].includes(route.view) ? loadAllFeeds(idx) : Promise.resolve([]),
          route.view === "ice" ? loadAllProgramFeeds(idx) : Promise.resolve([]),
          route.view === "stinkysocks" ? loadOfferings("stinkysocks") : Promise.resolve(null),
          route.view === "clinics" ? loadOfferings("clinics") : Promise.resolve(null),
        ]);
        if (cancelled) return;
        setFeeds(all);
        setProgramFeeds(programs);
        setStinkysocks(socks);
        setClinics(skills);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken, route.view]);

  const usageRinkId = route.view === "ice" ? route.rinkId : index?.programs?.[0]?.program.rinkId;
  const usageRink = usageRinkId ? index?.rinks.find((r) => r.rink.id === usageRinkId)?.rink : undefined;
  const generatedAt = index?.generatedAt;
  const staleLabel = useMemo(() => (generatedAt ? formatRelativeFetched(generatedAt) : null), [generatedAt]);

  return (
    <div className="shell">
      <header className="topbar">
        <a className="brand" href="#/">
          <span className="brand-mark" aria-hidden="true">
            <Snowflake size={26} strokeWidth={2.2} />
          </span>
          <span>
            <h1>OpenIceFinder</h1>
            <p className="tagline">Stick &amp; puck, public hockey, and coach&rsquo;s ice near Arlington</p>
          </span>
        </a>
        <nav className="nav" aria-label="Views">
          <a className={route.view === "open" ? "nav-link active" : "nav-link"} href="#/">
            <Snowflake size={16} /> Open ice
          </a>
          <a className={route.view === "rink" ? "nav-link active" : "nav-link"} href={route.view === "rink" ? `#/rink/${route.rinkId}` : `#/rink/${index?.rinks[0]?.rink.id ?? ""}`}>
            <CalendarDays size={16} /> Rink calendar
          </a>
          {usageRink && (
            <a className={route.view === "ice" ? "nav-link active" : "nav-link"} href={`#/ice/${usageRink.id}`} title={`Who's on the ice at ${usageRink.name}`}>
              <Users size={16} /> {usageRink.emoji ? `${usageRink.emoji} ` : ""}Who&rsquo;s on the ice
            </a>
          )}
          <a className={route.view === "stinkysocks" ? "nav-link active" : "nav-link"} href="#/stinkysocks">
            <Shirt size={16} /> StinkySocks
          </a>
          <a className={route.view === "clinics" ? "nav-link active" : "nav-link"} href="#/clinics">
            <Dumbbell size={16} /> Clinics
          </a>
          <a className={route.view === "youth-hockey" ? "nav-link active" : "nav-link"} href="#/youth-hockey">
            <Users size={16} /> High level youth hockey
          </a>
          <a className="nav-link" href="/rangers"><Shield size={16} /> Rangers</a>
        </nav>
      </header>

      {error && route.view !== "youth-hockey" && (
        <div className="notice error" role="alert">
          <strong>Couldn&rsquo;t load rink data.</strong> {error}{" "}
          <button type="button" className="link-button" onClick={() => setReloadToken((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}

      {!error && !index && route.view !== "youth-hockey" && <p className="loading">Loading rinks…</p>}
      {route.view === "youth-hockey" && <YouthHockeyView />}

      {index && route.view === "open" && <OpenIceView index={index} feeds={feeds} />}
      {index && route.view === "rink" && <RinkView index={index} feeds={feeds} rinkId={route.rinkId} />}
      {index && route.view === "ice" && <IceUsageView index={index} feeds={feeds} programFeeds={programFeeds} rinkId={route.rinkId} />}
      {index && route.view === "stinkysocks" && <StinkySocksView index={index} feed={stinkysocks} />}
      {index && route.view === "clinics" && <ClinicsView index={index} feed={clinics} />}

      <footer className="footer">
        <span>
          <RefreshCw size={13} /> {route.view === "youth-hockey" ? "Youth schedules checked every 24 hours" : `Schedules refreshed ${staleLabel ?? "…"} · updated every 24 hours`}
        </span>
        <span>Times are Eastern. Always confirm with the rink before you go.</span>
      </footer>
    </div>
  );
}
