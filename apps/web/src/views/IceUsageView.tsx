import type { ProgramFeed, RinkFeed, RinkIndex } from "@openice/shared";
import { ChevronLeft, ChevronRight, ExternalLink, Users } from "lucide-react";
import { useMemo, useState } from "react";
import { dateFromKey, dateKeyOf, formatDay, formatRelativeFetched, formatTime, formatTimeRange, formatWeekday, minutesIntoDay, shiftDateKey, weekStartKey } from "../format";
import { mergeUsage, programSlotsWithin, type UsageBlock } from "../usage";

const GRID_START_HOUR = 5;
const GRID_END_HOUR = 24;
const HOUR_PX = 48;

export function IceUsageView({ index, feeds, programFeeds, rinkId }: { index: RinkIndex; feeds: RinkFeed[] | null; programFeeds: ProgramFeed[] | null; rinkId: string }) {
  const entry = index.rinks.find((r) => r.rink.id === rinkId);
  const programs = (index.programs ?? []).filter((p) => p.program.rinkId === rinkId);
  const feed = feeds?.find((f) => f.rink.id === rinkId) ?? null;
  const rinkPrograms = useMemo(() => (programFeeds ?? []).filter((f) => f.program.rinkId === rinkId), [programFeeds, rinkId]);
  const todayKey = dateKeyOf(new Date());
  const [selectedDay, setSelectedDay] = useState(todayKey);
  const weekStart = weekStartKey(selectedDay);

  const blocks = useMemo(() => mergeUsage(feed?.events ?? [], rinkPrograms), [feed, rinkPrograms]);
  const byDay = useMemo(() => {
    const map = new Map<string, UsageBlock[]>();
    for (const b of blocks) {
      const key = dateKeyOf(b.start);
      map.set(key, [...(map.get(key) ?? []), b]);
    }
    return map;
  }, [blocks]);

  if (!entry) return <p className="empty">Unknown rink.</p>;
  const rink = entry.rink;
  const loading = !feeds || !programFeeds;
  const dayBlocks = byDay.get(selectedDay) ?? [];

  return (
    <section className="view usage-view">
      <header className="rink-header">
        <div>
          <h2>
            <span className="rink-emoji rink-emoji-lg" aria-hidden="true">
              {rink.emoji}
            </span>
            Who&rsquo;s on the ice at {rink.name}
          </h2>
          <p className="rink-sub">
            The town calendar shows generic rental blocks; the club&rsquo;s team schedules fill in exactly which teams are skating.
          </p>
          <p className="rink-links">
            <a href={`#/rink/${rink.id}`}>Full rink calendar</a>
            {programs.map((p) => (
              <a key={p.program.id} href={p.program.website} target="_blank" rel="noreferrer">
                {p.program.name} <ExternalLink size={13} />
              </a>
            ))}
            {rink.scheduleUrl && (
              <a href={rink.scheduleUrl} target="_blank" rel="noreferrer">
                Town schedule <ExternalLink size={13} />
              </a>
            )}
            <span className="dim">
              Rink refreshed {formatRelativeFetched(entry.fetchedAt)}
              {programs[0] && <> · teams refreshed {formatRelativeFetched(programs[0].fetchedAt)}</>}
            </span>
          </p>
          {programs.some((p) => p.errors.length > 0) && (
            <p className="notice warn">
              {programs.flatMap((p) => p.errors).map((e, i) => (
                <span key={i}>{e}</span>
              ))}
            </p>
          )}
          {programs.length === 0 && <p className="notice warn">No team schedules are configured for this rink.</p>}
        </div>
      </header>

      <div className="cal-toolbar">
        <div className="cal-nav">
          <button type="button" className="icon-button" onClick={() => setSelectedDay(shiftDateKey(selectedDay, -7))} aria-label="Previous week">
            <ChevronLeft size={18} />
          </button>
          <button type="button" className="chip" onClick={() => setSelectedDay(todayKey)}>
            Today
          </button>
          <button type="button" className="icon-button" onClick={() => setSelectedDay(shiftDateKey(selectedDay, 7))} aria-label="Next week">
            <ChevronRight size={18} />
          </button>
          <span className="cal-period">Week of {formatDay(dateFromKey(weekStart))}</span>
        </div>
        <div className="chips" role="tablist" aria-label="Day">
          {Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStart, i)).map((key) => (
            <button key={key} type="button" role="tab" className={`chip${key === selectedDay ? " on" : ""}${key === todayKey ? " today" : ""}`} aria-selected={key === selectedDay} onClick={() => setSelectedDay(key)}>
              {formatWeekday(dateFromKey(key), true)} {dateFromKey(key).getDate()}
            </button>
          ))}
        </div>
      </div>

      {loading && <p className="loading">Loading schedules…</p>}

      {!loading && (
        <div className="usage-layout">
          <div className="usage-day">
            <h3 className="day-heading">
              {selectedDay === todayKey ? "Today · " : ""}
              {formatWeekday(dateFromKey(selectedDay))} {formatDay(dateFromKey(selectedDay))}
            </h3>
            {dayBlocks.length === 0 && <p className="empty">Nothing on the calendar for this day.</p>}
            <ol className="usage-list">
              {dayBlocks.map((b) => {
                const slots = programSlotsWithin(b, rinkPrograms);
                const showSlots = slots.length > 1 || (slots.length === 1 && (slots[0]!.start !== b.start || slots[0]!.end !== b.end));
                return (
                  <li key={b.id} className={`usage-row kind-${b.kind}`}>
                    <div className="usage-time">{b.allDay ? "All day" : formatTimeRange(b.start, b.end)}</div>
                    <div className="usage-main">
                      <div className="usage-title-row">
                        <span className="usage-title">{b.title}</span>
                        {b.kind === "program" && <span className="usage-tag">team ice · not on town calendar</span>}
                        {b.kind === "rink" && b.category === "private_rental" && <span className="usage-tag">rental · teams not posted</span>}
                        {b.url && (
                          <a className="ext" href={b.url} target="_blank" rel="noreferrer" aria-label="Open source schedule">
                            <ExternalLink size={13} />
                          </a>
                        )}
                      </div>
                      {b.teams.length > 0 && !showSlots && <TeamLine teams={b.teams} type={b.eventType} opponent={b.opponent} note={b.note} />}
                      {showSlots && (
                        <ul className="usage-slots">
                          {slots.map((s) => (
                            <li key={s.id}>
                              <span className="usage-slot-time">{formatTimeRange(s.start, s.end)}</span>
                              <TeamLine teams={s.teams} type={s.type} opponent={s.opponent} note={s.note} />
                            </li>
                          ))}
                        </ul>
                      )}
                    </div>
                  </li>
                );
              })}
            </ol>
          </div>

          <UsageWeekGrid byDay={byDay} weekStart={weekStart} todayKey={todayKey} selectedDay={selectedDay} onPickDay={setSelectedDay} />
        </div>
      )}
    </section>
  );
}

function TeamLine({ teams, type, opponent, note }: { teams: string[]; type?: string; opponent?: string; note?: string }) {
  return (
    <div className="usage-teams">
      <Users size={13} aria-hidden="true" />
      {teams.map((t) => (
        <span key={t} className="team-chip">
          {t}
        </span>
      ))}
      {type && type !== "practice" && <span className="dim">{type}</span>}
      {opponent && <span className="dim">{opponent}</span>}
      {note && <span className="dim usage-note">{note}</span>}
    </div>
  );
}

function UsageWeekGrid({ byDay, weekStart, todayKey, selectedDay, onPickDay }: { byDay: Map<string, UsageBlock[]>; weekStart: string; todayKey: string; selectedDay: string; onPickDay: (key: string) => void }) {
  const days = Array.from({ length: 7 }, (_, i) => shiftDateKey(weekStart, i));
  const hours = Array.from({ length: GRID_END_HOUR - GRID_START_HOUR }, (_, i) => GRID_START_HOUR + i);
  const gridHeight = (GRID_END_HOUR - GRID_START_HOUR) * HOUR_PX;

  return (
    <div className="week usage-week" role="table" aria-label="Week of ice usage">
      <div className="week-head" role="row">
        <div className="week-gutter" />
        {days.map((key) => (
          <button key={key} type="button" className={`week-day-head${key === todayKey ? " today" : ""}${key === selectedDay ? " selected" : ""}`} role="columnheader" onClick={() => onPickDay(key)}>
            <span className="week-day-name">{formatWeekday(dateFromKey(key), true)}</span>
            <span className="week-day-num">{formatDay(dateFromKey(key))}</span>
          </button>
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
          <div key={key} className={`week-col${key === todayKey ? " today" : ""}${key === selectedDay ? " selected" : ""}`} role="cell">
            {hours.map((h) => (
              <span key={h} className="hour-line" style={{ top: (h - GRID_START_HOUR) * HOUR_PX }} />
            ))}
            {(byDay.get(key) ?? [])
              .filter((b) => !b.allDay)
              .map((b) => {
                const startMin = Math.max(minutesIntoDay(b.start), GRID_START_HOUR * 60);
                const endMinRaw = minutesIntoDay(b.end);
                const endMin = Math.min(endMinRaw <= startMin ? GRID_END_HOUR * 60 : endMinRaw, GRID_END_HOUR * 60);
                const top = ((startMin - GRID_START_HOUR * 60) / 60) * HOUR_PX;
                const height = Math.max(18, ((endMin - startMin) / 60) * HOUR_PX - 2);
                const label = b.teams.length > 0 ? b.teams.join(" + ") : b.title;
                return (
                  <div
                    key={b.id}
                    className={`week-event usage-block kind-${b.kind}${b.category ? ` cat-${b.category}` : ""}`}
                    style={{ top, height }}
                    title={`${formatTimeRange(b.start, b.end)}\n${b.title}${b.teams.length ? `\n${b.teams.join(", ")}` : ""}`}
                  >
                    <span className="week-event-time">
                      {formatTime(b.start)} {b.kind !== "rink" && <strong>{b.programShortName}</strong>}
                    </span>
                    <span className="week-event-title">{label}</span>
                  </div>
                );
              })}
          </div>
        ))}
      </div>
    </div>
  );
}
