import type { MhrEntry, MhrSource } from "@openice/shared";
import { formatRelativeFetched } from "../format";

export function MhrBadge({ entry }: { entry?: MhrEntry }) {
  if (!entry) return <span className="mhr-badge dim" title="No verified MYHockey team match">MHR unavailable</span>;
  const label = entry.rating == null ? "Not rated yet" : `${entry.rank ? `#${entry.rank} · ` : ""}${entry.rating.toFixed(entry.birthYear === 2016 ? 1 : 2)}`;
  return <a className="mhr-badge" href={entry.url} target="_blank" rel="noreferrer" title={`${entry.name}: ${entry.rank ? `USA rank ${entry.rank}; ` : ""}${entry.rating == null ? "MHR has not published a rating" : `rating ${entry.rating}`}`} aria-label={`MYHockey ${entry.name}: ${label}`}>MHR {label}</a>;
}

export function MhrNotice({ sources }: { sources?: MhrSource[] }) {
  if (!sources?.length) return <p className="mhr-note dim">MYHockey ratings are temporarily unavailable.</p>;
  const fetched = sources.map((s) => s.fetchedAt).filter((t): t is string => Boolean(t)).sort()[0];
  // Weekly refresh, with one day of grace for scheduler delays. Explicit source
  // failures still show the saved-ratings warning immediately.
  const stale = sources.some((s) => s.error || !s.fetchedAt || Date.now() - Date.parse(s.fetchedAt) > 8 * 24 * 3600_000);
  return <p className="mhr-note dim">MYHockey {fetched ? `checked ${formatRelativeFetched(fetched)}` : "unavailable"}{stale && fetched ? " · using saved ratings" : ""}. Checks for updates on Wednesday afternoons. USA age-group rank when published, followed by rating. Teams need at least five recorded games to qualify; “Not rated yet” means MHR has not published a rating.</p>;
}
