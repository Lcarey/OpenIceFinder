import type { BookableOffering, OfferingKind, OfferingsFeed, RinkIndex } from "@openice/shared";
import { ExternalLink } from "lucide-react";
import { useMemo, useState } from "react";
import { dateKeyOf, dayLabel, formatTimeRange, groupByDay, shiftDateKey } from "../format";

const DAY_OPTIONS = [7, 14, 35] as const;

const KIND_LABELS: Record<OfferingKind, string> = {
  adult_pickup: "Pickup",
  clinic: "Clinic",
  skills: "Skills",
  learn_to_play: "Learn to play",
  fmc_class: "Class",
};

const STATUS_LABELS: Record<string, string> = {
  open: "Register",
  waitlist: "Waitlist",
  sold_out: "Sold out",
  canceled: "Canceled",
};

export function selectOfferings(offerings: BookableOffering[], days: number, now: Date, rinkId: string | null, kinds: OfferingKind[] | null): BookableOffering[] {
  const nowMs = now.getTime();
  const todayKey = dateKeyOf(now);
  const endKey = shiftDateKey(todayKey, days);
  return offerings
    .filter((o) => new Date(o.end).getTime() >= nowMs)
    .filter((o) => dateKeyOf(o.start) < endKey)
    .filter((o) => !rinkId || o.rinkId === rinkId)
    .filter((o) => !kinds || kinds.includes(o.kind))
    .sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
}

function registerLabel(status: BookableOffering["status"]): string {
  return STATUS_LABELS[status ?? "open"] ?? "Register";
}

export function OfferingsView({
  title,
  intro,
  feed,
  index,
  locationFilters,
  kindFilters,
}: {
  title: string;
  intro: string;
  feed: OfferingsFeed | null;
  index: RinkIndex;
  locationFilters?: Array<{ id: string; label: string }>;
  kindFilters?: Array<{ id: OfferingKind; label: string }>;
}) {
  const [days, setDays] = useState<(typeof DAY_OPTIONS)[number]>(14);
  const [rinkId, setRinkId] = useState<string | null>(null);
  const [kinds, setKinds] = useState<OfferingKind[] | null>(null);
  const now = useMemo(() => new Date(), [feed]);
  const rows = useMemo(() => (feed ? selectOfferings(feed.offerings, days, now, rinkId, kinds) : []), [feed, days, now, rinkId, kinds]);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const todayKey = dateKeyOf(now);
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const rinkById = new Map(index.rinks.map((r) => [r.rink.id, r.rink]));

  const toggleKind = (kind: OfferingKind) => {
    if (!kinds) {
      setKinds([kind]);
      return;
    }
    const next = kinds.includes(kind) ? kinds.filter((k) => k !== kind) : [...kinds, kind];
    setKinds(next.length === 0 || (kindFilters && next.length === kindFilters.length) ? null : next);
  };

  return (
    <section className="view">
      <header className="offerings-intro">
        <h2>{title}</h2>
        <p>{intro}</p>
      </header>

      <div className="filters" aria-label="Filters">
        <div className="filter-row">
          <div className="filter-group">
            <span className="filter-label">Next</span>
            <div className="chips">
              {DAY_OPTIONS.map((option) => (
                <button key={option} type="button" className={`chip${days === option ? " on" : ""}`} aria-pressed={days === option} onClick={() => setDays(option)}>
                  {option} days
                </button>
              ))}
            </div>
          </div>
          {locationFilters && locationFilters.length > 0 && (
            <div className="filter-group">
              <span className="filter-label">Rink</span>
              <div className="chips">
                <button type="button" className={`chip${rinkId === null ? " on" : ""}`} aria-pressed={rinkId === null} onClick={() => setRinkId(null)}>
                  All
                </button>
                {locationFilters.map((loc) => (
                  <button key={loc.id} type="button" className={`chip${rinkId === loc.id ? " on" : ""}`} aria-pressed={rinkId === loc.id} onClick={() => setRinkId(loc.id)}>
                    {loc.label}
                  </button>
                ))}
              </div>
            </div>
          )}
          {kindFilters && kindFilters.length > 0 && (
            <div className="filter-group">
              <span className="filter-label">Type</span>
              <div className="chips">
                {kindFilters.map((kind) => (
                  <button
                    key={kind.id}
                    type="button"
                    className={`chip${!kinds || kinds.includes(kind.id) ? " on" : ""}`}
                    aria-pressed={!kinds || kinds.includes(kind.id)}
                    onClick={() => toggleKind(kind.id)}
                  >
                    {kind.label}
                  </button>
                ))}
              </div>
            </div>
          )}
        </div>
      </div>

      {feed === null && <p className="loading">Loading listings…</p>}
      {feed && feed.errors.length > 0 && rows.length === 0 && (
        <div className="notice error" role="alert">
          Couldn&rsquo;t load listings. {feed.errors[0]}
        </div>
      )}
      {feed && groups.length === 0 && (
        <div className="empty">
          <p>No listings in the next {days} days.</p>
          <p className="dim">Try a longer window, or check back after the next refresh.</p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.dateKey} className="day-group">
          <h3 className="day-heading">{dayLabel(group.dateKey, todayKey, tomorrowKey)}</h3>
          <ol className="session-list">
            {group.events.map((row) => {
              const rink = row.rinkId ? rinkById.get(row.rinkId) : undefined;
              const status = row.status ?? "open";
              return (
                <li key={row.id} className={`session offering status-${status}`} style={rink?.color ? { background: rink.color } : undefined}>
                  <div className="session-time">
                    <span>{formatTimeRange(row.start, row.end)}</span>
                    <span className={`kind-pill kind-${row.kind}`}>{KIND_LABELS[row.kind]}</span>
                  </div>
                  <div className="session-main">
                    <div className="session-title-row">
                      <span className="session-title">{row.title}</span>
                    </div>
                    <div className="session-meta">
                      {rink ? (
                        <a href={`#/rink/${rink.id}`} className="rink-link">
                          <span className="rink-emoji" aria-hidden="true">{rink.emoji}</span>
                          {rink.name}
                        </a>
                      ) : (
                        <span>{row.location}</span>
                      )}
                      {rink && <span className="dim">{rink.town}</span>}
                      {row.level && <span className="dim">· {row.level}</span>}
                      {row.price && <span className="dim">· {row.price}</span>}
                    </div>
                  </div>
                  <div className="session-side">
                    <a className={`register-link status-${status}`} href={row.registerUrl} target="_blank" rel="noreferrer">
                      {registerLabel(row.status)}
                      <ExternalLink size={14} />
                    </a>
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}
    </section>
  );
}
