import type { Adapter } from "./types.js";

/** Rinks with no machine-readable schedule: no events, the UI links to the rink instead. */
export const linkOnlyAdapter: Adapter<"link-only"> = async (_rink, source, ctx) => {
  ctx.log(`link-only: ${source.reason ?? "no schedule source configured"}`);
  return [];
};
