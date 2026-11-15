import { minimumMatches, queryTerms } from "@/lib/adapters/feeds";
import { type Adapter, type AdapterContext, ProviderError, type ResourceItem, checkStatus, fetchWithTimeout } from "@/lib/adapters/types";

// Data: https://github.com/correctiv/ru-sanctions-dashboard (MIT). Built from OpenSanctions; last updated January 2024.
const DEFAULT_URL = "https://raw.githubusercontent.com/correctiv/ru-sanctions-dashboard/main/src/data/sanctions_2014-2022.csv";
const ATTRIBUTION = {
  statement: "Source: CORRECTIV Russia sanctions dashboard data (github.com/correctiv/ru-sanctions-dashboard, MIT), compiled from OpenSanctions. Data last updated January 2024.",
  license: "MIT",
};
const CACHE_TTL_MS = 6 * 60 * 60 * 1000;

export interface SanctionRow {
  name: string;
  category_en: string;
  start: string;
  end: string;
  authority: string;
  sourceurl: string;
}

let cache: { at: number; rows: SanctionRow[] } | null = null;

export function resetCorrectivCache() {
  cache = null;
}

/** RFC 4180 CSV parser (quoted fields, doubled quotes, CRLF). */
export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = "";
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '"' && text[i + 1] === '"') {
        field += '"';
        i += 1;
      } else if (char === '"') quoted = false;
      else field += char;
    } else if (char === '"') quoted = true;
    else if (char === ",") {
      row.push(field);
      field = "";
    } else if (char === "\n" || char === "\r") {
      if (char === "\r" && text[i + 1] === "\n") i += 1;
      row.push(field);
      if (row.some((cell) => cell !== "")) rows.push(row);
      row = [];
      field = "";
    } else field += char;
  }
  row.push(field);
  if (row.some((cell) => cell !== "")) rows.push(row);
  return rows;
}

function link(markdown: string): string | null {
  const match = markdown.match(/\((https?:\/\/[^)\s]+)\)/) ?? markdown.match(/(https?:\/\/\S+)/);
  return match ? match[1] : null;
}

async function load(ctx: AdapterContext): Promise<SanctionRow[]> {
  const now = ctx.now().getTime();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rows;
  const response = await fetchWithTimeout(ctx, ctx.env.CORRECTIV_SANCTIONS_URL ?? DEFAULT_URL, {});
  checkStatus(response);
  const [header, ...body] = parseCsv(await response.text());
  const required = ["name", "category_en", "start", "end", "authority", "sourceurl"];
  if (!header || !required.every((column) => header.includes(column))) throw new ProviderError("bad_response", "Unexpected CSV columns");
  const rows = body.map((cells) => Object.fromEntries(header.map((column, index) => [column, cells[index] ?? ""])) as unknown as SanctionRow);
  cache = { at: now, rows };
  return rows;
}

function toItem(row: SanctionRow, index: number, ctx: AdapterContext): ResourceItem {
  const authority = row.authority.replace(/:[a-z_]+:\s*/g, "").trim();
  return {
    provider: "CORRECTIV",
    source_id: "correctiv-sanctions",
    original_id: String(index),
    original_url: link(row.sourceurl),
    title: row.name || null,
    excerpt: `${row.category_en || "Entity"} sanctioned by ${authority || "unknown authority"} from ${row.start || "unknown date"}${row.end ? ` to ${row.end}` : ""}.`,
    published_at: /^\d{4}-\d{2}-\d{2}/.test(row.start) ? row.start.slice(0, 10) : null,
    retrieved_at: ctx.now().toISOString(),
    language: "en",
    method: "Compiled sanctions listings since 2014 (OpenSanctions)",
    original_labels: [row.category_en, authority].filter(Boolean),
    attribution: ATTRIBUTION,
    untrusted: true,
  };
}

export const correctivAdapter: Adapter = {
  sourceId: "correctiv-sanctions",
  requiredEnv: [],
  optionalEnv: ["CORRECTIV_SANCTIONS_URL"],
  capabilities: ["search", "get"],

  async search(query, { limit, cursor }, ctx) {
    const terms = queryTerms(query);
    const rows = await load(ctx);
    const hits = rows
      .map((row, index) => ({ row, index, score: terms.filter((term) => row.name.toLowerCase().includes(term)).length }))
      .filter((hit) => hit.score >= minimumMatches(terms))
      .sort((a, b) => b.score - a.score || a.index - b.index);
    const offset = Math.max(Number(cursor ?? 0) || 0, 0);
    return {
      items: hits.slice(offset, offset + limit).map((hit) => toItem(hit.row, hit.index, ctx)),
      total: hits.length,
      next_cursor: offset + limit < hits.length ? String(offset + limit) : null,
    };
  },

  async get(id, ctx) {
    const rows = await load(ctx);
    const index = Number(id);
    if (!Number.isInteger(index) || !rows[index]) throw new ProviderError("not_found", `No row ${id}`);
    return toItem(rows[index], index, ctx);
  },
};
