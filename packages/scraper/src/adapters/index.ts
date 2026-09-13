import type { RawEvent, Rink, RinkSource } from "@openice/shared";
import { civicEngageAdapter } from "./civicengage.js";
import { documentVisionAdapter } from "./document-vision.js";
import { finnlyAdapter } from "./finnly.js";
import { frontlineAdapter } from "./frontline.js";
import { halixAdapter } from "./halix.js";
import { icalAdapter } from "./ical.js";
import { linkOnlyAdapter } from "./link-only.js";
import { myrecCalendarAdapter } from "./myrec-calendar.js";
import { myrecProgramAdapter } from "./myrec-program.js";
import { recTimesAdapter } from "./rectimes.js";
import type { AdapterContext } from "./types.js";

export type { AdapterContext } from "./types.js";

export async function fetchRinkEvents(rink: Rink, ctx: AdapterContext): Promise<RawEvent[]> {
  const source: RinkSource = rink.source;
  switch (source.kind) {
    case "myrec-calendar":
      return myrecCalendarAdapter(rink, source, ctx);
    case "myrec-program":
      return myrecProgramAdapter(rink, source, ctx);
    case "frontline":
      return frontlineAdapter(rink, source, ctx);
    case "halix":
      return halixAdapter(rink, source, ctx);
    case "finnly":
      return finnlyAdapter(rink, source, ctx);
    case "ical":
      return icalAdapter(rink, source, ctx);
    case "civicengage":
      return civicEngageAdapter(rink, source, ctx);
    case "rectimes":
      return recTimesAdapter(rink, source, ctx);
    case "document-vision":
      return documentVisionAdapter(rink, source, ctx);
    case "link-only":
      return linkOnlyAdapter(rink, source, ctx);
    default: {
      const exhaustive: never = source;
      throw new Error(`Unknown source kind: ${JSON.stringify(exhaustive)}`);
    }
  }
}
