import { type Adapter, type AdapterContext, ProviderError, type ResourceItem, checkStatus, excerpt, fetchWithTimeout, readJson } from "@/lib/adapters/types";

// Docs: https://api.radar.checkfirst.network/api/v1/swagger.yaml. Keyless; a descriptive User-Agent is required.
// Content: CheckFirst's RADAR taxonomy of potential Digital Services Act infringements and their observable indicators.
const DEFAULT_ENDPOINT = "https://api.radar.checkfirst.network/api/v1";
const USER_AGENT = "ASFAI-Information-Integrity/0.2 (https://github.com/redbeard-26/information-integrity)";
const ATTRIBUTION = { statement: "Source: CheckFirst RADAR framework (radar.checkfirst.network), CC BY 4.0.", license: "CC BY 4.0" };

interface Infringement {
  id?: string;
  infringement_id?: string;
  name?: string;
  infringement_name?: string;
  description?: string;
  category_name?: string;
  category?: { name?: string };
  dsaArticles?: string[];
  relevance_score?: number;
}

async function get<T>(ctx: AdapterContext, path: string): Promise<T> {
  const response = await fetchWithTimeout(ctx, `${ctx.env.CHECKFIRST_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, {
    headers: { accept: "application/json", "user-agent": USER_AGENT },
  });
  checkStatus(response);
  return readJson<T>(response);
}

function toItem(record: Infringement, ctx: AdapterContext): ResourceItem {
  const id = record.infringement_id ?? record.id;
  if (typeof id !== "string" && typeof id !== "number") throw new ProviderError("bad_response", "Infringement without an id");
  const category = record.category_name ?? record.category?.name;
  return {
    provider: "CheckFirst",
    source_id: "checkfirst-radar-api",
    original_id: String(id),
    original_url: "https://radar.checkfirst.network/",
    title: excerpt(record.infringement_name ?? record.name, 200),
    excerpt: excerpt(record.description),
    published_at: null,
    retrieved_at: ctx.now().toISOString(),
    language: "en",
    method: "Framework of potential DSA infringements with observable indicators",
    original_labels: [category, ...(record.dsaArticles ?? []).map((article) => `DSA ${article}`)].filter((label): label is string => !!label),
    attribution: ATTRIBUTION,
    untrusted: true,
  };
}

export const checkFirstAdapter: Adapter = {
  sourceId: "checkfirst-radar-api",
  requiredEnv: [],
  optionalEnv: ["CHECKFIRST_ENDPOINT"],
  capabilities: ["search", "get"],

  async search(query, { limit }, ctx) {
    const body = await get<{ results?: Infringement[]; total_above_threshold?: number }>(
      ctx,
      `/infringements/search?q=${encodeURIComponent(query)}&limit=${Math.min(limit, 100)}`,
    );
    if (!Array.isArray(body.results)) throw new ProviderError("bad_response", "Search response had no results array");
    return {
      items: body.results.map((record) => toItem(record, ctx)),
      total: typeof body.total_above_threshold === "number" ? body.total_above_threshold : null,
      next_cursor: null,
    };
  },

  async get(id, ctx) {
    return toItem(await get<Infringement>(ctx, `/infringements/${encodeURIComponent(id)}`), ctx);
  },
};
