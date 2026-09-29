import { createHash } from "node:crypto";
import { readFile, mkdir, writeFile } from "node:fs/promises";
import path from "node:path";
import type { LocatedVenue, YouthDrive } from "./core.js";

/** Origin is private configuration, never part of the published feed or logs. */
export function readYouthOrigin(value = process.env.YOUTH_HOCKEY_ORIGIN): [number, number] {
  let parsed: unknown;
  try { parsed = JSON.parse(value ?? ""); } catch { throw new Error("Set YOUTH_HOCKEY_ORIGIN to a JSON [longitude, latitude] pair in private configuration."); }
  if (!Array.isArray(parsed) || parsed.length !== 2 || !parsed.every((v) => typeof v === "number" && Number.isFinite(v)) || Math.abs(parsed[0]) > 180 || Math.abs(parsed[1]) > 90) throw new Error("YOUTH_HOCKEY_ORIGIN must be valid longitude and latitude.");
  return parsed as [number, number];
}

export async function cachedYouthRoutes(venues: LocatedVenue[], origin: [number, number], cacheFile: string): Promise<Map<string, YouthDrive>> {
  let cache: Record<string, YouthDrive> = {};
  try { cache = JSON.parse(await readFile(cacheFile, "utf8")); } catch { /* first refresh */ }
  const key = (v: LocatedVenue) => createHash("sha256").update(JSON.stringify(["osrm-v1", origin, v.lng, v.lat])).digest("hex");
  const valid = venues.filter((v) => Number.isFinite(v.lng) && Number.isFinite(v.lat));
  const missing = valid.filter((v) => !cache[key(v)]);
  // Batch requests avoid hammering the community routing service. Successful routes persist.
  for (let i = 0; i < missing.length; i += 40) {
    const batch = missing.slice(i, i + 40);
    const points = [origin.join(","), ...batch.map((v) => `${v.lng},${v.lat}`)].join(";");
    try {
      const res = await fetch(`https://router.project-osrm.org/table/v1/driving/${points}?sources=0&annotations=duration,distance`, { signal: AbortSignal.timeout(30000), headers: { "User-Agent": "OpenIceFinder/0.1" } });
      if (!res.ok) continue;
      const data = await res.json() as { code: string; durations: (number | null)[][]; distances: (number | null)[][] };
      if (data.code !== "Ok") continue;
      batch.forEach((v, j) => {
        const seconds = data.durations[0]?.[j + 1], meters = data.distances[0]?.[j + 1];
        if (typeof seconds === "number" && seconds >= 0 && typeof meters === "number" && meters >= 0) cache[key(v)] = { seconds, meters };
      });
    } catch { /* Do not log request URLs: they contain the private origin. */ }
  }
  await mkdir(path.dirname(cacheFile), { recursive: true });
  await writeFile(cacheFile, JSON.stringify(cache));
  return new Map(valid.flatMap((v) => cache[key(v)] ? [[v.id, cache[key(v)]!] as const] : []));
}
