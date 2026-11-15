import { type Adapter, type AdapterContext, ProviderError, type ResourceItem, checkStatus, excerpt, fetchWithTimeout, readJson, requireEnv, safeUrl } from "@/lib/adapters/types";

// Docs: https://github.com/meedan/check/wiki (Authentication, GraphQL query examples); check-api lib/check_search.rb.
// A Check workspace key carries editor rights, so this adapter only ever sends GraphQL queries, never mutations.
const DEFAULT_ENDPOINT = "https://check-api.checkmedia.org/api/graphql";
const FIELDS = "dbid title description full_url status report_status published language claim_description { description fact_check { title summary url } }";

interface CheckItem {
  dbid?: number;
  title?: string;
  description?: string;
  full_url?: string;
  status?: string;
  report_status?: string;
  published?: string;
  language?: string;
  claim_description?: { description?: string; fact_check?: { title?: string; summary?: string; url?: string } | null } | null;
}

async function graphql<T>(ctx: AdapterContext, query: string, variables: Record<string, unknown>): Promise<T> {
  const token = requireEnv(ctx, "CHECK_API_TOKEN", "a Check workspace API key (Integrations > API access)");
  const team = requireEnv(ctx, "CHECK_TEAM_SLUG", "the Check workspace slug");
  if (/\bmutation\b/.test(query)) throw new ProviderError("bad_response", "Mutations are not allowed");
  const response = await fetchWithTimeout(ctx, ctx.env.CHECK_API_ENDPOINT ?? DEFAULT_ENDPOINT, {
    method: "POST",
    headers: { "content-type": "application/json", "x-check-token": token, "x-check-team": team },
    body: JSON.stringify({ query, variables }),
  });
  checkStatus(response);
  const body = await readJson<{ data?: T; errors?: Array<{ message?: string }> }>(response);
  if (body.errors?.length) throw new ProviderError("bad_response", `GraphQL error: ${body.errors[0]?.message ?? "unknown"}`);
  if (!body.data) throw new ProviderError("bad_response", "Response had no data");
  return body.data;
}

function toItem(item: CheckItem, ctx: AdapterContext, team: string): ResourceItem {
  if (item.dbid == null) throw new ProviderError("bad_response", "Item without an id");
  const factCheck = item.claim_description?.fact_check;
  const published = Number(item.published);
  return {
    provider: `Meedan Check (${team})`,
    source_id: "meedan-check-api",
    original_id: String(item.dbid),
    original_url: safeUrl(factCheck?.url) ?? safeUrl(item.full_url),
    title: excerpt(factCheck?.title ?? item.title, 200),
    excerpt: excerpt(factCheck?.summary ?? item.claim_description?.description ?? item.description),
    published_at: Number.isFinite(published) && published > 0 ? new Date(published * 1000).toISOString() : null,
    retrieved_at: ctx.now().toISOString(),
    language: item.language ?? null,
    method: "Items and fact-checks in a Check workspace",
    original_labels: [item.status, item.report_status].filter((label): label is string => !!label),
    attribution: { statement: `From the Check workspace '${team}', used with that workspace's permission.`, license: null },
    untrusted: true,
  };
}

export const meedanCheckAdapter: Adapter = {
  sourceId: "meedan-check-api",
  requiredEnv: ["CHECK_API_TOKEN", "CHECK_TEAM_SLUG"],
  optionalEnv: ["CHECK_API_ENDPOINT"],
  capabilities: ["search", "get"],

  async search(query, { limit, cursor }, ctx) {
    const offset = Math.max(Number(cursor ?? 0) || 0, 0);
    const search = JSON.stringify({ keyword: query, eslimit: limit, esoffset: offset, report_status: ["published"] });
    const data = await graphql<{ search?: { medias?: { edges?: Array<{ node: CheckItem }> } } }>(
      ctx,
      `query Search($q: String!) { search(query: $q) { medias { edges { node { ${FIELDS} } } } } }`,
      { q: search },
    );
    const edges = data.search?.medias?.edges;
    if (!Array.isArray(edges)) throw new ProviderError("bad_response", "Search response had no edges");
    return {
      items: edges.map((edge) => toItem(edge.node, ctx, ctx.env.CHECK_TEAM_SLUG as string)),
      total: null,
      next_cursor: edges.length === limit ? String(offset + limit) : null,
    };
  },

  async get(id, ctx) {
    if (!/^\d+$/.test(id)) throw new ProviderError("not_found", "Check item ids are numeric");
    const search = JSON.stringify({ keyword: "", eslimit: 1, esoffset: 0, project_media_ids: [Number(id)] });
    const data = await graphql<{ search?: { medias?: { edges?: Array<{ node: CheckItem }> } } }>(
      ctx,
      `query Get($q: String!) { search(query: $q) { medias { edges { node { ${FIELDS} } } } } }`,
      { q: search },
    );
    const node = data.search?.medias?.edges?.[0]?.node;
    if (!node) throw new ProviderError("not_found", `No Check item ${id}`);
    return toItem(node, ctx, ctx.env.CHECK_TEAM_SLUG as string);
  },
};
