import { CATEGORY_LABELS, ICE_CATEGORIES, OPEN_ICE_CATEGORIES, isOpenIce, type IceCategory, type IceEvent, type Rink, type RinkFeed, type RinkIndex } from "@openice/shared";
import { Car, ExternalLink, MapPin } from "lucide-react";
import { useMemo, useState } from "react";
import { CategoryBadge } from "../components/CategoryBadge";
import { dateKeyOf, dayLabel, formatTimeRange, groupByDay, shiftDateKey } from "../format";

const STORAGE_KEY = "openice.filters.v1";
const DAY_OPTIONS = [3, 7, 14, 35] as const;
const DRIVE_OPTIONS = [10, 15, 20, 60] as const;
const EXTRA_CATEGORIES: IceCategory[] = ICE_CATEGORIES.filter((c) => !isOpenIce(c) && c !== "private_rental" && c !== "closed" && c !== "other");

interface Filters {
  categories: IceCategory[];
  days: number;
  maxDrive: number;
  rinkIds: string[] | null;
}

function loadFilters(): Filters {
  try {
    const raw = window.localStorage?.getItem(STORAGE_KEY);
    if (raw) {
      const parsed = JSON.parse(raw) as Partial<Filters>;
      return {
        categories: Array.isArray(parsed.categories) ? parsed.categories : [...OPEN_ICE_CATEGORIES],
        days: typeof parsed.days === "number" ? parsed.days : 7,
        maxDrive: typeof parsed.maxDrive === "number" ? parsed.maxDrive : 60,
        rinkIds: Array.isArray(parsed.rinkIds) ? parsed.rinkIds : null,
      };
    }
  } catch {
    /* ignore */
  }
  return { categories: [...OPEN_ICE_CATEGORIES], days: 7, maxDrive: 60, rinkIds: null };
}

export interface OpenIceRow extends IceEvent {
  rink: Rink;
}

export function selectOpenIce(feeds: RinkFeed[], filters: Filters, now: Date): OpenIceRow[] {
  const nowMs = now.getTime();
  const todayKey = dateKeyOf(now);
  const endKey = shiftDateKey(todayKey, filters.days);
  const categories = new Set(filters.categories);
  const rows: OpenIceRow[] = [];
  for (const feed of feeds) {
    if (feed.rink.driveMinutes > filters.maxDrive) continue;
    if (filters.rinkIds && !filters.rinkIds.includes(feed.rink.id)) continue;
    for (const event of feed.events) {
      if (!categories.has(event.category)) continue;
      if (new Date(event.end).getTime() < nowMs) continue;
      if (dateKeyOf(event.start) >= endKey) continue;
      rows.push({ ...event, rink: feed.rink });
    }
  }
  return rows.sort((a, b) => a.start.localeCompare(b.start) || a.rink.driveMinutes - b.rink.driveMinutes);
}

export function OpenIceView({ index, feeds }: { index: RinkIndex; feeds: RinkFeed[] | null }) {
  const [filters, setFiltersState] = useState<Filters>(loadFilters);
  const setFilters = (next: Filters) => {
    setFiltersState(next);
    try {
      window.localStorage?.setItem(STORAGE_KEY, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  };
  const toggleCategory = (category: IceCategory) => {
    const has = filters.categories.includes(category);
    setFilters({ ...filters, categories: has ? filters.categories.filter((c) => c !== category) : [...filters.categories, category] });
  };
  const [showRinkPicker, setShowRinkPicker] = useState(false);

  const now = useMemo(() => new Date(), [feeds]);
  const rows = useMemo(() => (feeds ? selectOpenIce(feeds, filters, now) : []), [feeds, filters, now]);
  const groups = useMemo(() => groupByDay(rows), [rows]);
  const todayKey = dateKeyOf(now);
  const tomorrowKey = shiftDateKey(todayKey, 1);
  const nowMs = now.getTime();

  const rinksWithoutData = index.rinks.filter((r) => r.eventCount === 0);
  const allRinkIds = index.rinks.map((r) => r.rink.id);
  const selectedRinkCount = filters.rinkIds ? filters.rinkIds.length : allRinkIds.length;

  return (
    <section className="view">
      <div className="filters" aria-label="Filters">
        <div className="filter-group">
          <span className="filter-label">Show</span>
          <div className="chips">
            {OPEN_ICE_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={`chip cat-${category}${filters.categories.includes(category) ? " on" : ""}`}
                aria-pressed={filters.categories.includes(category)}
                onClick={() => toggleCategory(category)}
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
            <span className="chip-divider" aria-hidden="true" />
            {EXTRA_CATEGORIES.map((category) => (
              <button
                key={category}
                type="button"
                className={`chip muted cat-${category}${filters.categories.includes(category) ? " on" : ""}`}
                aria-pressed={filters.categories.includes(category)}
                onClick={() => toggleCategory(category)}
              >
                {CATEGORY_LABELS[category]}
              </button>
            ))}
          </div>
        </div>
        <div className="filter-row">
          <div className="filter-group">
            <span className="filter-label">Next</span>
            <div className="chips">
              {DAY_OPTIONS.map((days) => (
                <button key={days} type="button" className={`chip${filters.days === days ? " on" : ""}`} aria-pressed={filters.days === days} onClick={() => setFilters({ ...filters, days })}>
                  {days} days
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">
              <Car size={14} /> Drive
            </span>
            <div className="chips">
              {DRIVE_OPTIONS.map((minutes) => (
                <button
                  key={minutes}
                  type="button"
                  className={`chip${filters.maxDrive === minutes ? " on" : ""}`}
                  aria-pressed={filters.maxDrive === minutes}
                  onClick={() => setFilters({ ...filters, maxDrive: minutes })}
                >
                  {minutes >= 60 ? "Any" : `≤ ${minutes} min`}
                </button>
              ))}
            </div>
          </div>
          <div className="filter-group">
            <span className="filter-label">
              <MapPin size={14} /> Rinks
            </span>
            <button type="button" className={`chip${filters.rinkIds ? " on" : ""}`} aria-expanded={showRinkPicker} onClick={() => setShowRinkPicker((s) => !s)}>
              {selectedRinkCount} of {allRinkIds.length}
            </button>
          </div>
        </div>
        {showRinkPicker && (
          <div className="rink-picker">
            <div className="rink-picker-actions">
              <button type="button" className="link-button" onClick={() => setFilters({ ...filters, rinkIds: null })}>
                All rinks
              </button>
              <button type="button" className="link-button" onClick={() => setFilters({ ...filters, rinkIds: [] })}>
                None
              </button>
            </div>
            <ul className="rink-picker-list">
              {index.rinks.map((entry) => {
                const checked = !filters.rinkIds || filters.rinkIds.includes(entry.rink.id);
                return (
                  <li key={entry.rink.id}>
                    <label>
                      <input
                        type="checkbox"
                        checked={checked}
                        onChange={() => {
                          const current = filters.rinkIds ?? allRinkIds;
                          const next = checked ? current.filter((id) => id !== entry.rink.id) : [...current, entry.rink.id];
                          setFilters({ ...filters, rinkIds: next.length === allRinkIds.length ? null : next });
                        }}
                      />
                      <span>
                        <span className="rink-emoji" aria-hidden="true">{entry.rink.emoji}</span>
                        {entry.rink.name}
                      </span>
                      <span className="dim">
                        {entry.rink.town} · {entry.rink.driveMinutes} min
                      </span>
                    </label>
                  </li>
                );
              })}
            </ul>
          </div>
        )}
      </div>

      {!feeds && <p className="loading">Loading schedules…</p>}

      {feeds && groups.length === 0 && (
        <div className="empty">
          <p>No sessions match these filters in the next {filters.days} days.</p>
          <p className="dim">Try more days, a longer drive, or more session types.</p>
        </div>
      )}

      {groups.map((group) => (
        <section key={group.dateKey} className="day-group">
          <h2 className="day-heading">{dayLabel(group.dateKey, todayKey, tomorrowKey)}</h2>
          <ol className="session-list">
            {group.events.map((row) => {
              const live = new Date(row.start).getTime() <= nowMs && new Date(row.end).getTime() > nowMs;
              return (
                <li key={row.id} className={`session${live ? " live" : ""}`} style={row.rink.color ? { background: row.rink.color } : undefined}>
                  <div className="session-time">
                    <span>{formatTimeRange(row.start, row.end)}</span>
                    {live && <span className="live-pill">Now</span>}
                  </div>
                  <div className="session-main">
                    <div className="session-title-row">
                      <CategoryBadge category={row.category} />
                      <span className="session-title">{row.title}</span>
                    </div>
                    <div className="session-meta">
                      <a href={`#/rink/${row.rink.id}`} className="rink-link">
                        <span className="rink-emoji" aria-hidden="true">{row.rink.emoji}</span>
                        {row.rink.name}
                      </a>
                      <span className="dim">{row.rink.town}</span>
                      {row.surface && <span className="dim">· {row.surface}</span>}
                    </div>
                  </div>
                  <div className="session-side">
                    <span className="drive-pill" title={`${row.rink.driveMiles} mi from Arlington Center`}>
                      <Car size={13} /> {row.rink.driveMinutes} min
                    </span>
                    {(row.url || row.rink.scheduleUrl) && (
                      <a className="ext" href={row.url ?? row.rink.scheduleUrl} target="_blank" rel="noreferrer" aria-label="Open rink schedule">
                        <ExternalLink size={14} />
                      </a>
                    )}
                  </div>
                </li>
              );
            })}
          </ol>
        </section>
      ))}

      {rinksWithoutData.length > 0 && (
        <details className="coverage">
          <summary>
            {rinksWithoutData.length} rink{rinksWithoutData.length === 1 ? "" : "s"} with no schedule data right now
          </summary>
          <ul>
            {rinksWithoutData.map((entry) => (
              <li key={entry.rink.id}>
                <a href={`#/rink/${entry.rink.id}`}>
                  <span className="rink-emoji" aria-hidden="true">{entry.rink.emoji}</span>
                  {entry.rink.name}
                </a>{" "}
                <span className="dim">({entry.rink.town})</span>
                {entry.errors[0] && <span className="dim"> — {entry.errors[0]}</span>}
                {entry.rink.scheduleUrl && (
                  <>
                    {" "}
                    <a href={entry.rink.scheduleUrl} target="_blank" rel="noreferrer">
                      rink site
                    </a>
                  </>
                )}
              </li>
            ))}
          </ul>
        </details>
      )}
    </section>
  );
}
