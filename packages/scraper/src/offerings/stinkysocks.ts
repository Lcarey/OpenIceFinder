import { formatIsoWithOffset, parseClock, parseDateOnly, type BookableOffering, type OfferingAudience, type OfferingKind, type OfferingStatus } from "@openice/shared";
import { localToIso } from "@openice/shared";
import { fetchText } from "../http.js";
import { offeringId } from "./ids.js";

export const STINKYSOCKS_LISTING = "https://secure.stinkysocks.net/NCH/";
const MAX_PAGES = 12;

const LOCATION_TO_RINK: Array<{ match: RegExp; rinkId: string }> = [
  { match: /medford|loconte|flynn/i, rinkId: "flynn-medford" },
  { match: /somerville|veterans/i, rinkId: "veterans-somerville" },
  { match: /cambridge|simoni/i, rinkId: "simoni-cambridge" },
  { match: /revere|cronin/i, rinkId: "cronin-revere" },
  { match: /belmont/i, rinkId: "belmont-sports-complex" },
  { match: /burlington/i, rinkId: "ice-palace-burlington" },
  { match: /warrior|brighton/i, rinkId: "warrior-brighton" },
];

export function mapStinkysocksRink(location: string): string | undefined {
  return LOCATION_TO_RINK.find((row) => row.match.test(location))?.rinkId;
}

function decodeEntities(text: string): string {
  return text
    .replace(/&amp;/g, "&")
    .replace(/&nbsp;/g, " ")
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&#39;|&apos;/g, "'")
    .replace(/&quot;/g, '"')
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)));
}

function stripTags(html: string): string {
  return decodeEntities(html.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim());
}

function kindOf(title: string, type: string | undefined): OfferingKind {
  const blob = `${title} ${type ?? ""}`.toLowerCase();
  if (/\bskills?\b/.test(blob)) return "skills";
  if (/learn to play|ltp/.test(blob)) return "learn_to_play";
  if (/clinic/.test(blob)) return "clinic";
  return "adult_pickup";
}

function audienceOf(title: string): OfferingAudience {
  const t = title.toLowerCase();
  if (/\bmixed\b/.test(t) || /\bboth\b/.test(t)) return "both";
  if (/\byouth\b|\bkids?\b/.test(t)) return "youth";
  return "adult";
}

function actionText(html: string): string {
  const action = html.match(/<div class="product-action">([\s\S]*?)<\/div>/i)?.[1] ?? "";
  return stripTags(action);
}

function statusOf(action: string): OfferingStatus {
  if (/canceled/i.test(action)) return "canceled";
  if (/waitlist/i.test(action)) return "waitlist";
  if (/sold\s*out/i.test(action)) return "sold_out";
  return "open";
}

function hrefMatching(html: string, pattern: RegExp): string | undefined {
  for (const tag of html.match(/href="([^"]+)"/gi) ?? []) {
    const href = tag.match(/href="([^"]+)"/i)?.[1];
    if (href && pattern.test(href)) return decodeEntities(href);
  }
  return undefined;
}

function parseStart(text: string): string | null {
  const m = text.match(/(\d{1,2}\/\d{1,2}\/\d{2,4})\s+at\s+(\d{1,2}:\d{2})/i);
  if (!m) return null;
  const date = parseDateOnly(m[1]!);
  const clock = parseClock(m[2]!);
  if (!date || !clock) return null;
  return localToIso({ ...date, ...clock });
}

export function parseStinkysocksPage(html: string): BookableOffering[] {
  const chunks = html.split(/class="[^"]*product[^"]*product-accordion[^"]*"/i).slice(1);
  const out: BookableOffering[] = [];
  for (const chunk of chunks) {
    const blockEnd = chunk.search(/class="[^"]*product[^"]*product-accordion/i);
    const block = blockEnd >= 0 ? chunk.slice(0, blockEnd) : chunk;
    const title = stripTags(block.match(/<h4[^>]*>([\s\S]*?)<\/h4>/i)?.[1] ?? "");
    const text = stripTags(block);
    const start = parseStart(text);
    if (!title || !start) continue;
    const durationMatch = text.match(/duration[:\s]+(\d+)\s*(min|minute)/i);
    const minutes = durationMatch ? Number(durationMatch[1]) : 50;
    const end = formatIsoWithOffset(new Date(start).getTime() + minutes * 60_000);
    const location = text.match(/location[:\s]+([^]+?)(?=date\s*&|price|level|type|available|sold|canceled|duration|$)/i)?.[1]?.trim()
      ?? text.match(/location[:\s]+(.{8,80}?)(?:\s{2,}|$)/i)?.[1]?.trim()
      ?? title.split(" - ")[1]?.trim()
      ?? "StinkySocks";
    const locationClean = location.replace(/\s+/g, " ").trim();
    const type = text.match(/\btype[:\s]+([A-Za-z ]+?)(?:\s{2,}|price|level|location|date|$)/i)?.[1]?.trim();
    const price = text.match(/\$\s*(\d+(?:\.\d{2})?)/)?.[0];
    const level = title.match(/levels?\s*[\d\-\s]+/i)?.[0]?.trim()
      ?? text.match(/level[:\s]+([^]+?)(?=price|type|location|date|available|sold|$)/i)?.[1]?.trim();
    const action = actionText(block);
    const status = statusOf(action);
    const registerUrl =
      hrefMatching(block.match(/<div class="product-action">[\s\S]*?<\/div>/i)?.[0] ?? block, /UCEditor|ADD=NCH|waitlist/i)
      ?? STINKYSOCKS_LISTING;
    const kind = kindOf(title, type);
    out.push({
      id: offeringId({ provider: "stinkysocks", title, start, registerUrl }),
      provider: "stinkysocks",
      kind,
      title,
      start,
      end,
      rinkId: mapStinkysocksRink(locationClean),
      location: locationClean,
      registerUrl,
      price,
      level,
      status,
      audience: audienceOf(title),
    });
  }
  return out;
}

export function listingUrl(page: number): string {
  if (page <= 1) return STINKYSOCKS_LISTING;
  return `https://secure.stinkysocks.net/NCH/index-${page}.html?location=&level=&hotlist=&skillsonly=`;
}

export async function fetchStinkysocksOfferings(options: {
  rangeStart: Date;
  rangeEnd: Date;
  log?: (message: string) => void;
  fetchPage?: (url: string) => Promise<string>;
}): Promise<{ offerings: BookableOffering[]; errors: string[] }> {
  const log = options.log ?? (() => {});
  const fetchPage = options.fetchPage ?? ((url: string) => fetchText(url));
  const offerings: BookableOffering[] = [];
  const errors: string[] = [];
  const seen = new Set<string>();
  for (let page = 1; page <= MAX_PAGES; page++) {
    const url = listingUrl(page);
    try {
      const html = await fetchPage(url);
      const parsed = parseStinkysocksPage(html);
      log(`stinkysocks page ${page}: ${parsed.length} listings`);
      if (parsed.length === 0) break;
      for (const item of parsed) {
        if (seen.has(item.id)) continue;
        seen.add(item.id);
        const startMs = new Date(item.start).getTime();
        if (startMs < options.rangeStart.getTime() || startMs >= options.rangeEnd.getTime()) continue;
        offerings.push(item);
      }
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      errors.push(`stinkysocks page ${page}: ${message}`);
      log(`stinkysocks page ${page} FAILED: ${message}`);
      break;
    }
  }
  offerings.sort((a, b) => a.start.localeCompare(b.start) || a.title.localeCompare(b.title));
  return { offerings, errors };
}
