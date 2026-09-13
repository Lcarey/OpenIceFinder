import type { RawEvent, Rink, RinkSource } from "@openice/shared";
import type OpenAI from "openai";

export interface AdapterContext {
  /** Inclusive start of the window to fetch (UTC instant). */
  rangeStart: Date;
  /** Exclusive end of the window to fetch (UTC instant). */
  rangeEnd: Date;
  /** Lazily builds an OpenAI client; throws if no key is configured. */
  openai: () => Promise<OpenAI>;
  openaiModel: string;
  log: (message: string) => void;
}

export type SourceOf<K extends RinkSource["kind"]> = Extract<RinkSource, { kind: K }>;

export type Adapter<K extends RinkSource["kind"]> = (rink: Rink, source: SourceOf<K>, ctx: AdapterContext) => Promise<RawEvent[]>;
