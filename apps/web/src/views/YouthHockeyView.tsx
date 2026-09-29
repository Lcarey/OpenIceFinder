import { selectYouthGames, youthCalendarUrl, youthDirectionsUrl, youthDriveLabel, YOUTH_LEAGUES, YOUTH_STALE_LIMIT_MS, type YouthBirthYear, type YouthHockeyFeed, type YouthLeague, type YouthWindow } from "@openice/shared";
import { CalendarPlus, ExternalLink, MapPin } from "lucide-react";
import { useEffect, useState } from "react";
import { loadYouthHockey } from "../api";
import { dateKeyOf, dayLabel, formatRelativeFetched, formatTime, groupByDay, shiftDateKey } from "../format";

export function YouthHockeyView() {
  const [feed, setFeed] = useState<YouthHockeyFeed | null>(null);
  const [error, setError] = useState<string>();
  const [reload, setReload] = useState(0);
  const [window, setWindow] = useState<YouthWindow>("month");
  const [year, setYear] = useState<YouthBirthYear>();
  const [league, setLeague] = useState<YouthLeague>();
  const [now, setNow] = useState(() => new Date());
  useEffect(() => {
    let cancelled = false;
    setError(undefined);
    loadYouthHockey().then((data) => { if (!cancelled) { setFeed(data); setNow(new Date()); } }).catch((e: unknown) => { if (!cancelled) setError(e instanceof Error ? e.message : String(e)); });
    return () => { cancelled = true; };
  }, [reload]);
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 60_000);
    return () => clearInterval(timer);
  }, []);
  const games = feed ? selectYouthGames(feed, { window, year, league }, now) : [];
  const today = dateKeyOf(now);
  const allUnavailable = feed?.sources.every((s) => !s.fetchedAt || now.getTime() - Date.parse(s.fetchedAt) > YOUTH_STALE_LIMIT_MS);
  return <section className="view youth-view">
    <header className="offerings-intro">
      <p className="youth-eyebrow">A game to watch together</p>
      <h2>High level youth hockey</h2>
      <p>Watch 2015 &amp; 2016 teams play, follow their positioning, and see how the game flows. Every game is under a 30-minute estimated drive from Arlington.</p>
      <p className="dim">FED Elite, E9 Elite rosters across divisions, and verified AAA teams. Drive estimates exclude traffic.</p>
    </header>
    <div className="filters" aria-label="Youth hockey filters">
      <div className="filter-row">
        <div className="filter-group"><span className="filter-label">When</span><div className="chips">
          {([['today', 'Today'], ['weekend', 'This weekend'], ['month', 'Next 30 days']] as const).map(([value, label]) => <button type="button" key={value} className={`chip${window === value ? " on" : ""}`} aria-pressed={window === value} onClick={() => setWindow(value)}>{label}</button>)}
        </div></div>
        <label className="youth-select">Birth year<select value={year ?? "all"} onChange={(e) => setYear(e.target.value === "all" ? undefined : Number(e.target.value) as YouthBirthYear)}><option value="all">2015 &amp; 2016</option><option value="2015">2015</option><option value="2016">2016</option></select></label>
        <label className="youth-select">League<select value={league ?? "all"} onChange={(e) => setLeague(e.target.value === "all" ? undefined : e.target.value as YouthLeague)}><option value="all">All leagues</option>{YOUTH_LEAGUES.map((l) => <option key={l}>{l}</option>)}</select></label>
      </div>
    </div>
    {error && <div className="notice error" role="alert">Couldn&rsquo;t load youth hockey. {error} <button className="link-button" type="button" onClick={() => setReload((n) => n + 1)}>Retry</button></div>}
    {!feed && !error && <p className="loading" role="status">Loading games to watch…</p>}
    {feed && <>
      <div className="youth-coverage" aria-label="Schedule coverage">{feed.sources.map((source) => {
        const age = source.fetchedAt ? now.getTime() - Date.parse(source.fetchedAt) : Infinity;
        const status = age > YOUTH_STALE_LIMIT_MS ? "unavailable" : source.status === "ok" && age > 12 * 3600_000 ? "stale" : source.status;
        return <div key={source.id} className={`youth-source ${status}`}><a href={source.url} target="_blank" rel="noreferrer">{source.name}</a><span>{status === "ok" ? `Checked ${formatRelativeFetched(source.fetchedAt!, now.getTime())}` : status === "stale" ? `Stale · last verified ${formatRelativeFetched(source.fetchedAt!, now.getTime())}` : "Schedule unavailable"}</span>{source.message && <small>{source.message}</small>}{Boolean(source.excludedVenues?.length) && <small>{source.excludedVenues!.length} venue(s) need a verified location or route.</small>}</div>;
      })}</div>
      <p className="youth-count" role="status">{games.length} {games.length === 1 ? "game" : "games"} to watch</p>
      {!games.length && <div className="empty"><p>{allUnavailable ? "Schedules are temporarily unavailable." : "No matching games in this window."}</p><p className="dim">{allUnavailable ? "Use the official schedule links above, or try again after the next refresh." : "Try another date or birth year. New games appear as schedules are published."}</p></div>}
      {groupByDay(games).map((group) => <section className="day-group" key={group.dateKey}><h3 className="day-heading">{dayLabel(group.dateKey, today, shiftDateKey(today, 1))}</h3><ol className="session-list">{group.events.map((g) => <li className="session youth-game" key={g.id}>
        <div className="session-time"><time dateTime={g.start}>{formatTime(g.start)}</time><span className="kind-pill">{g.birthYear}</span><span className="youth-drive">{youthDriveLabel(g.driveSeconds)} drive</span><a className="youth-calendar" href={youthCalendarUrl(g)} target="_blank" rel="noreferrer" title="Add to Google Calendar" aria-label={`Add ${g.away.name} vs ${g.home.name} to Google Calendar`}><CalendarPlus size={18} aria-hidden="true"/></a></div>
        <div className="session-main"><div className="session-title">{g.away.name} <span className="dim">vs</span> {g.home.name}</div><p className="youth-division">{g.league} · {g.division}</p><div className="session-meta"><MapPin size={14} aria-hidden="true"/><strong>{g.venue.name}</strong>{g.iceSheet && <span>· {g.iceSheet}</span>}<span>· {g.venue.town}</span></div><p className="youth-address">{g.venue.address}</p>{!(g.home.eligible && g.away.eligible) && <p className="youth-qualifies">Qualifying team: {g.home.eligible ? g.home.name : g.away.name}</p>}<div className="youth-links"><a href={g.sourceUrl} target="_blank" rel="noreferrer">Official schedule <ExternalLink size={12}/></a><a href={youthDirectionsUrl(g)} target="_blank" rel="noreferrer">Directions <ExternalLink size={12}/></a></div></div>
      </li>)}</ol></section>)}
    </>}
  </section>;
}
