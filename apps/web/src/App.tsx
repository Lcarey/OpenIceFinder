import type { ProgramFeed, RinkFeed, RinkIndex } from "@openice/shared";
import { CalendarDays, RefreshCw, Snowflake, Users } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadAllFeeds, loadAllProgramFeeds, loadIndex } from "./api";
import { formatRelativeFetched } from "./format";
import { IceUsageView } from "./views/IceUsageView";
import { OpenIceView } from "./views/OpenIceView";
import { RinkView } from "./views/RinkView";

type Route = { view: "open" } | { view: "rink"; rinkId: string } | { view: "ice"; rinkId: string };

function parseRoute(hash: string): Route {
  const match = hash.match(/^#\/(rink|ice)\/([^/?]+)/);
  if (match) return { view: match[1] as "rink" | "ice", rinkId: decodeURIComponent(match[2]!) };
  return { view: "open" };
}

export function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.hash));
    window.addEventListener("hashchange", onChange);
    return () => window.removeEventListener("hashchange", onChange);
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  const [index, setIndex] = useState<RinkIndex | null>(null);
  const [feeds, setFeeds] = useState<RinkFeed[] | null>(null);
  const [programFeeds, setProgramFeeds] = useState<ProgramFeed[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadIndex()
      .then(async (idx) => {
        if (cancelled) return;
        setIndex(idx);
        const [all, programs] = await Promise.all([loadAllFeeds(idx), loadAllProgramFeeds(idx)]);
        if (cancelled) return;
        setFeeds(all);
        setProgramFeeds(programs);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reloadToken]);

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
        </nav>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <strong>Couldn&rsquo;t load rink data.</strong> {error}{" "}
          <button type="button" className="link-button" onClick={() => setReloadToken((t) => t + 1)}>
            Retry
          </button>
        </div>
      )}

      {!error && !index && <p className="loading">Loading rinks…</p>}

      {index && route.view === "open" && <OpenIceView index={index} feeds={feeds} />}
      {index && route.view === "rink" && <RinkView index={index} feeds={feeds} rinkId={route.rinkId} />}
      {index && route.view === "ice" && <IceUsageView index={index} feeds={feeds} programFeeds={programFeeds} rinkId={route.rinkId} />}

      <footer className="footer">
        <span>
          <RefreshCw size={13} /> Schedules refreshed {staleLabel ?? "…"} · updated every 6 hours
        </span>
        <span>Times are Eastern. Always confirm with the rink before you go.</span>
      </footer>
    </div>
  );
}
