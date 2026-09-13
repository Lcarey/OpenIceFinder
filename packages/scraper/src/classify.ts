import {
  CATEGORY_DESCRIPTIONS,
  ICE_CATEGORIES,
  classifyByRules,
  isIceCategory,
  normalizeTitle,
  type ClassificationEntry,
  type ClassificationTable,
  type IceCategory,
} from "@openice/shared";
import type OpenAI from "openai";

export interface ClassificationResult {
  category: IceCategory;
  classifiedBy: "rule" | "lookup" | "model" | "default";
}

export interface UnknownTitle {
  rinkId: string;
  rinkName: string;
  title: string;
  /** A representative occurrence to give the model context. */
  example?: { start: string; end: string; surface?: string; description?: string };
}

const MODEL_BATCH_SIZE = 60;

export const CLASSIFICATION_SCHEMA = {
  type: "object",
  additionalProperties: false,
  required: ["items"],
  properties: {
    items: {
      type: "array",
      items: {
        type: "object",
        additionalProperties: false,
        required: ["title", "category", "reason"],
        properties: {
          title: { type: "string", description: "Exactly the title string that was provided." },
          category: { type: "string", enum: [...ICE_CATEGORIES] },
          reason: { type: "string", description: "Short justification (<= 20 words)." },
        },
      },
    },
  },
} as const;

export function emptyTable(): ClassificationTable {
  return { version: 1, entries: [] };
}

/** Merge tables; later tables win on (rinkId,title) conflicts. */
export function mergeTables(...tables: Array<ClassificationTable | undefined>): ClassificationTable {
  const map = new Map<string, ClassificationEntry>();
  for (const table of tables) {
    for (const entry of table?.entries ?? []) {
      map.set(`${entry.rinkId}|${normalizeTitle(entry.title)}`, { ...entry, title: normalizeTitle(entry.title) });
    }
  }
  return { version: 1, entries: [...map.values()].sort((a, b) => a.rinkId.localeCompare(b.rinkId) || a.title.localeCompare(b.title)) };
}

export class Classifier {
  private readonly lookup = new Map<string, ClassificationEntry>();
  readonly added: ClassificationEntry[] = [];

  constructor(
    table: ClassificationTable,
    private readonly options: {
      openai?: () => Promise<OpenAI>;
      model: string;
      log?: (message: string) => void;
    },
  ) {
    for (const entry of table.entries) this.lookup.set(this.key(entry.rinkId, entry.title), entry);
  }

  private key(rinkId: string, title: string): string {
    return `${rinkId}|${normalizeTitle(title)}`;
  }

  get table(): ClassificationTable {
    return { version: 1, entries: [...this.lookup.values()].sort((a, b) => a.rinkId.localeCompare(b.rinkId) || a.title.localeCompare(b.title)) };
  }

  /** Lookup table, then wildcard table, then keyword rules. Null means the model is needed. */
  classify(rinkId: string, title: string): ClassificationResult | null {
    const exact = this.lookup.get(this.key(rinkId, title));
    if (exact) return { category: exact.category, classifiedBy: exact.source === "model" ? "model" : "lookup" };
    const wildcard = this.lookup.get(this.key("*", title));
    if (wildcard) return { category: wildcard.category, classifiedBy: wildcard.source === "model" ? "model" : "lookup" };
    const rule = classifyByRules(title);
    if (rule) return { category: rule.category, classifiedBy: "rule" };
    return null;
  }

  /** Final fallback when the model is unavailable or fails: opaque names are renters. */
  fallback(): ClassificationResult {
    return { category: "private_rental", classifiedBy: "default" };
  }

  remember(entry: ClassificationEntry): void {
    const normalized = { ...entry, title: normalizeTitle(entry.title) };
    this.lookup.set(this.key(normalized.rinkId, normalized.title), normalized);
    this.added.push(normalized);
  }

  /** Ask the model about titles that neither the table nor the rules could place. */
  async resolveWithModel(unknowns: UnknownTitle[]): Promise<void> {
    const pending = unknowns.filter((u) => !this.lookup.has(this.key(u.rinkId, u.title)));
    if (pending.length === 0) return;
    if (!this.options.openai) {
      this.options.log?.(`classifier: ${pending.length} unknown titles and no OpenAI client configured; defaulting to private_rental`);
      return;
    }
    let client: OpenAI;
    try {
      client = await this.options.openai();
    } catch (error) {
      this.options.log?.(`classifier: OpenAI unavailable (${(error as Error).message}); defaulting unknown titles`);
      return;
    }

    const byRink = new Map<string, UnknownTitle[]>();
    for (const u of pending) {
      const list = byRink.get(u.rinkId) ?? [];
      if (!list.some((x) => normalizeTitle(x.title) === normalizeTitle(u.title))) list.push(u);
      byRink.set(u.rinkId, list);
    }

    for (const [rinkId, list] of byRink) {
      for (let i = 0; i < list.length; i += MODEL_BATCH_SIZE) {
        const batch = list.slice(i, i + MODEL_BATCH_SIZE);
        try {
          const results = await classifyBatch(client, this.options.model, batch);
          for (const item of results) {
            const match = batch.find((b) => normalizeTitle(b.title) === normalizeTitle(item.title));
            if (!match || !isIceCategory(item.category)) continue;
            this.remember({ rinkId, title: match.title, category: item.category, source: "model", note: item.reason });
          }
          this.options.log?.(`classifier: model classified ${results.length}/${batch.length} titles for ${rinkId}`);
        } catch (error) {
          this.options.log?.(`classifier: model call failed for ${rinkId}: ${(error as Error).message}`);
        }
      }
    }
  }
}

function buildClassificationPrompt(): string {
  const categories = ICE_CATEGORIES.map((c) => `- ${c}: ${CATEGORY_DESCRIPTIONS[c]}`).join("\n");
  return [
    "You classify ice rink calendar entries from Greater Boston rinks into categories so a household app can find open ice.",
    "Categories:",
    categories,
    "Guidance:",
    "- Names of teams, leagues, clubs, schools, colleges, camps, businesses, or people (e.g. 'AHC', 'Stinkysocks Hockey', 'Valley Hockey League', 'Thapa Party') are private_rental.",
    "- 'Public stick time', 'stick practice', 'shooting practice' are stick & puck. Choose kids/adult/family variants only when the title says so.",
    "- 'Public hockey', 'pickup', 'drop-in hockey', 'rat hockey', 'adult open hockey' are public_hockey.",
    "- 'Coaches ice', 'open ice (bring your coach)', 'instructional ice' are coach_ice.",
    "- Use 'other' only when nothing else fits. Return one item per provided title, with the title copied exactly.",
  ].join("\n");
}

async function classifyBatch(client: OpenAI, model: string, batch: UnknownTitle[]): Promise<Array<{ title: string; category: string; reason: string }>> {
  const rinkName = batch[0]?.rinkName ?? "rink";
  const lines = batch.map((u, idx) => {
    const example = u.example ? ` (example: ${u.example.start} to ${u.example.end}${u.example.surface ? ` on ${u.example.surface}` : ""}${u.example.description ? `; ${u.example.description.slice(0, 120)}` : ""})` : "";
    return `${idx + 1}. ${JSON.stringify(u.title)}${example}`;
  });
  const response = await client.responses.create({
    model,
    store: false,
    max_output_tokens: 8192,
    reasoning: { effort: "low" },
    text: { format: { type: "json_schema", name: "ice_event_classification", strict: true, schema: CLASSIFICATION_SCHEMA as unknown as Record<string, unknown> } },
    input: [
      { role: "system", content: buildClassificationPrompt() },
      { role: "user", content: `Rink: ${rinkName}\nTitles:\n${lines.join("\n")}` },
    ],
  });
  if (response.status === "incomplete") throw new Error("incomplete response");
  const parsed = JSON.parse(response.output_text) as { items: Array<{ title: string; category: string; reason: string }> };
  return parsed.items;
}
