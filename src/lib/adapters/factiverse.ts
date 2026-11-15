import { inputKind, result } from "@/lib/adapters/detection";
import { type Adapter, type AdapterContext, ProviderError, type ResourceItem, checkStatus, excerpt, fetchWithTimeout, readJson, requireEnv, safeUrl } from "@/lib/adapters/types";

// Docs: https://api.factiverse.ai/v1/openapi.json and https://github.com/factiverse/factiverse_fact_check_mcp.
const DEFAULT_ENDPOINT = "https://api.factiverse.ai";
const ATTRIBUTION = { statement: "Results from Factiverse claim search and automated fact-checking. Check the linked sources.", license: null };
const LABELS = ["REFUTES", "SUPPORTS", "MIXED", "NOT_ENOUGH_INFO"];

async function post<T>(ctx: AdapterContext, path: string, body: unknown): Promise<T> {
  const token = requireEnv(ctx, "FACTIVERSE_TOKEN", "a Factiverse API bearer token, issued by Factiverse");
  const response = await fetchWithTimeout(ctx, `${ctx.env.FACTIVERSE_ENDPOINT ?? DEFAULT_ENDPOINT}${path}`, {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${token}` },
    body: JSON.stringify(body),
  });
  checkStatus(response);
  return readJson<T>(response);
}

interface ClaimHit {
  claim?: string;
  label?: string;
  url?: string;
  domainName?: string;
  publishDate?: string;
  lang?: string;
  title?: string;
  doc?: string;
}

function toItem(hit: ClaimHit, index: number, ctx: AdapterContext): ResourceItem {
  const url = safeUrl(hit.url);
  return {
    provider: hit.domainName ? `Factiverse (via ${hit.domainName})` : "Factiverse",
    source_id: "factiverse-mcp",
    original_id: url ?? `hit-${index}`,
    original_url: url,
    title: excerpt(hit.title ?? hit.claim, 200),
    excerpt: excerpt(hit.claim ?? hit.doc),
    published_at: hit.publishDate ?? null,
    retrieved_at: ctx.now().toISOString(),
    language: hit.lang ?? null,
    method: "Search of published fact-checks (Factiverse index)",
    original_labels: hit.label ? [hit.label] : [],
    attribution: ATTRIBUTION,
    untrusted: true,
  };
}

export const factiverseAdapter: Adapter = {
  sourceId: "factiverse-mcp",
  requiredEnv: ["FACTIVERSE_TOKEN"],
  optionalEnv: ["FACTIVERSE_ENDPOINT"],
  capabilities: ["search", "analyze"],

  async search(query, { limit }, ctx) {
    const body = await post<{ searchResults?: ClaimHit[] }>(ctx, "/v1/claim_search", {
      query,
      lang: "",
      searchEngine: "fact_search_elasticsearch",
    });
    if (!Array.isArray(body.searchResults)) throw new ProviderError("bad_response", "Response had no searchResults");
    return { items: body.searchResults.slice(0, limit).map((hit, index) => toItem(hit, index, ctx)), total: body.searchResults.length, next_cursor: null };
  },

  async analyze(input, ctx) {
    if (inputKind(input) !== "text") throw new ProviderError("bad_response", "Factiverse fact-checks text; pass text");
    const body = await post<{ _id?: string; fact_checks?: Array<{ claim?: string; finalPrediction?: number; finalScore?: number; summary?: string }> }>(
      ctx,
      "/v1/fact_check",
      { text: input.text, lang: "" },
    );
    if (!Array.isArray(body.fact_checks)) throw new ProviderError("bad_response", "Response had no fact_checks");
    const labels = body.fact_checks.map((check) => `${excerpt(check.claim, 120) ?? "claim"}: ${LABELS[check.finalPrediction ?? -1] ?? "UNLABELLED"}`);
    const scores = Object.fromEntries(body.fact_checks.flatMap((check, index) => (typeof check.finalScore === "number" ? [[`claim_${index + 1}_score`, check.finalScore]] : [])));
    return result(ctx, { provider: "Factiverse", source_id: "factiverse-mcp", method: "Automated claim detection and stance against retrieved evidence" }, {
      input_kind: "text",
      state: "complete",
      original_labels: labels,
      scores,
      report_id: body._id ?? null,
      details: excerpt(body.fact_checks.map((check) => check.summary).filter(Boolean).join(" "), 1500),
    });
  },
};
