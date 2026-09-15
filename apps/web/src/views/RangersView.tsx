import type { RangersBelief, RangersBeliefLevel, RangersFeed, RangersPlayedGame, RangersScoutCard, RangersStandingRow } from "@openice/shared";
import { formatMhrRank, matchRangersMhrTeam, rangersMhrUrl } from "@openice/shared";
import { CalendarDays, Check, ChevronDown, ExternalLink, Home, Link2, MapPin, Shield } from "lucide-react";
import { useEffect, useMemo, useState } from "react";
import { loadRangers } from "../api";
import { dateFromKey, formatDay, formatRelativeFetched, formatTime, formatWeekday } from "../format";

const LAMPS: Record<RangersBeliefLevel, number> = { steal: 4, toss_up: 3, uphill: 2, long_shot: 1 };
const WIDE_STANDINGS = "(min-width: 720px)";

export function opponentSlug(name: string): string {
  const trimmed = name.replace(/\b16\b.*$/i, "").trim();
  return (
    trimmed
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "") || "game"
  );
}

function gameAnchor(card: RangersScoutCard, used: Set<string>): string {
  const base = opponentSlug(card.opponent.shortName || card.opponent.name);
  let id = base;
  if (used.has(id)) id = `${base}-${card.game.date}`;
  used.add(id);
  return id;
}

function recordLine(row: { wins: number; losses: number; ties: number }): string {
  return `${row.wins}–${row.losses}–${row.ties}`;
}

function when(date: string, start?: string): string {
  const day = dateFromKey(date);
  const dateBit = `${formatWeekday(day, true)} ${formatDay(day)}`;
  return start ? `${dateBit} · ${formatTime(start)}` : dateBit;
}

function venue(game: { isHome: boolean; location: string; rink: string }): string {
  const place = [game.rink, game.location].filter(Boolean).join(" · ");
  return `${game.isHome ? "vs" : "@"} ${place || (game.isHome ? "home" : "away")}`;
}

function gradeStamp(belief: RangersBelief): string | null {
  if (!belief.gradedAt && belief.sampleGp == null) return null;
  const parts: string[] = [];
  if (belief.gradedAt) parts.push(`graded ${formatDay(belief.gradedAt)}`);
  if (belief.sampleGp != null) parts.push(`${belief.sampleGp} GP`);
  return parts.join(" · ");
}

function ResultChip({ game }: { game: RangersPlayedGame }) {
  return (
    <li className={`tape-result tape-${game.result.toLowerCase()}`}>
      <span className="tape-result-mark">{game.result}</span>
      <span>
        <strong>{game.opponentName}</strong>
        <span className="dim">
          {" "}
          {game.isHome ? "home" : "away"} · {formatDay(dateFromKey(game.date))}
        </span>
      </span>
      <span className="tape-result-score">
        {game.ourScore}–{game.theirScore}
      </span>
    </li>
  );
}

function Lamps({ level }: { level: RangersBeliefLevel }) {
  const on = LAMPS[level];
  return (
    <span className="tape-lamps" aria-hidden="true">
      {Array.from({ length: 4 }, (_, i) => (
        <span key={i} className={i < on ? "tape-lamp on" : "tape-lamp"} />
      ))}
    </span>
  );
}

function CopyGameLink({ id }: { id: string }) {
  const [copied, setCopied] = useState(false);
  return (
    <button
      type="button"
      className="tape-copy"
      onClick={() => {
        const url = `${window.location.origin}/rangers#${id}`;
        window.history.replaceState({}, "", `/rangers#${id}`);
        setCopied(true);
        window.setTimeout(() => setCopied(false), 1600);
        void navigator.clipboard?.writeText(url).catch(() => {});
      }}
    >
      {copied ? <Check size={14} /> : <Link2 size={14} />}
      {copied ? "Copied" : "Copy link"}
    </button>
  );
}

function ScoutSheet({ card, index, id }: { card: RangersScoutCard; index: number; id: string }) {
  const { opponent, game, beaten, lostTo, tied, warmup, belief } = card;
  const stamp = gradeStamp(belief);
  return (
    <article id={id} className={`tape-sheet belief-${belief.level}`}>
      <header className="tape-sheet-head">
        <div className="tape-sheet-kicker">
          <span>Game {index + 1}</span>
          <span>{when(game.date, game.start)}</span>
          <CopyGameLink id={id} />
        </div>
        <div className="tape-sheet-title">
          {opponent.logo ? <img src={opponent.logo} alt="" width={44} height={44} /> : <Shield size={28} />}
          <div>
            <h3>{opponent.name}</h3>
            <p>
              {recordLine(opponent.record)}
              {opponent.rank ? ` · ${opponent.rank}${ordinal(opponent.rank)} in ${opponent.division}` : ""} · {game.isHome ? "Home" : "Road"}
            </p>
          </div>
        </div>
        <p className="tape-venue">
          {game.isHome ? <Home size={14} /> : <MapPin size={14} />}
          {venue(game)}
        </p>
        <div className={`tape-grade belief-${belief.level}`}>
          <Lamps level={belief.level} />
          <div>
            <strong>{belief.label}</strong>
            <span>{stamp ?? "Can we beat them?"}</span>
          </div>
        </div>
      </header>

      <p className="tape-blurb">{belief.blurb}</p>

      <div className="tape-columns">
        <section>
          <h4>Have beaten</h4>
          {beaten.length === 0 ? <p className="dim">Nobody yet.</p> : <ul>{beaten.map((g) => <ResultChip key={`${g.date}-${g.opponentId}`} game={g} />)}</ul>}
        </section>
        <section>
          <h4>Have lost to</h4>
          {lostTo.length === 0 ? <p className="dim">Nobody has gotten to them yet.</p> : <ul>{lostTo.map((g) => <ResultChip key={`${g.date}-${g.opponentId}`} game={g} />)}</ul>}
        </section>
      </div>
      {tied.length > 0 && (
        <p className="dim tape-ties">
          Tied: {tied.map((g) => `${g.opponentName} ${g.ourScore}–${g.theirScore}`).join(", ")}
        </p>
      )}
      {warmup.length > 0 && (
        <div className="tape-warmup">
          <span className="tape-warmup-label">
            <CalendarDays size={14} /> Before they see us
          </span>
          <ul>
            {warmup.map((g) => (
              <li key={`${g.date}-${g.opponentId}`} className="tape-chip">
                {formatDay(dateFromKey(g.date))} {g.isHome ? "vs" : "@"} {g.opponentName}
              </li>
            ))}
          </ul>
        </div>
      )}
    </article>
  );
}

function mhrFor(row: RangersStandingRow): { url?: string; label: string; rank?: number } {
  const matched = matchRangersMhrTeam(row.name) ?? matchRangersMhrTeam(row.shortName);
  return {
    url: row.mhrUrl ?? (matched ? rangersMhrUrl(matched.id) : undefined),
    label: formatMhrRank(row.mhrRank),
    rank: row.mhrRank,
  };
}

function MhrValue({ row }: { row: RangersStandingRow }) {
  const { url, label, rank } = mhrFor(row);
  const aria = rank && rank > 0 ? `MyHockeyRankings rank ${rank}` : "MyHockeyRankings (rank not released)";
  if (!url) return label;
  return (
    <a href={url} target="_blank" rel="noreferrer" aria-label={aria}>
      {label}
    </a>
  );
}

function ordinal(n: number): string {
  const v = n % 100;
  if (v >= 11 && v <= 13) return "th";
  if (v % 10 === 1) return "st";
  if (v % 10 === 2) return "nd";
  if (v % 10 === 3) return "rd";
  return "th";
}

function standingsOpenDefault(): boolean {
  if (typeof window.matchMedia !== "function") return true;
  return window.matchMedia(WIDE_STANDINGS).matches;
}

function Standings({ rows }: { rows: RangersStandingRow[] }) {
  const [open, setOpen] = useState(standingsOpenDefault);
  const us = rows.find((row) => row.isUs);

  useEffect(() => {
    if (typeof window.matchMedia !== "function") return;
    const mq = window.matchMedia(WIDE_STANDINGS);
    const onChange = () => setOpen(mq.matches);
    mq.addEventListener("change", onChange);
    return () => mq.removeEventListener("change", onChange);
  }, []);

  return (
    <div className="tape-standings">
      <button type="button" className="tape-standings-toggle" aria-expanded={open} onClick={() => setOpen((v) => !v)}>
        <span>
          2016 White
          {us ? ` · ${us.rank}${ordinal(us.rank)} · ${recordLine(us.record)} · ${us.record.points} pts` : ""}
        </span>
        <span className="tape-standings-action">
          {open ? "Hide table" : "Full table"}
          <ChevronDown size={16} className={open ? "open" : undefined} />
        </span>
      </button>
      {!open && (
        <ul className="tape-standings-strip" aria-label="2016 White standings">
          {rows.map((row) => (
            <li key={row.teamId} className={row.isUs ? "us" : undefined}>
              <span className="tape-standings-rank">{row.rank}</span>
              <span className="tape-standings-name">{row.shortName}</span>
              <span className="tape-standings-rec">{recordLine(row.record)}</span>
              <span className="tape-standings-pts">{row.record.points}</span>
              <span className="tape-standings-mhr">
                <MhrValue row={row} />
              </span>
            </li>
          ))}
        </ul>
      )}
      {open && (
        <div className="tape-table-wrap">
          <table className="tape-table">
            <caption className="sr-only">2016 White</caption>
            <thead>
              <tr>
                <th>#</th>
                <th>Team</th>
                <th>
                  <abbr title="MyHockeyRankings USA 10U ranking">MHR</abbr>
                </th>
                <th>GP</th>
                <th>W–L–T</th>
                <th>PTS</th>
                <th>GF</th>
                <th>GA</th>
                <th>Diff</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => (
                <tr key={row.teamId} className={row.isUs ? "us" : undefined}>
                  <td>{row.rank}</td>
                  <td>{row.shortName}</td>
                  <td>
                    <MhrValue row={row} />
                  </td>
                  <td>{row.record.gp}</td>
                  <td>{recordLine(row.record)}</td>
                  <td>{row.record.points}</td>
                  <td>{row.record.gf}</td>
                  <td>{row.record.ga}</td>
                  <td>
                    {row.record.gd > 0 ? "+" : ""}
                    {row.record.gd}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

function scrollToHash() {
  const id = window.location.hash.replace(/^#/, "");
  if (!id || id.startsWith("/")) return;
  document.getElementById(id)?.scrollIntoView({ block: "start" });
}

export function RangersView() {
  const [feed, setFeed] = useState<RangersFeed | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [reload, setReload] = useState(0);
  const anchors = useMemo(() => {
    const used = new Set<string>();
    return (feed?.upcoming ?? []).map((card) => gameAnchor(card, used));
  }, [feed]);

  useEffect(() => {
    document.title = "Jr. Rangers forecast";
    document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#0b1c3f");
    let icon = document.querySelector<HTMLLinkElement>('link[rel="icon"]');
    const createdIcon = !icon;
    const prevIconHref = icon?.getAttribute("href");
    const prevIconType = icon?.getAttribute("type");
    if (!icon) {
      icon = document.createElement("link");
      icon.rel = "icon";
      document.head.appendChild(icon);
    }
    icon.href = "/rangers-logo.png";
    icon.type = "image/png";
    let apple = document.querySelector<HTMLLinkElement>('link[rel="apple-touch-icon"]');
    const createdApple = !apple;
    if (!apple) {
      apple = document.createElement("link");
      apple.rel = "apple-touch-icon";
      document.head.appendChild(apple);
    }
    apple.href = "/rangers-logo.png";
    return () => {
      document.title = "OpenIceFinder";
      document.querySelector('meta[name="theme-color"]')?.setAttribute("content", "#13251f");
      if (createdIcon) icon?.remove();
      else if (icon) {
        icon.href = prevIconHref || "/favicon.svg";
        if (prevIconType) icon.type = prevIconType;
        else icon.removeAttribute("type");
      }
      if (createdApple) apple?.remove();
    };
  }, []);

  useEffect(() => {
    let cancelled = false;
    setError(null);
    loadRangers()
      .then((data) => {
        if (!cancelled) setFeed(data);
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, [reload]);

  useEffect(() => {
    if (!feed) return;
    scrollToHash();
    window.addEventListener("hashchange", scrollToHash);
    return () => window.removeEventListener("hashchange", scrollToHash);
  }, [feed, anchors]);

  const us = feed?.team;
  const last = feed?.recent.at(-1);

  return (
    <div className="tape-shell">
      <div className="tape-stripe" aria-hidden="true" />
      <header className="tape-top">
        <a className="tape-brand" href="/">
          OpenIceFinder
        </a>
        <h1>2016 Jr. Rangers</h1>
      </header>

      {error && (
        <div className="notice error" role="alert">
          <strong>Couldn&rsquo;t load the tape.</strong> {error}{" "}
          <button type="button" className="link-button" onClick={() => setReload((n) => n + 1)}>
            Retry
          </button>
        </div>
      )}

      {!error && !feed && <p className="loading">Pulling Elite 9 standings…</p>}

      {feed && us && (
        <>
          {last && (
            <p className="tape-last">
              Last: {last.result} {last.ourScore}–{last.theirScore} {last.isHome ? "vs" : "@"} {last.opponentName} ({formatDay(dateFromKey(last.date))})
            </p>
          )}
          {feed.recent.length === 0 && <p className="tape-last">No completed games yet.</p>}

          {feed.standings.length > 0 && <Standings rows={feed.standings} />}

          <section className="tape-upcoming" aria-label="Next five opponents">
            <h2>Next five</h2>
            {feed.upcoming.length === 0 ? (
              <p className="empty">No upcoming Elite 9 games on the board.</p>
            ) : (
              feed.upcoming.map((card, i) => <ScoutSheet key={`${card.game.date}-${card.opponent.teamId}`} card={card} index={i} id={anchors[i] ?? opponentSlug(card.opponent.name)} />)
            )}
          </section>

          <p className="tape-fineprint">
            Grades are a scouting note from a tiny sample — one weekend is not a body of work. A one-goal loss on their tape is the thing to hunt; a 7–0 they already hung on us is the thing to respect.{" "}
            {feed.fetchedAt && <>Standings pulled {formatRelativeFetched(feed.fetchedAt)}. </>}
            <a href={feed.sourceUrl} target="_blank" rel="noreferrer">
              Elite 9 standings <ExternalLink size={12} />
            </a>
            {" · "}
            <a href={feed.scheduleUrl} target="_blank" rel="noreferrer">
              schedule <ExternalLink size={12} />
            </a>
          </p>
          {feed.errors.length > 0 && (
            <p className="notice warn" role="status">
              {feed.errors.join(" ")}
            </p>
          )}
        </>
      )}
    </div>
  );
}
