#!/usr/bin/env node
/**
 * Builds data/rinks.json: geocodes candidate rinks with Nominatim, computes
 * free-flow driving time from Arlington Center with the public OSRM server,
 * keeps the 20 closest, and preserves any hand-annotated `source` config that
 * already exists in data/rinks.json.
 *
 * Usage: npm run rinks:build [-- --limit 20] [--all]
 */
import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const outFile = path.join(repoRoot, "data", "rinks.json");

const ORIGIN = { name: "Arlington Center (Mass Ave & Pleasant St)", lat: 42.4154, lng: -71.1565 };
const USER_AGENT = "OpenIceFinder/0.1 (household app; contact: lcarey)";

interface Candidate {
  id: string;
  name: string;
  /** Single emoji used as the rink's visual marker in lists. */
  emoji: string;
  /** Very light tint (hex) used as the row background for this rink's events. */
  color: string;
  town: string;
  address: string;
  website?: string;
  scheduleUrl?: string;
  operator?: string;
  /** Optional lat/lng override when Nominatim is unreliable for the name. */
  lat?: number;
  lng?: number;
  source?: unknown;
  notes?: string;
}

const CANDIDATES: Candidate[] = [
  {
    id: "ed-burns-arlington",
    emoji: "🏒",
    color: "#fef5f5",
    name: "Ed Burns Arena",
    town: "Arlington",
    address: "422 Summer St, Arlington, MA 02474",
    website: "https://www.arlingtonma.gov/departments/recreation/ed-burns-arena",
    scheduleUrl: "https://arlingtonma.myrec.com/info/calendar/default.aspx?FacilityID=13439&AreaID=0",
    operator: "Town of Arlington Recreation",
    source: { kind: "myrec-calendar", baseUrl: "https://arlingtonma.myrec.com", facilityId: 13439, areaId: 0 },
  },
  {
    id: "belmont-sports-complex",
    emoji: "🦅",
    color: "#f7fef9",
    name: "Belmont Sports Complex (Viglirolo Rink)",
    town: "Belmont",
    address: "20 Concord Ave, Belmont, MA 02478",
    website: "https://www.belmont-ma.gov/recreation-department",
    scheduleUrl: "https://belmontma.myrec.com/info/activities/program_details.aspx?ProgramID=29877",
    operator: "Belmont Recreation",
    source: { kind: "myrec-program", baseUrl: "https://belmontma.myrec.com", programIds: [29877] },
  },
  {
    id: "flynn-medford",
    emoji: "🦊",
    color: "#faf5fe",
    name: "Flynn Rink (LoConte Memorial)",
    town: "Medford",
    address: "300 Elm St, Medford, MA 02155",
    website: "http://www.flynnrink.com/",
    scheduleUrl: "https://flynn.frontline-connect.com/monthlysched.cfm?fac=flynn&facid=1&session=8",
    operator: "Flynn Rink (DCR)",
    source: {
      kind: "frontline",
      baseUrl: "https://flynn.frontline-connect.com",
      fac: "flynn",
      facId: 1,
      sessions: { "8": "Hockey Lesson Walk-On" },
    },
  },
  {
    id: "simoni-cambridge",
    emoji: "🎓",
    color: "#fefdf7",
    name: "Simoni Memorial Skating Arena",
    town: "Cambridge",
    address: "155 Gore St, Cambridge, MA 02141",
    website: "https://fmcicesports.com/rink/cambridge-simoni-skating-arena/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.cambridge",
    operator: "FMC Ice Sports (DCR)",
    source: {
      kind: "halix",
      baseUrl: "https://fmc.myhalix.io",
      sandbox: "sbx~00~300",
      businessKey: "biz~00~-wcAAAAAAAA~AQA",
      calendarKeys: ["sre~fc~fmcns~13ice"],
    },
  },
  {
    id: "veterans-somerville",
    emoji: "🌟",
    color: "#f5fcfe",
    name: "Veterans Memorial Rink",
    town: "Somerville",
    address: "570 Somerville Ave, Somerville, MA 02143",
    website: "https://fmcicesports.com/rink/somerville-veterans-memorial-rink/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.somerville",
    operator: "FMC Ice Sports (DCR)",
    source: {
      kind: "halix",
      baseUrl: "https://fmc.myhalix.io",
      sandbox: "sbx~00~300",
      businessKey: "biz~00~-wcAAAAAAAA~AQA",
      calendarKeys: ["sre~01~gScAAAAAAAA~YGY", "sre~01~gScAAAAAAAA~WmY"],
    },
  },
  {
    id: "ryan-watertown",
    emoji: "🌊",
    color: "#fef7fb",
    name: "John A. Ryan Skating Arena",
    town: "Watertown",
    address: "1 Paramount Pl, Watertown, MA 02472",
    website: "https://app.rectimes.com/ryanarena",
    scheduleUrl: "https://app.rectimes.com/ryanarena",
    operator: "Town of Watertown",
    source: { kind: "rectimes", apiBaseUrl: "https://api.rectimes.com", facility: "ryanarena", venueIds: [1281] },
  },
  {
    id: "hayden-lexington",
    emoji: "🐎",
    color: "#f7fef5",
    name: "Hayden Recreation Centre",
    town: "Lexington",
    address: "10 Lincoln St, Lexington, MA 02421",
    website: "https://www.jwhayden.org/",
    scheduleUrl: "https://www.jwhayden.org/adult-programs",
    operator: "Hayden Recreation Centre (private, non-profit)",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.jwhayden.org/adult-programs", "https://www.jwhayden.org/facility-schedules", "https://www.jwhayden.org/skating"],
      hints: "Hayden's John P. Chase Ice Facility. Adult Stick and Puck is a weekly recurring session (historically Tuesdays and Thursdays 12:00-1:45 PM) that requires advance registration; the ice facility is closed weekends. Title the stick & puck sessions 'Adult Stick and Puck'. 'Club Ice' is figure skating practice ice. Only emit ice-rink sessions, not pool or gym schedules.",
    },
  },
  {
    id: "stoneham-arena",
    emoji: "🪨",
    color: "#f8f7fe",
    name: "Stoneham Arena",
    town: "Stoneham",
    address: "101 Montvale Ave, Stoneham, MA 02180",
    website: "https://www.stoneham-ma.gov/",
    scheduleUrl: "https://www.stoneham-ma.gov/calendar.aspx?view=list&CID=26",
    operator: "Town of Stoneham",
    source: { kind: "civicengage", baseUrl: "https://www.stoneham-ma.gov", calendarId: 26 },
  },
  {
    id: "obrien-woburn",
    emoji: "🍀",
    color: "#fef8f5",
    name: "O'Brien Memorial Rink",
    town: "Woburn",
    address: "55 Locust St, Woburn, MA 01801",
    website: "https://www.woburnyouthhockey.org/about/o-brien-ice-rink-information/2071",
    operator: "City of Woburn",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.woburnyouthhockey.org/about/o-brien-ice-rink-information/2071"],
      hints: "O'Brien Rink public skating is run with Woburn Recreation; the page embeds or links the current season public skating schedule (PDF or image). Extract dated public skating sessions and any stick & puck sessions.",
    },
  },
  {
    id: "daly-brighton",
    emoji: "🌞",
    color: "#f7fefc",
    name: "Daly Memorial Rink",
    town: "Brighton",
    address: "1 Nonantum Rd, Brighton, MA 02135",
    website: "https://www.dalyrink.org/",
    scheduleUrl: "https://www.dalyrink.org/calendar/",
    operator: "DCR",
    source: { kind: "ical", url: "https://www.dalyrink.org/?feed=my-calendar-ics" },
  },
  {
    id: "warrior-brighton",
    emoji: "⚔️",
    color: "#fdf5fe",
    name: "Warrior Ice Arena",
    town: "Brighton",
    address: "90 Guest St, Brighton, MA 02135",
    website: "https://www.warrioricearena.com/",
    scheduleUrl: "https://warrior.finnlyconnect.com/schedule/20",
    operator: "Boston Bruins / Warrior Ice Arena",
    source: { kind: "finnly", baseUrl: "https://warrior.finnlyconnect.com", scheduleIds: [20] },
  },
  {
    id: "veterans-waltham",
    emoji: "⌚",
    color: "#fcfef7",
    name: "Veterans Memorial Rink",
    town: "Waltham",
    address: "295 Totten Pond Rd, Waltham, MA 02451",
    website: "https://www.city.waltham.ma.us/1946/Veterans-Memorial-Skating-Rink",
    scheduleUrl: "https://www.city.waltham.ma.us/1946/Veterans-Memorial-Skating-Rink",
    operator: "DCR",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.city.waltham.ma.us/1946/Veterans-Memorial-Skating-Rink"],
      hints: "City of Waltham municipal rink. Look for public skating, public hockey / stick time, and learn to skate hours, including any linked schedule PDFs or images.",
    },
  },
  {
    id: "reilly-brighton",
    emoji: "🦁",
    color: "#f5f9fe",
    name: "Reilly Memorial Rink",
    town: "Brighton",
    address: "355 Chestnut Hill Ave, Brighton, MA 02135",
    website: "https://www.mass.gov/locations/reilly-memorial-rink",
    scheduleUrl: "https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule",
    operator: "DCR",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule"],
      hints: "Only use the section headed 'Reilly - Brighton'. Ignore all other rinks on the page. 'Public stick time' is DCR public hockey / stick time. Respect the season dates and the public skating start date given in the page overview; if the page says closed for the season and no upcoming season dates are listed, return no events.",
    },
  },
  {
    id: "steriti-boston",
    emoji: "🍝",
    color: "#fef7f8",
    name: "Steriti Memorial Rink",
    town: "Boston (North End)",
    address: "561 Commercial St, Boston, MA 02109",
    website: "https://www.mass.gov/locations/steriti-memorial-rink",
    scheduleUrl: "https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule",
    operator: "DCR",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule"],
      hints: "Only use the section headed 'Steriti - Boston'. Ignore all other rinks on the page. 'Public stick time' is DCR public hockey / stick time. Respect the season dates and the public skating start date given in the page overview; if the page says closed for the season and no upcoming season dates are listed, return no events.",
    },
  },
  {
    id: "emmons-charlestown",
    emoji: "⚓",
    color: "#f5fef6",
    name: "Emmons Horrigan O'Neil Memorial Rink",
    town: "Charlestown",
    address: "46 Union St, Charlestown, MA 02129",
    website: "https://www.mass.gov/locations/emmons-horrigan-oneil-memorial-rink",
    scheduleUrl: "https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule",
    operator: "DCR",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.mass.gov/info-details/dcr-ice-skating-rink-schedule"],
      hints: "Only use the section headed 'EHO - Charlestown' (Emmons Horrigan O'Neil Memorial Rink). Ignore all other rinks on the page. 'Public stick time' is DCR public hockey / stick time. Respect the season dates and the public skating start date given in the page overview; if the page says closed for the season and no upcoming season dates are listed, return no events.",
    },
  },
  {
    id: "allied-veterans-everett",
    emoji: "🦉",
    color: "#faf7fe",
    name: "Allied Veterans Memorial Rink",
    town: "Everett",
    address: "25 Elm St, Everett, MA 02149",
    website: "https://fmcicesports.com/rink/everett-allied-veterans-memorial-rink/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.everett",
    operator: "FMC Ice Sports (DCR)",
    source: {
      kind: "halix",
      baseUrl: "https://fmc.myhalix.io",
      sandbox: "sbx~00~300",
      businessKey: "biz~00~-wcAAAAAAAA~AQA",
      calendarKeys: ["sre~01~wSsAAAAAAAA~_jw"],
    },
  },
  {
    id: "ice-palace-burlington",
    emoji: "🏰",
    color: "#fefaf5",
    name: "Burlington Ice Palace",
    town: "Burlington",
    address: "36 Ray Ave, Burlington, MA 01803",
    website: "https://fmcicesports.com/rink/burlington-burlington-ice-palace/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.burlington",
    operator: "FMC Ice Sports",
    source: {
      kind: "halix",
      baseUrl: "https://fmc.myhalix.io",
      sandbox: "sbx~00~300",
      businessKey: "biz~00~-wcAAAAAAAA~AQA",
      calendarKeys: ["sre~fc~fmcns~4ice"],
    },
  },
  {
    id: "edge-bedford",
    emoji: "🔺",
    color: "#f7fefe",
    name: "The Edge Sports Center",
    town: "Bedford",
    address: "191 Hartwell Rd, Bedford, MA 01730",
    website: "https://www.edgesportscenter.com/",
    operator: "Edge Sports Group",
  },
  {
    id: "kasabuski-saugus",
    emoji: "🦌",
    color: "#fef5fc",
    name: "Kasabuski Memorial Rink",
    town: "Saugus",
    address: "201 Forest St, Saugus, MA 01906",
    website: "https://www.saugus-ma.gov/",
    operator: "Town of Saugus",
  },
  {
    id: "burbank-reading",
    emoji: "📚",
    color: "#fafef7",
    name: "Burbank Ice Arena",
    town: "Reading",
    address: "51 Symonds Way, Reading, MA 01867",
    website: "https://www.burbankicearena.com/",
    scheduleUrl: "https://www.burbankicearena.com/stick-practice",
    operator: "Burbank Arena",
    source: {
      kind: "document-vision",
      documentUrls: ["https://www.burbankicearena.com/stick-practice", "https://www.burbankicearena.com/public-skating"],
      hints: "Burbank Ice Arena publishes weekly recurring Stick Practice (all ages stick & puck) and Public Skating times as text. Use the most recent schedule block on each page; if a schedule is labelled for a season (e.g. summer) that has clearly ended, still emit it as the best available weekly schedule but note it.",
    },
  },
  {
    id: "cronin-revere",
    emoji: "🏖️",
    color: "#f5f6fe",
    name: "Cronin Memorial Rink",
    town: "Revere",
    address: "850 Revere Beach Pkwy, Revere, MA 02151",
    website: "https://fmcicesports.com/rink/revere-cronin-skating-arena/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.revere",
    operator: "FMC Ice Sports (DCR)",
    source: {
      kind: "halix",
      baseUrl: "https://fmc.myhalix.io",
      sandbox: "sbx~00~300",
      businessKey: "biz~00~-wcAAAAAAAA~AQA",
      calendarKeys: ["sre~fc~fmcns~10ice"],
    },
  },
  {
    id: "porrazzo-east-boston",
    emoji: "✈️",
    color: "#fef8f7",
    name: "Porrazzo Memorial Rink",
    town: "East Boston",
    address: "20 Porrazzo Rink Rd, East Boston, MA 02128",
    website: "https://fmcicesports.com/rink/east-boston-porrazzo-skating-arena/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.eastboston",
    operator: "FMC Ice Sports (DCR)",
    lat: 42.3876,
    lng: -71.0064,
  },
  {
    id: "murphy-south-boston",
    emoji: "🐚",
    color: "#f5fef8",
    name: "Murphy Memorial Rink",
    town: "South Boston",
    address: "1880 William J Day Blvd, South Boston, MA 02127",
    website: "https://www.mass.gov/locations/murphy-memorial-rink",
    operator: "DCR",
  },
  {
    id: "larsen-winthrop",
    emoji: "🐬",
    color: "#fcf7fe",
    name: "Larsen Memorial Rink",
    town: "Winthrop",
    address: "1 Larsen Rink Rd, Winthrop, MA 02152",
    website: "https://www.mass.gov/locations/larsen-memorial-rink",
    operator: "DCR",
    lat: 42.3839,
    lng: -70.9852,
  },
  {
    id: "babson-wellesley",
    emoji: "🦫",
    color: "#fefef5",
    name: "Babson Skating Center",
    town: "Wellesley",
    address: "150 Great Plain Ave, Wellesley, MA 02482",
    website: "https://www.babson.edu/skating-center/",
    operator: "Babson College",
  },
  {
    id: "bsi-wellesley",
    emoji: "🏛️",
    color: "#f7fcfe",
    name: "Boston Sports Institute",
    town: "Wellesley",
    address: "900 Worcester St, Wellesley, MA 02482",
    website: "https://www.bostonsportsinstitute.com/",
    operator: "Edge Sports Group",
  },
  {
    id: "valley-concord",
    emoji: "🍇",
    color: "#fef5f8",
    name: "Valley Sports Arena",
    town: "Concord",
    address: "45 Forest Ridge Rd, Concord, MA 01742",
    website: "https://www.valleysportsarena.com/",
    operator: "Valley Sports Arena",
  },
  {
    id: "connery-lynn",
    emoji: "👟",
    color: "#f8fef7",
    name: "Connery Memorial Rink",
    town: "Lynn",
    address: "190 Shepard St, Lynn, MA 01902",
    website: "https://fmcicesports.com/rink/lynn-connery-skating-arena/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.lynn",
    operator: "FMC Ice Sports (DCR)",
  },
  {
    id: "chase-natick",
    emoji: "🌲",
    color: "#f6f5fe",
    name: "William L. Chase Arena",
    town: "Natick",
    address: "25 Windsor Ave, Natick, MA 01760",
    website: "https://fmcicesports.com/rink/natick-william-l-chase-arena/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.natick",
    operator: "FMC Ice Sports",
  },
  {
    id: "roche-west-roxbury",
    emoji: "🐻",
    color: "#fefaf7",
    name: "Jim Roche Community Arena",
    town: "West Roxbury",
    address: "1275 VFW Pkwy, West Roxbury, MA 02132",
    website: "https://fmcicesports.com/rink/west-roxbury-jim-roche-community-arena/",
    scheduleUrl: "https://fmc.myhalix.io/pages/calendars.westroxbury",
    operator: "FMC Ice Sports (DCR)",
  },
  {
    id: "ristuccia-wilmington",
    emoji: "🐺",
    color: "#f5fefc",
    name: "MPG Arena (formerly Ristuccia)",
    town: "Wilmington",
    address: "190 Main St, Wilmington, MA 01887",
    website: "https://www.wilmingtonyouthhockey.org/rinks",
    operator: "MPG Arena",
    notes: "Private facility; no public stick & puck sessions are published.",
    source: { kind: "link-only", reason: "No public schedule is published online." },
  },
  {
    id: "devine-dorchester",
    emoji: "🦩",
    color: "#fef7fe",
    name: "Devine Memorial Rink",
    town: "Dorchester",
    address: "995 Morrissey Blvd, Dorchester, MA 02122",
    website: "https://www.mass.gov/locations/devine-memorial-rink",
    operator: "DCR",
  },
  {
    id: "mcvann-okeefe-peabody",
    emoji: "🐆",
    color: "#fafef5",
    name: "McVann-O'Keefe Memorial Rink",
    town: "Peabody",
    address: "511 Lowell St, Peabody, MA 01960",
    website: "https://www.mass.gov/locations/mcvann-okeefe-memorial-rink",
    operator: "DCR",
  },
  {
    id: "skating-club-of-boston-norwood",
    emoji: "⛸️",
    color: "#f7fafe",
    name: "The Skating Club of Boston",
    town: "Norwood",
    address: "750 University Ave, Norwood, MA 02062",
    website: "https://www.scboston.org/",
    operator: "The Skating Club of Boston",
  },
];

interface Geo {
  lat: number;
  lng: number;
  displayName?: string;
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

async function nominatim(query: string): Promise<Geo | null> {
  const url = `https://nominatim.openstreetmap.org/search?format=json&limit=1&countrycodes=us&q=${encodeURIComponent(query)}`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT, Accept: "application/json" } });
  if (!res.ok) throw new Error(`Nominatim ${res.status} for ${query}`);
  const rows = (await res.json()) as Array<{ lat: string; lon: string; display_name: string }>;
  const row = rows[0];
  if (!row) return null;
  return { lat: Number(row.lat), lng: Number(row.lon), displayName: row.display_name };
}

async function geocode(c: Candidate): Promise<Geo> {
  if (c.lat !== undefined && c.lng !== undefined) return { lat: c.lat, lng: c.lng };
  const queries = [c.address, `${c.name}, ${c.town}, Massachusetts`];
  for (const q of queries) {
    const geo = await nominatim(q);
    await sleep(1100);
    if (geo) return geo;
  }
  throw new Error(`Could not geocode ${c.name}`);
}

async function osrmTable(destinations: Geo[]): Promise<{ durations: number[]; distances: number[] }> {
  const coords = [ORIGIN, ...destinations].map((p) => `${p.lng},${p.lat}`).join(";");
  const url = `https://router.project-osrm.org/table/v1/driving/${coords}?sources=0&annotations=duration,distance`;
  const res = await fetch(url, { headers: { "User-Agent": USER_AGENT } });
  if (!res.ok) throw new Error(`OSRM ${res.status}`);
  const body = (await res.json()) as { code: string; durations: number[][]; distances: number[][] };
  if (body.code !== "Ok") throw new Error(`OSRM returned ${body.code}`);
  return { durations: body.durations[0]!.slice(1), distances: body.distances[0]!.slice(1) };
}

function loadExisting(): Map<string, any> {
  if (!existsSync(outFile)) return new Map();
  const rows = JSON.parse(readFileSync(outFile, "utf8")) as any[];
  return new Map(rows.map((r) => [r.id, r]));
}

async function main() {
  const args = process.argv.slice(2);
  const limitIdx = args.indexOf("--limit");
  const limit = args.includes("--all") ? Infinity : limitIdx >= 0 ? Number(args[limitIdx + 1]) : 20;

  const existing = loadExisting();
  const geos: Geo[] = [];
  for (const c of CANDIDATES) {
    const prev = existing.get(c.id);
    if (prev?.lat && prev?.lng && c.lat === undefined) {
      geos.push({ lat: prev.lat, lng: prev.lng });
      continue;
    }
    process.stderr.write(`geocoding ${c.name}...\n`);
    geos.push(await geocode(c));
  }

  const { durations, distances } = await osrmTable(geos);
  const rows = CANDIDATES.map((c, i) => {
    const geo = geos[i]!;
    const prev = existing.get(c.id);
    const preservedSource = prev?.source && prev.source.kind !== "link-only" ? prev.source : undefined;
    return {
      id: c.id,
      name: c.name,
      emoji: c.emoji,
      color: c.color,
      town: c.town,
      address: c.address,
      lat: Number(geo.lat.toFixed(5)),
      lng: Number(geo.lng.toFixed(5)),
      driveMinutes: Math.round((durations[i] ?? 0) / 60),
      driveMiles: Number(((distances[i] ?? 0) / 1609.344).toFixed(1)),
      website: c.website,
      scheduleUrl: prev?.scheduleUrl ?? c.scheduleUrl,
      operator: c.operator,
      source: c.source ?? preservedSource ?? { kind: "link-only" },
      notes: prev?.notes ?? c.notes,
    };
  });

  rows.sort((a, b) => a.driveMinutes - b.driveMinutes || a.driveMiles - b.driveMiles);
  const selected = rows.slice(0, limit);

  mkdirSync(path.dirname(outFile), { recursive: true });
  writeFileSync(outFile, `${JSON.stringify(selected, null, 2)}\n`);

  for (const r of rows) {
    const mark = selected.includes(r) ? "*" : " ";
    process.stdout.write(`${mark} ${String(r.driveMinutes).padStart(3)} min ${String(r.driveMiles).padStart(5)} mi  ${r.name} (${r.town}) [${r.source.kind}]\n`);
  }
  process.stdout.write(`\nWrote ${selected.length} rinks to ${path.relative(repoRoot, outFile)}\n`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
