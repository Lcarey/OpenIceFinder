import { isOpenIce, type IceEvent, type RinkFeed, type RinkIndex } from "@openice/shared";
import { Car, ChevronLeft, ChevronRight, ExternalLink, MapPin, Users } from "lucide-react";
import { useMemo, useState } from "react";
import {
  dateFromKey,
  dateKeyOf,
  formatDay,
  formatMonth,
  formatRelativeFetched,
  formatTime,
  formatTimeRange,
  formatWeekday,
  minutesIntoDay,
  monthStartKey,
  shiftDateKey,
  shiftMonth,
  weekStartKey,
} from "../format";

type Mode = "week" | "month";

const GRID_START_HOUR = 5;
const GRID_END_HOUR = 24;
const HOUR_PX = 44;

export function RinkView({ index, feeds, rinkId }: { index: RinkIndex; feeds: RinkFeed[] | null; rinkId: string }) {
  const entry = index.rinks.find((r) => r.rink.id === rinkId) ?? index.rinks[0];
  const feed = feeds?.find((f) => f.rink.id === entry?.rink.id) ?? null;
  const todayKey = dateKeyOf(new Date());
  const [mode, setMode] = useState<Mode>("week");
  const [anchor, setAnchor] = useState(todayKey);
  const [openOnly, setOpenOnly] = useState(false);

  const events = useMemo(() => (feed ? feed.events.filter((e) => !openOnly || isOpenIce(e.category)) : []), [feed, openOnly]);

  if (!entry) return <p className="empty">No rinks configured.</p>;
  const rink = entry.rink;

  const shift = (direction: -1 | 1) => setAnchor(mode === "week" ? shiftDateKey(anchor, 7 * direction) : shiftMonth(anchor, direction));
  const periodLabel = mode === "week" ? `Week of ${formatDay(dateFromKey(weekStartKey(anchor)))}` : formatMonth(dateFromKey(monthStartKey(anchor)));

  return (
    <section className="view rink-view">
      <div className="rink-layout">
        <aside className="rink-list" aria-label="Rinks">
          {index.rinks.map((r) => (
            <a
              key={r.rink.id}
              href={`#/rink/${r.rink.id}`}
              className={`rink-item${r.rink.id === rink.id ? " active" : ""}${r.eventCount === 0 ? " nodata" : ""}`}
              style={r.rink.id !== rink.id && r.rink.color ? { background: r.rink.color } : undefined}
            >
              <span className="rink-item-name">
                <span className="rink-emoji" aria-hidden="true">{r.rink.emoji}</span>
                {r.rink.name}
              </span>
              <span className="rink-item-meta">
                {r.rink.town} · {r.rink.driveMinutes} min
                {r.openIceCount > 0 && <span className="open-count">{r.openIceCount} open</span>}
              </span>
            </a>
          ))}
        </aside>

        <div className="rink-main">
          <header className="rink-header">
            <div>
              <h2>
                <span className="rink-emoji rink-emoji-lg" aria-hidden="true">{rink.emoji}</span>
                {rink.name}
              </h2>
              <p className="rink-sub">
                <MapPin size={14} /> {rink.address}
                <span className="dot">·</span>
                <Car size={14} /> {rink.driveMinutes} min ({rink.driveMiles} mi) from Arlington Center
                {rink.operator && (
                  <>
                    <span className="dot">·</span>
                    {rink.operator}
                  </>
                )}
              </p>
              <p className="rink-links">
                {rink.scheduleUrl && (
                  <a href={rink.scheduleUrl} target="_blank" rel="noreferrer">
                    Official schedule <ExternalLink size={13} />
                  </a>
                )}
                {rink.website && rink.website !== rink.scheduleUrl && (
                  <a href={rink.website} target="_blank" rel="noreferrer">
                    Website <ExternalLink size={13} />
                  </a>
                )}
                {(index.programs ?? []).some((p) => p.program.rinkId === rink.id) && (
                  <a href={`#/ice/${rink.id}`}>
                    <Users size={13} /> Who&rsquo;s on the ice
                  </a>
                )}
                <span className="dim">Refreshed {formatRelativeFetched(entry.fetchedAt)}</span>
              </p>
              {entry.errors.length > 0 && (
                <p className="notice warn">
                  {entry.errors.map((e, i) => (
                    <span key={i}>{e}</span>
                  ))}
                </p>
              )}
              {rink.notes && <p className="dim">{rink.notes}</p>}
            </div>
          </header>

          <div className="cal-toolbar">
            <div className="cal-nav">
              <button type="button" className="icon-button" onClick={() => shift(-1)} aria-label={`Previous ${mode}`}>
                <ChevronLeft size={18} />
              </button>
              <button type="button" className="chip" onClick={() => setAnchor(todayKey)}>
                Today
              </button>
              <button type="button" className="icon-button" onClick={() => shift(1)} aria-label={`Next ${mode}`}>
                <ChevronRight size={18} />
              </button>
              <span className="cal-period">{periodLabel}</span>
            </div>
            <div className="chips">
              <button type="button" className={`chip${openOnly ? " on" : ""}`} aria-pressed={openOnly} onClick={() => setOpenOnly((v) => !v)}>
                Open ice only
              </button>
              <span className="chip-divider" aria-hidden="true" />
              <button type="button" className={`chip${mode === "week" ? " on" : ""}`} aria-pressed={mode === "week"} onClick={() => setMode("week")}>
                Week
              </button>
              <button type="button" className={`chip${mode === "month" ? " on" : ""}`} aria-pressed={mode === "month"} onClick={() => setMode("month")}>
                Month
              </button>
            </div>
          </div>

          {!feed && <p className="loading">Loading schedule…</p>}
          {feed && events.length === 0 && (
            <div className="empty">
              <p>No {openOnly ? "open ice " : ""}sessions in the cached schedule for this rink.</p>
              {rink.scheduleUrl && (
                <p>
                  <a href={rink.scheduleUrl} target="_blank" rel="noreferrer">
                    Check the rink&rsquo;s own schedule <ExternalLink size={13} />
                  </a>
                </p>
              )}
            </div>
          )}
          {feed && events.length > 0 && mode === "week" && <WeekGrid events={events} weekStart={weekStartKey(anchor)} todayKey={todayKey} />}
          {feed && events.length > 0 && mode === "month" && <MonthGrid events={events} monthStart={monthStartKey(anchor)} todayKey={todayKey} onPickDay={(key) => { setAnchor(key); setMode("week"); }} />}
        </div>
      </div>
    </section>
  );
}

function eventsByDay(events: IceEvent[]): Map<string, IceEvent[]> {
  const map = new Map<string, IceEvent[]>();
  for (const e of events) {
    const key = dateKeyOf(e.start);
    const list = map.get(key) ?? [];
    list.push(e);
    map.set(key, list);
  }
  return map;
}

export function WeekGrid({ events, weekStart, todayKey }: { events: IceEvent[]; weekStart: string; todayKey: string }) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStart, i));
  const byDay = eventsByDay(events);
  const hours = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
  const gridHeight = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_PX;
  const allDay = (key: string) => (byDay.get(key) ?? []).filter((e) => e.allDay);
  const timed = (key: string) => (byDay.get(key) ?? []).filter((e) => !e.allDay);

  return (
    <div className="week" role="table" aria-label="Week schedule">
      <div className="week-head" role="row">
        <div className="week-gutter" />
        {days.map((key) => (
          <div key={key} className={`week-day-head${key === todayKey ? " today" : ""}`} role="columnheader">
            <span className="week-day-name">{formatWeekday(dateFromKey(key), true)}</span>
            <span className="week-day-num">{formatDay(dateFromKey(key))}</span>
            {allDay(key).map((e) => (
              <span key={e.id} className={`allday cat-${e.category}`} title={e.title}>
                {e.title}
              </span>
            ))}
          </div>
        ))}
      </div>
      <div className="week-body" style={{ height: gridHeight }}>
        <div className="week-gutter">
          {hours.map((h) => (
            <span key={h} className="hour-label" style={{ top: (h - GRID_START_HOUR) * HOUR_PX }}>
              {formatTime(new Date(Date.UTC(2026, 0, 1, h + 5)))}
            </span>
          ))}
        </div>
        {days.map((key) => (
          <div key={key} className={`week-col${key === todayKey ? " today" : ""}`} role="cell">
            {hours.map((h) => (
              <span key={h} className="hour-line" style={{ top: (h - GRID_START_HOUR) * HOUR_PX }} />
            ))}
            {timed(key).map((e) => {
              const startMin = Math.max(minutesIntoDay(e.start), GRID_START_HOUR * 60);
              const endMinRaw = minutesIntoDay(e.end);
              const endMin = Math.min(endMinRaw <= startMin ? GRID_END_HOUR * 60 : endMinRaw, GRID_END_HOUR * 60);
              const top = ((startMin - GRID_START_HOUR * 60) / 60) * HOUR_PX;
              const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_PX - 2);
              return (
                <div
                  key={e.id}
                  className={`week-event cat-${e.category}${isOpenIce(e.category) ? " open" : ""}`}
                  style={{ top, height }}
                  title={`${e.title}\n${formatTimeRange(e.start, e.end)}${e.surface ? `\n${e.surface}` : ""}`}
                >
                  <span className="week-event-time">{formatTime(e.start)}</span>
                  <span className="week-event-title">{e.title}</span>
                </div>
              );
            })}
          </div>
        ))}
      </div>
    </div>
  );
}

export function MonthGrid({ events, monthStart, todayKey, onPickDay }: { events: IceEvent[]; monthStart: string; todayKey: string; onPickDay: (key: string) => void }) {
  const gridStart = weekStartKey(monthStart);
  const monthPrefix = monthStart.slice(0, 7);
  const byDay = eventsByDay(events);
  const cells = Array.from({ length: 42 }, (_, i) => shiftDateKey(gridStart, i)).filter((key, i) => i < 35 || key.slice(0, 7) === monthPrefix);

  return (
    <div className="month" role="table" aria-label="Month schedule">
      {["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"].map((d) => (
        <div key={d} className="month-head" role="columnheader">
          {d}
        </div>
      ))}
      {cells.map((key) => {
        const list = byDay.get(key) ?? [];
        const open = list.filter((e) => isOpenIce(e.category));
        const other = list.filter((e) => !isOpenIce(e.category));
        return (
          <button
            type="button"
            key={key}
            className={`month-cell${key.slice(0, 7) !== monthPrefix ? " outside" : ""}${key === todayKey ? " today" : ""}`}
            onClick={() => onPickDay(key)}
            aria-label={`${formatDay(dateFromKey(key))}: ${list.length} sessions`}
          >
            <span className="month-daynum">{Number(key.slice(8))}</span>
            <span className="month-events">
              {open.slice(0, 3).map((e) => (
                <span key={e.id} className={`month-event cat-${e.category}`}>
                  {formatTime(e.start)} {e.title}
                </span>
              ))}
              {open.length > 3 && <span className="month-more">+{open.length - 3} more open</span>}
              {other.length > 0 && (
                <span className="month-more dim">
                  {other.length} other
                </span>
              )}
            </span>
          </button>
        );
      })}
    </div>
  );
}