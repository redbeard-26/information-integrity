import {
  type Adapter,
  type AdapterContext,
  ProviderError,
  type ResourceItem,
  checkStatus,
  excerpt,
  fetchWithTimeout,
} from "@/lib/adapters/types";

// Schema reference: https://github.com/cofacts/rumors-api (src/graphql). Terms: LEGAL.md in that repository.
const DEFAULT_ENDPOINT = "https://cofacts-api.g0v.tw/graphql";
const ATTRIBUTION = {
  statement:
    "本編輯資料取自「Cofacts 真的假的」訊息回報機器人與查證協作社群，採 CC BY-SA 4.0 授權提供。若欲補充資訊請訪問 Cofacts LINE bot https://line.me/ti/p/@cofacts",
  license: "CC BY-SA 4.0",
};

const ARTICLE_FIELDS = `
  id
  text
  createdAt
  replyCount
  articleReplies(status: NORMAL) {
    reply { id type text reference createdAt }
  }
`;

const SEARCH_QUERY = `query Search($text: String!, $first: Int, $after: String) {
  ListArticles(filter: { moreLikeThis: { like: $text } }, orderBy: [{ _score: DESC }], first: $first, after: $after) {
    totalCount
    edges { cursor node { ${ARTICLE_FIELDS} } }
  }
}`;

const GET_QUERY = `query Get($id: String!) { GetArticle(id: $id) { ${ARTICLE_FIELDS} } }`;

interface CofactsArticle {
  id: string;
  text: string | null;
  createdAt: string | null;
  replyCount: number | null;
  articleReplies: Array<{ reply: { id: string; type: string; text: string | null; reference: string | null } | null }> | null;
}

async function graphql<T>(query: string, variables: Record<string, unknown>, ctx: AdapterContext): Promise<T> {
  const appId = ctx.env.COFACTS_APP_ID;
  if (!appId) throw new ProviderError("not_configured", "Set COFACTS_APP_ID (issued by the Cofacts working group).");
  const response = await fetchWithTimeout(ctx, ctx.env.COFACTS_ENDPOINT ?? DEFAULT_ENDPOINT, {
    method: "POST",
    headers: {
      "content-type": "application/json",
      [ctx.env.COFACTS_APP_ID_HEADER ?? "x-app-id"]: appId,
    },
    body: JSON.stringify({ query, variables }),
  });
  checkStatus(response);
  let body: { data?: T; errors?: Array<{ message?: string }> };
  try {
    body = (await response.json()) as typeof body;
  } catch {
    throw new ProviderError("bad_response", "Response was not JSON");
  }
  if (body.errors?.length) throw new ProviderError("bad_response", `GraphQL error: ${body.errors[0]?.message ?? "unknown"}`);
  if (!body.data) throw new ProviderError("bad_response", "Response had no data");
  return body.data;
}

function toItem(article: CofactsArticle, ctx: AdapterContext): ResourceItem {
  if (!article || typeof article.id !== "string") throw new ProviderError("bad_response", "Article without an id");
  const replies = (article.articleReplies ?? []).map((entry) => entry?.reply).filter((reply) => reply != null);
  return {
    provider: "Cofacts",
    source_id: "cofacts-graphql",
    original_id: article.id,
    original_url: `https://cofacts.tw/article/${encodeURIComponent(article.id)}`,
    title: excerpt(article.text, 120),
    excerpt: excerpt(replies[0]?.text ?? article.text),
    published_at: article.createdAt ?? null,
    retrieved_at: ctx.now().toISOString(),
    language: "zh-TW",
    method: "Crowd-sourced fact-check replies",
    original_labels: [...new Set(replies.map((reply) => reply.type))],
    attribution: ATTRIBUTION,
    untrusted: true,
  };
}

export const cofactsAdapter: Adapter = {
  sourceId: "cofacts-graphql",
  requiredEnv: ["COFACTS_APP_ID"],
  capabilities: ["search", "get"],

  async search(query, { limit, cursor }, ctx) {
    const data = await graphql<{
      ListArticles: { totalCount: number | null; edges: Array<{ cursor: string; node: CofactsArticle }> } | null;
    }>(SEARCH_QUERY, { text: query, first: limit, after: cursor ?? null }, ctx);
    const list = data.ListArticles;
    if (!list || !Array.isArray(list.edges)) throw new ProviderError("bad_response", "ListArticles missing edges");
    const items = list.edges.map((edge) => toItem(edge.node, ctx));
    return {
      items,
      total: typeof list.totalCount === "number" ? list.totalCount : null,
      next_cursor: list.edges.length === limit ? (list.edges.at(-1)?.cursor ?? null) : null,
    };
  },

  async get(id, ctx) {
    const data = await graphql<{ GetArticle: CofactsArticle | null }>(GET_QUERY, { id }, ctx);
    if (!data.GetArticle) throw new ProviderError("not_found", `No Cofacts article ${id}`);
    return toItem(data.GetArticle, ctx);
  },
};
