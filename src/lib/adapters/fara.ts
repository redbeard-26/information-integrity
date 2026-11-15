import { queryTerms } from "@/lib/adapters/feeds";
import { type Adapter, type AdapterContext, ProviderError, type ResourceItem, checkStatus, fetchWithTimeout, readJson } from "@/lib/adapters/types";

// Docs: https://efile.fara.gov/ords/fara/f?p=API:ENDPOINTS. Keyless, public-domain U.S. government data.
// Rate limit: 5 requests per rolling 10 seconds, so calls are spaced at least 2.1 seconds apart.
const DEFAULT_ENDPOINT = "https://efile.fara.gov/api/v1";
const ATTRIBUTION = { statement: "Source: U.S. Department of Justice, FARA eFile (efile.fara.gov). Public domain.", license: "Public domain" };
const CACHE_TTL_MS = 60 * 60 * 1000;
const MIN_GAP_MS = 2100;

interface Registrant {
  Registration_Number?: number | string;
  Registration_Date?: string;
  Name?: string;
  Business_Name?: string;
  City?: string;
  State?: string;
}

let lastCall = 0;
let cache: { at: number; rows: Registrant[] } | null = null;

export function resetFaraState() {
  lastCall = 0;
  cache = null;
}

async function get<T>(ctx: AdapterContext, path: string): Promise<T> {
  const wait = lastCall + MIN_GAP_MS - Date.now();
  if (wait > 0) await (ctx.sleep ?? ((ms: number) => new Promise((resolve) => setTimeout(resolve, ms))))(wait);
  lastCall = Date.now();
  const response = await fetchWithTimeout(ctx, `${ctx.env.FARA_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, { headers: { accept: "application/json" } });
  checkStatus(response);
  return readJson<T>(response);
}

function rows(body: unknown): Registrant[] {
  const wrapper = body && typeof body === "object" ? Object.values(body as Record<string, unknown>)[0] : null;
  const list = wrapper && typeof wrapper === "object" ? (wrapper as { ROW?: unknown }).ROW : null;
  if (Array.isArray(list)) return list as Registrant[];
  if (list && typeof list === "object") return [list as Registrant];
  if (wrapper === null || wrapper === "") return [];
  throw new ProviderError("bad_response", "FARA response had no ROW list");
}

function toIsoDate(value: string | undefined): string | null {
  const match = value?.match(/^(\d{2})\/(\d{2})\/(\d{4})$/);
  return match ? `${match[3]}-${match[1]}-${match[2]}` : null;
}

function toItem(row: Registrant, ctx: AdapterContext, principals: string[] = []): ResourceItem {
  if (row.Registration_Number == null) throw new ProviderError("bad_response", "Registrant without a registration number");
  const number = String(row.Registration_Number);
  const place = [row.City, row.State].filter(Boolean).join(", ");
  return {
    provider: "FARA Unit, U.S. Department of Justice",
    source_id: "fara-efile-api",
    original_id: number,
    original_url: `https://efile.fara.gov/ords/fara/f?p=1381:200:::NO:RP,200:P200_REG_NUMBER:${encodeURIComponent(number)}`,
    title: row.Name ?? null,
    excerpt: [
      row.Business_Name && row.Business_Name !== row.Name ? `Business name: ${row.Business_Name}.` : null,
      place ? `${place}.` : null,
      principals.length ? `Foreign principals: ${principals.slice(0, 20).join("; ")}.` : null,
    ].filter(Boolean).join(" ") || null,
    published_at: toIsoDate(row.Registration_Date),
    retrieved_at: ctx.now().toISOString(),
    language: "en",
    method: "Statutory registration under the Foreign Agents Registration Act",
    original_labels: ["Active registrant"],
    attribution: ATTRIBUTION,
    untrusted: true,
  };
}

async function activeRegistrants(ctx: AdapterContext) {
  const now = ctx.now().getTime();
  if (cache && now - cache.at < CACHE_TTL_MS) return cache.rows;
  const list = rows(await get(ctx, "/Registrants/json/Active"));
  cache = { at: now, rows: list };
  return list;
}

export const faraAdapter: Adapter = {
  sourceId: "fara-efile-api",
  requiredEnv: [],
  optionalEnv: ["FARA_ENDPOINT"],
  capabilities: ["search", "get"],

  async search(query, { limit, cursor }, ctx) {
    const terms = queryTerms(query);
    const matches = (await activeRegistrants(ctx))
      .map((row) => {
        const name = `${row.Name ?? ""} ${row.Business_Name ?? ""}`.toLowerCase();
        return { row, score: terms.filter((term) => name.includes(term)).length };
      })
      .filter((hit) => hit.score > 0)
      .sort((a, b) => b.score - a.score || String(a.row.Name).localeCompare(String(b.row.Name)));
    const offset = Math.max(Number(cursor ?? 0) || 0, 0);
    return {
      items: matches.slice(offset, offset + limit).map((hit) => toItem(hit.row, ctx)),
      total: matches.length,
      next_cursor: offset + limit < matches.length ? String(offset + limit) : null,
    };
  },

  async get(id, ctx) {
    if (!/^\d{1,6}$/.test(id)) throw new ProviderError("not_found", "FARA registration numbers are digits");
    const row = (await activeRegistrants(ctx)).find((entry) => String(entry.Registration_Number) === id);
    if (!row) throw new ProviderError("not_found", `No active FARA registrant ${id}`);
    const principals = rows(await get(ctx, `/ForeignPrincipals/json/Active/${id}`))
      .map((entry) => {
        const record = entry as Record<string, unknown>;
        const name = record.Foreign_Principal ?? record.FP_Name ?? record.Name;
        const country = record.Country_Location_Represented ?? record.Country_Name ?? record.Country;
        return name ? `${name}${country ? ` (${country})` : ""}` : null;
      })
      .filter((value): value is string => !!value);
    return toItem(row, ctx, principals);
  },
};
