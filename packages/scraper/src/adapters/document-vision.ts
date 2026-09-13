import { localToIso, parseClock, parseDateOnly, toDateKey, type RawEvent, type Rink } from "@openice/shared";
import type OpenAI from "openai";
import { decodeEntities, htmlToText, resolveUrl } from "../html.js";
import { fetchBinary } from "../http.js";
import type { Adapter, AdapterContext } from "./types.js";

/** Structured output the model must return. Strict JSON schema: every field required, nulls allowed. */
export const SCHEDULE_EXTRACTION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["summary", "confidence", "datedSessions", "weeklySessions", "closures"],
  properties: {
    summary: { type: "string", description: "One or two sentences on what the documents contain and any caveats." },
    confidence: { type: "string", enum: ["high", "medium", "low"] },
    datedSessions: {
      type: "array",
      description: "Sessions that are listed with an explicit calendar date.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "date", "startTime", "endTime", "surface", "notes"],
        properties: {
          title: { type: "string", description: "Session name as written, e.g. 'Adult Stick & Puck', 'Public Skating'." },
          date: { type: "string", description: "YYYY-MM-DD" },
          startTime: { type: "string", description: "24h HH:MM local time" },
          endTime: { type: "string", description: "24h HH:MM local time" },
          surface: { type: ["string", "null"], description: "Rink / sheet name if given." },
          notes: { type: ["string", "null"] },
        },
      },
    },
    weeklySessions: {
      type: "array",
      description: "Recurring weekly sessions given as days of week plus times.",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "daysOfWeek", "startTime", "endTime", "validFrom", "validTo", "surface", "notes"],
        properties: {
          title: { type: "string" },
          daysOfWeek: { type: "array", items: { type: "integer", minimum: 0, maximum: 6 }, description: "0 = Sunday ... 6 = Saturday" },
          startTime: { type: "string", description: "24h HH:MM local time" },
          endTime: { type: "string", description: "24h HH:MM local time" },
          validFrom: { type: ["string", "null"], description: "YYYY-MM-DD first date this rule applies, or null if unknown." },
          validTo: { type: ["string", "null"], description: "YYYY-MM-DD last date this rule applies, or null if unknown." },
          surface: { type: ["string", "null"] },
          notes: { type: ["string", "null"] },
        },
      },
    },
    closures: {
      type: "array",
      description: "Date ranges where the rink or these sessions do not run (holidays, off-season).",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["from", "to", "reason"],
        properties: {
          from: { type: "string", description: "YYYY-MM-DD inclusive" },
          to: { type: "string", description: "YYYY-MM-DD inclusive" },
          reason: { type: ["string", "null"] },
        },
      },
    },
  },
} as const;

export interface ExtractedSchedule {
  summary: string;
  confidence: "high" | "medium" | "low";
  datedSessions: Array<{ title: string; date: string; startTime: string; endTime: string; surface: string | null; notes: string | null }>;
  weeklySessions: Array<{
    title: string;
    daysOfWeek: number[];
    startTime: string;
    endTime: string;
    validFrom: string | null;
    validTo: string | null;
    surface: string | null;
    notes: string | null;
  }>;
  closures: Array<{ from: string; to: string; reason: string | null }>;
}

type InputPart =
  | { type: "input_text"; text: string }
  | { type: "input_image"; image_url: string; detail: "high" | "low" | "auto" }
  | { type: "input_file"; filename: string; file_data: string };

const MAX_ATTACHMENTS = 5;
const MAX_CANDIDATES = 10;
const MIN_IMAGE_BYTES = 15_000; // logos and icons are smaller than real schedule images
const MAX_TEXT_CHARS = 40_000;

const ASSET_URL = /(?:href|src|data-src|content)\s*=\s*["']([^"']+\.(?:pdf|png|jpe?g|webp|gif)(?:\?[^"']*)?)["']/gi;
const NEGATIVE = /(logo|icon|sprite|favicon|banner|header|footer|avatar|thumb|social|sponsor|badge|arrow|bg-|background|affiliate|usahockey|facebook|twitter|instagram-icon)/i;
const POSITIVE = /(schedule|skat|stick|hockey|public|calendar|session|hours|flyer|season|freestyle|lesson)/i;

/** Linked PDFs/images that plausibly hold a schedule, best first. Nearby markup (alt text, filenames, link text) drives the score. */
export function rankScheduleAssets(html: string, baseUrl: string): string[] {
  const scores = new Map<string, number>();
  for (const match of html.matchAll(ASSET_URL)) {
    const resolved = resolveUrl(decodeEntities(match[1]!), baseUrl);
    if (!resolved) continue;
    const context = html.slice(Math.max(0, match.index! - 400), match.index! + match[0].length + 400);
    let score = 0;
    if (POSITIVE.test(resolved)) score += 3;
    if (NEGATIVE.test(resolved)) score -= 4;
    if (POSITIVE.test(context)) score += 2;
    if (/\.pdf(\?|$)/i.test(resolved)) score += 1;
    scores.set(resolved, Math.max(scores.get(resolved) ?? -Infinity, score));
  }
  return [...scores.entries()]
    .filter(([, score]) => score >= 1)
    .sort((a, b) => b[1] - a[1])
    .map(([url]) => url);
}

function assetPriority(url: string): number {
  const lower = url.toLowerCase();
  let score = 0;
  if (/\.pdf(\?|$)/.test(lower)) score += 2;
  if (/(schedule|sched|skat|stick|puck|hockey|calendar|hours|session|public|forms\/)/.test(lower)) score += 3;
  if (/uploads?\//.test(lower)) score += 1;
  return score;
}

/** Fetch a document URL and turn it into model input parts (text for HTML, file/image otherwise). */
export async function loadDocument(url: string, ctx: Pick<AdapterContext, "log">): Promise<InputPart[]> {
  const { bytes, contentType } = await fetchBinary(url);
  const type = contentType.toLowerCase();
  if (type.includes("pdf") || url.toLowerCase().endsWith(".pdf")) {
    return [{ type: "input_file", filename: url.split("/").pop() || "schedule.pdf", file_data: `data:application/pdf;base64,${bytes.toString("base64")}` }];
  }
  if (type.startsWith("image/")) {
    return [{ type: "input_image", image_url: `data:${type.split(";")[0]};base64,${bytes.toString("base64")}`, detail: "high" }];
  }
  const html = bytes.toString("utf8");
  const text = htmlToText(html).slice(0, MAX_TEXT_CHARS);
  const parts: InputPart[] = [{ type: "input_text", text: `Page ${url}:\n\n${text}` }];
  const assets = rankScheduleAssets(html, url).slice(0, MAX_ATTACHMENTS);
  for (const asset of assets) {
    try {
      const sub = await loadDocument(asset, ctx);
      parts.push({ type: "input_text", text: `Attachment linked from the page: ${asset}` }, ...sub.filter((p) => p.type !== "input_text"));
    } catch (error) {
      ctx.log(`document-vision: skipped attachment ${asset}: ${(error as Error).message}`);
    }
  }
  return parts;
}

function buildPrompt(rink: Rink, hints: string | undefined, rangeStart: Date, rangeEnd: Date, today: Date): string {
  return [
    `You extract ice rink schedules. The rink is "${rink.name}" in ${rink.town}, MA (America/New_York).`,
    `Today is ${toDateKey(today)}. We want every session that falls between ${toDateKey(rangeStart)} and ${toDateKey(rangeEnd)}.`,
    "Read the attached page text, PDFs, and images. Return:",
    "- datedSessions for sessions listed with explicit dates (one entry per date).",
    "- weeklySessions for recurring 'every Tuesday 12:00-1:45 PM' style schedules. Use validFrom/validTo when the document gives season or schedule dates; otherwise null.",
    "- closures for holidays or off-season periods stated in the document.",
    "Include public skating, stick & puck / stick practice / stick time, public or pickup hockey, coach's ice, freestyle, and lesson sessions. Skip pool, gym, and non-ice programs.",
    "Keep titles close to the source wording (e.g. 'Adult Stick & Puck', 'Public Stick Time', 'Public Skating'). Use 24h HH:MM times.",
    "If a schedule block is clearly for a past season and nothing newer is present, still return it as weeklySessions with validTo set to the stated end date if any, and lower the confidence.",
    "If the documents contain no schedule information, return empty arrays.",
    hints ? `Rink-specific guidance: ${hints}` : "",
  ]
    .filter(Boolean)
    .join("\n");
}

function parseDateKey(text: string | null): { year: number; month: number; day: number } | null {
  return text ? parseDateOnly(text) : null;
}

function dayMillis(d: { year: number; month: number; day: number }): number {
  return Date.UTC(d.year, d.month - 1, d.day);
}

/** Turn the model's structured schedule into concrete events within the window. */
export function expandExtractedSchedule(extracted: ExtractedSchedule, rangeStart: Date, rangeEnd: Date, sourceUrl: string): RawEvent[] {
  const out: RawEvent[] = [];
  const closures = extracted.closures
    .map((c) => ({ from: parseDateKey(c.from), to: parseDateKey(c.to) }))
    .filter((c): c is { from: NonNullable<typeof c.from>; to: NonNullable<typeof c.to> } => Boolean(c.from && c.to))
    .map((c) => ({ from: dayMillis(c.from), to: dayMillis(c.to) }));
  const isClosed = (dayUtc: number) => closures.some((c) => dayUtc >= c.from && dayUtc <= c.to);

  const push = (title: string, date: { year: number; month: number; day: number }, startTime: string, endTime: string, surface: string | null, notes: string | null) => {
    const startClock = parseClock(startTime);
    const endClock = parseClock(endTime);
    if (!startClock || !endClock || !title.trim()) return;
    const start = localToIso({ ...date, ...startClock });
    const end = localToIso({ ...date, ...endClock });
    if (end <= start) return;
    const startMs = new Date(start).getTime();
    if (startMs < rangeStart.getTime() || startMs >= rangeEnd.getTime()) return;
    out.push({ title: title.trim(), start, end, surface: surface ?? undefined, url: sourceUrl, description: notes ?? undefined });
  };

  for (const s of extracted.datedSessions) {
    const date = parseDateKey(s.date);
    if (!date || isClosed(dayMillis(date))) continue;
    push(s.title, date, s.startTime, s.endTime, s.surface, s.notes);
  }

  for (const w of extracted.weeklySessions) {
    const validFrom = parseDateKey(w.validFrom);
    const validTo = parseDateKey(w.validTo);
    const fromMs = Math.max(rangeStart.getTime() - 86_400_000, validFrom ? dayMillis(validFrom) : -Infinity);
    const toMs = Math.min(rangeEnd.getTime(), validTo ? dayMillis(validTo) + 86_400_000 : Infinity);
    const days = new Set(w.daysOfWeek);
    for (let dayUtc = Date.UTC(rangeStart.getUTCFullYear(), rangeStart.getUTCMonth(), rangeStart.getUTCDate() - 1); dayUtc < toMs; dayUtc += 86_400_000) {
      if (dayUtc < fromMs) continue;
      const d = new Date(dayUtc);
      if (!days.has(d.getUTCDay()) || isClosed(dayUtc)) continue;
      push(w.title, { year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() }, w.startTime, w.endTime, w.surface, w.notes);
    }
  }
  return out;
}

export async function extractScheduleWithModel(client: OpenAI, model: string, prompt: string, parts: InputPart[]): Promise<ExtractedSchedule> {
  const response = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 16_000,
    reasoning: { effort: "medium" },
    text: { format: { type: "json_schema", name: "rink_schedule", strict: true, schema: SCHEDULE_EXTRACTION_SCHEMA as unknown as Record<string, unknown> } },
    input: [
      { role: "system", content: prompt },
      { role: "user", content: parts as never },
    ],
  });
  if (response.status === "incomplete") throw new Error(`OpenAI returned an incomplete schedule extraction (${response.incomplete_details?.reason ?? "unknown"})`);
  return JSON.parse(response.output_text) as ExtractedSchedule;
}

/** PDF / image / prose schedules read by a vision model and expanded into events. */
export const documentVisionAdapter: Adapter<"document-vision"> = async (rink, source, ctx) => {
  const parts: InputPart[] = [];
  const loadErrors: string[] = [];
  for (const url of source.documentUrls) {
    try {
      parts.push(...(await loadDocument(url, ctx)));
    } catch (error) {
      const message = (error as Error).message;
      loadErrors.push(`${new URL(url).hostname}: ${message}`);
      ctx.log(`document-vision: failed to load ${url}: ${message}`);
    }
  }
  if (parts.length === 0) {
    throw new Error(`document-vision: none of the configured documents could be loaded (${loadErrors.join("; ")})`);
  }

  const client = await ctx.openai();
  const prompt = buildPrompt(rink, source.hints, ctx.rangeStart, ctx.rangeEnd, new Date());
  const extracted = await extractScheduleWithModel(client, ctx.openaiModel, prompt, parts);
  ctx.log(
    `document-vision: confidence=${extracted.confidence} dated=${extracted.datedSessions.length} weekly=${extracted.weeklySessions.length} closures=${extracted.closures.length}; ${extracted.summary}`,
  );
  return expandExtractedSchedule(extracted, ctx.rangeStart, ctx.rangeEnd, source.documentUrls[0] ?? rink.scheduleUrl ?? "");
};
