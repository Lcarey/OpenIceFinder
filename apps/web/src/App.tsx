import { lazy, Suspense, useEffect, useState } from "react";
import type { MainRoute } from "./MainApp";

const RangersView = lazy(() => import("./views/RangersView").then((m) => ({ default: m.RangersView })));
const MainApp = lazy(() => import("./MainApp").then((m) => ({ default: m.MainApp })));

type Route = MainRoute | { view: "rangers" };

function parseRoute(pathname: string, hash: string): Route {
  const path = pathname.replace(/\/+$/, "") || "/";
  if (path === "/rangers" || /^#\/rangers\/?(\?.*)?$/.test(hash)) return { view: "rangers" };
  if (/^#\/stinkysocks/.test(hash)) return { view: "stinkysocks" };
  if (/^#\/clinics/.test(hash)) return { view: "clinics" };
  const match = hash.match(/^#\/(rink|ice)\/([^/?]+)/);
  if (match) return { view: match[1] as "rink" | "ice", rinkId: decodeURIComponent(match[2]!) };
  return { view: "open" };
}

function useRoute(): Route {
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname, window.location.hash));
  useEffect(() => {
    const onChange = () => setRoute(parseRoute(window.location.pathname, window.location.hash));
    window.addEventListener("hashchange", onChange);
    window.addEventListener("popstate", onChange);
    return () => {
      window.removeEventListener("hashchange", onChange);
      window.removeEventListener("popstate", onChange);
    };
  }, []);
  return route;
}

export function App() {
  const route = useRoute();
  if (route.view === "rangers") {
    return (
      <Suspense fallback={<p className="tape-shell loading">Pulling Elite 9 standings…</p>}>
        <RangersView />
      </Suspense>
    );
  }
  return (
    <Suspense fallback={<p className="loading">Loading rinks…</p>}>
      <MainApp route={route} />
    </Suspense>
  );
}
