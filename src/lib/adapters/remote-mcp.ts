import { callRemoteTool } from "@/lib/adapters/mcp-client";
import {
  type Adapter,
  type AdapterContext,
  ProviderError,
  type ResourceItem,
  excerpt,
  safeUrl,
} from "@/lib/adapters/types";

/**
 * Adapter for a provider's own MCP server. The provider's tool answers are free-form, so items are
 * mapped from common field names when the answer is JSON and otherwise returned as text excerpts.
 *
 * Environment (PREFIX is the spec's envPrefix):
 *   PREFIX_MCP_URL      MCP endpoint (defaults to the documented endpoint, when there is one)
 *   PREFIX_API_KEY      credential, sent as "Authorization: Bearer <key>" unless PREFIX_AUTH_HEADER names another header
 *   PREFIX_AUTH_HEADER  optional header name for the key (the raw key is sent when this is set)
 *   PREFIX_SEARCH_TOOL  provider tool used for search_resources (defaults to the documented tool, when known)
 *   PREFIX_QUERY_ARG    argument name for the query (default "query")
 */
export interface RemoteMcpSpec {
  sourceId: string;
  provider: string;
  envPrefix: string;
  defaultUrl: string | null;
  keyRequired: boolean;
  defaultSearchTool: string | null;
  defaultQueryArg?: string;
  /** Extra fixed arguments sent with every search call. */
  extraArgs?: Record<string, unknown>;
  method: string;
  attribution: { statement: string; license: string | null };
}

const TITLE_KEYS = ["title", "headline", "name", "claim", "claim_text"];
const URL_KEYS = ["url", "link", "source_url", "permalink", "article_url"];
const TEXT_KEYS = ["summary", "description", "snippet", "text", "content", "explanation"];
const DATE_KEYS = ["published_at", "publishedAt", "date", "created_at", "createdAt", "timestamp"];
const LABEL_KEYS = ["label", "rating", "verdict", "textualRating", "stance", "status", "classification"];
const ID_KEYS = ["id", "uuid", "_id", "key"];

function pick(record: Record<string, unknown>, keys: string[]): unknown {
  for (const key of keys) if (record[key] != null && record[key] !== "") return record[key];
  return null;
}

function records(value: unknown): Array<Record<string, unknown>> {
  if (Array.isArray(value)) return value.filter((entry) => entry && typeof entry === "object") as Array<Record<string, unknown>>;
  if (value && typeof value === "object") {
    for (const key of ["results", "items", "data", "hits", "articles", "claims", "narratives"]) {
      const nested = (value as Record<string, unknown>)[key];
      if (Array.isArray(nested)) return records(nested);
    }
    return [value as Record<string, unknown>];
  }
  return [];
}

export function mapToolOutput(
  output: { texts: string[]; structured: unknown },
  spec: RemoteMcpSpec,
  ctx: AdapterContext,
  limit: number,
): ResourceItem[] {
  const parsed: Array<Record<string, unknown>> = [];
  const loose: string[] = [];
  if (output.structured) parsed.push(...records(output.structured));
  else {
    for (const text of output.texts) {
      try {
        parsed.push(...records(JSON.parse(text)));
      } catch {
        loose.push(text);
      }
    }
  }
  const base = {
    provider: spec.provider,
    source_id: spec.sourceId,
    retrieved_at: ctx.now().toISOString(),
    language: null,
    method: spec.method,
    attribution: spec.attribution,
    untrusted: true as const,
  };
  const items: ResourceItem[] = parsed.map((record, index) => {
    const label = pick(record, LABEL_KEYS);
    const date = pick(record, DATE_KEYS);
    return {
      ...base,
      original_id: String(pick(record, ID_KEYS) ?? pick(record, URL_KEYS) ?? index),
      original_url: safeUrl(pick(record, URL_KEYS)),
      title: excerpt(pick(record, TITLE_KEYS), 200),
      excerpt: excerpt(pick(record, TEXT_KEYS) ?? JSON.stringify(record), 500),
      published_at: typeof date === "string" ? date : null,
      original_labels: label == null ? [] : [String(label)],
    };
  });
  loose.forEach((text, index) =>
    items.push({ ...base, original_id: `text-${index}`, original_url: null, title: null, excerpt: excerpt(text, 1500), published_at: null, original_labels: [] }),
  );
  return items.slice(0, limit);
}

export function makeRemoteMcpAdapter(spec: RemoteMcpSpec): Adapter {
  const env = (suffix: string) => `${spec.envPrefix}_${suffix}`;
  const requiredEnv = [
    ...(spec.defaultUrl ? [] : [env("MCP_URL")]),
    ...(spec.keyRequired ? [env("API_KEY")] : []),
    ...(spec.defaultSearchTool ? [] : [env("SEARCH_TOOL")]),
  ];
  const optionalEnv = [env("MCP_URL"), env("API_KEY"), env("AUTH_HEADER"), env("SEARCH_TOOL"), env("QUERY_ARG")].filter(
    (name) => !requiredEnv.includes(name),
  );

  function connection(ctx: AdapterContext) {
    const missing = requiredEnv.filter((name) => !ctx.env[name]);
    if (missing.length) throw new ProviderError("not_configured", `Set ${missing.join(", ")} for ${spec.provider}.`);
    const url = safeUrl(ctx.env[env("MCP_URL")] ?? spec.defaultUrl);
    if (!url) throw new ProviderError("not_configured", `${env("MCP_URL")} is not an http(s) URL.`);
    const key = ctx.env[env("API_KEY")];
    const header = ctx.env[env("AUTH_HEADER")];
    const headers: Record<string, string> = key ? (header ? { [header]: key } : { authorization: `Bearer ${key}` }) : {};
    return { url, headers };
  }

  return {
    sourceId: spec.sourceId,
    requiredEnv,
    optionalEnv,
    capabilities: ["search"],
    async search(query, { limit }, ctx) {
      const conn = connection(ctx);
      const tool = ctx.env[env("SEARCH_TOOL")] ?? (spec.defaultSearchTool as string);
      const arg = ctx.env[env("QUERY_ARG")] ?? spec.defaultQueryArg ?? "query";
      const output = await callRemoteTool(ctx, conn, tool, { ...(spec.extraArgs ?? {}), [arg]: query });
      const items = mapToolOutput(output, spec, ctx, limit);
      return { items, total: null, next_cursor: null };
    },
  };
}
