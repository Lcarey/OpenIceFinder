import { setTimeout as sleep } from "node:timers/promises";

/** A challenge or explicit rejection means stop this run, not try another page. */
export class MhrAccessBlockedError extends Error {}

export function paceMhrRequests(fetchTable: (url: string) => Promise<string>, options: {
  wait?: (ms: number) => Promise<unknown>;
  random?: () => number;
  log?: (message: string) => void;
} = {}): (url: string) => Promise<string> {
  let attempted = false;
  let blocked: string | undefined;
  return async (url) => {
    if (blocked) throw new MhrAccessBlockedError(`Skipped after MYHockey blocked this run: ${blocked}`);
    if (attempted) {
      const delay = 30_000 + Math.floor((options.random ?? Math.random)() * 60_001);
      options.log?.(`MHR: waiting ${(delay / 1000).toFixed(1)} seconds before the next age list.`);
      await (options.wait ?? sleep)(delay);
    }
    attempted = true;
    try { return await fetchTable(url); }
    catch (error) {
      if (error instanceof MhrAccessBlockedError) blocked = error.message;
      throw error;
    }
  };
}
