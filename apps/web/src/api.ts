import type { OfferingsCatalogId, OfferingsFeed, ProgramFeed, RinkFeed, RinkIndex } from "@openice/shared";

const DATA_BASE = "/data";

async function getJson<T>(path: string): Promise<T> {
  const res = await fetch(`${DATA_BASE}${path}`, { headers: { Accept: "application/json" }, cache: "no-cache" });
  if (!res.ok) throw new Error(`Could not load ${path} (${res.status})`);
  return (await res.json()) as T;
}

export function loadIndex(): Promise<RinkIndex> {
  return getJson<RinkIndex>("/index.json");
}

export function loadFeed(rinkId: string): Promise<RinkFeed> {
  return getJson<RinkFeed>(`/rinks/${encodeURIComponent(rinkId)}.json`);
}

export function loadProgramFeed(programId: string): Promise<ProgramFeed> {
  return getJson<ProgramFeed>(`/programs/${encodeURIComponent(programId)}.json`);
}

/** Load every program (team schedule) feed listed in the index; failures become empty feeds with an error. */
export async function loadAllProgramFeeds(index: RinkIndex): Promise<ProgramFeed[]> {
  return Promise.all(
    (index.programs ?? []).map(async (entry) => {
      try {
        return await loadProgramFeed(entry.program.id);
      } catch (error) {
        return {
          program: entry.program,
          fetchedAt: entry.fetchedAt,
          rangeStart: "",
          rangeEnd: "",
          teams: [],
          events: [],
          errors: [error instanceof Error ? error.message : String(error)],
        } satisfies ProgramFeed;
      }
    }),
  );
}

export async function loadOfferings(id: OfferingsCatalogId): Promise<OfferingsFeed | null> {
  try {
    const data = await getJson<OfferingsFeed>(`/offerings/${id}.json`);
    if (!data || !Array.isArray(data.offerings)) return null;
    return data;
  } catch {
    return null;
  }
}

/** Load every rink feed listed in the index; failures become empty feeds with an error. */
export async function loadAllFeeds(index: RinkIndex): Promise<RinkFeed[]> {
  return Promise.all(
    index.rinks.map(async (entry) => {
      try {
        return await loadFeed(entry.rink.id);
      } catch (error) {
        return {
          rink: entry.rink,
          fetchedAt: entry.fetchedAt,
          rangeStart: "",
          rangeEnd: "",
          events: [],
          errors: [error instanceof Error ? error.message : String(error)],
        } satisfies RinkFeed;
      }
    }),
  );
}
