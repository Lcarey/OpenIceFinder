import type { ClassificationTable, Program, Rink } from "@openice/shared";
import rinksJson from "../../../data/rinks.json" with { type: "json" };
import programsJson from "../../../data/programs.json" with { type: "json" };
import seedJson from "../../../data/classifications.seed.json" with { type: "json" };

/** Bundled rink list (data/rinks.json). */
export const RINKS: Rink[] = rinksJson as Rink[];

/** Bundled hockey programs whose team schedules annotate a rink (data/programs.json). */
export const PROGRAMS: Program[] = programsJson as Program[];

/** Bundled classification seed table (data/classifications.seed.json). */
export const SEED_CLASSIFICATIONS: ClassificationTable = seedJson as ClassificationTable;
