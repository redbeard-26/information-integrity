import registry from "@/data/sources.json";
import { ADAPTERS } from "@/lib/adapters";
import { type AdapterContext, type AnalyzeInput, ProviderError, type ResourceItem } from "@/lib/adapters/types";
import { DIRECTORY, type Organization, normalize } from "@/lib/directory";
import { type RankingScores, CRITERIA, overallScore, rankOrder } from "@/lib/ranking";
import { type RequestType, type SourceFit, REQUEST_TYPES, classifyRequest, scoreCandidates } from "@/lib/recommend";

export { ADAPTERS };

export interface SmokeTest {
  date: string;
  mode: string;
  operation: string;
  result: string;
}

export interface Source {
  id: string;
  offering: string;
  organizations: string[];
  interface: "api" | "mcp" | "download" | "feed";
  protocol: string;
  endpoint: string | null;
  evidence_urls: string[];
  access: string;
  auth_model: string;
  cost: string;
  scope: string;
  languages: string[];
  rights: string;
  status: string;
  adapter: string | null;
  last_checked: string;
  notes: string | null;
  fit: SourceFit;
  ranking: RankingScores;
  smoke_tests: SmokeTest[];
}

export const SOURCE_REGISTRY = registry as unknown as { version: string; basis: string; status_order: string[]; sources: Source[] };

export function defaultContext(): AdapterContext {
  return { fetch: globalThis.fetch.bind(globalThis), env: process.env, now: () => new Date(), timeoutMs: 10_000 };
}

/** Directory records whose name matches one of the source's organization names. */
export function linkedRecords(source: Source, records: Organization[] = DIRECTORY.records) {
  const names = new Set(source.organizations.map(normalize));
  return records.filter((record) => names.has(normalize(record.name))).map((record) => ({ id: record.id, name: record.name }));
}

export function adapterState(source: Source, ctx: AdapterContext) {
  const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
  if (!adapter) return { connected: false, reason: "no adapter yet" };
  const missing = adapter.requiredEnv.filter((name) => !ctx.env[name]);
  return missing.length
    ? { connected: false, reason: `missing configuration: ${missing.join(", ")}` }
    : { connected: true, reason: null };
}

export function listSources(filters: { interface?: string; status?: string }, ctx: AdapterContext = defaultContext()) {
  const sources = SOURCE_REGISTRY.sources.filter(
    (source) =>
      (!filters.interface || source.interface === filters.interface) && (!filters.status || source.status === filters.status),
  );
  return {
    registry_version: SOURCE_REGISTRY.version,
    basis: SOURCE_REGISTRY.basis,
    total: sources.length,
    sources: sources.map((source) => ({
      id: source.id,
      offering: source.offering,
      organizations: source.organizations,
      interface: source.interface,
      status: source.status,
      access: source.access,
      overall_score: overallScore(source.ranking),
      operations: source.adapter ? (ADAPTERS[source.adapter]?.capabilities ?? []) : [],
      ...adapterState(source, ctx),
    })),
  };
}

export function sourceCapabilities(id: string, ctx: AdapterContext = defaultContext()) {
  const source = SOURCE_REGISTRY.sources.find((item) => item.id === id);
  if (!source) return null;
  const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
  return {
    ...source,
    overall_score: overallScore(source.ranking),
    rank: rankOrder(SOURCE_REGISTRY.sources).find((entry) => entry.source.id === id)?.rank ?? null,
    directory_records: linkedRecords(source),
    operations: adapter?.capabilities ?? [],
    configuration: adapter ? { required: adapter.requiredEnv, optional: adapter.optionalEnv ?? [] } : null,
    ...adapterState(source, ctx),
  };
}

/** All sources in rank order with their criterion scores and reasons. */
export function rankSources(ctx: AdapterContext = defaultContext()) {
  return {
    registry_version: SOURCE_REGISTRY.version,
    criteria: Object.fromEntries(Object.entries(CRITERIA).map(([name, spec]) => [name, { weight: spec.weight, question: spec.question, scale: spec.scale }])),
    sources: rankOrder(SOURCE_REGISTRY.sources).map(({ source, score, rank }) => ({
      rank,
      id: source.id,
      offering: source.offering,
      overall_score: score,
      scores: Object.fromEntries(Object.entries(source.ranking).map(([name, entry]) => [name, entry.score])),
      reasons: Object.fromEntries(Object.entries(source.ranking).map(([name, entry]) => [name, entry.reason])),
      ...adapterState(source, ctx),
    })),
  };
}

export interface RecommendOptions {
  request_type?: RequestType;
  region?: string;
  language?: string;
  max_sources?: number;
  /** Also recommend sources this server cannot query yet (default false). */
  include_unconnected?: boolean;
  /** Only sources whose adapter supports this operation. */
  operation?: "search" | "analyze";
}

/** Classifies a request and returns the few sources to query for it, with the reason for each. */
export function recommendSources(request: string, options: RecommendOptions = {}, ctx: AdapterContext = defaultContext()) {
  const classification = classifyRequest(request, options);
  const max = Math.min(Math.max(options.max_sources ?? 3, 1), 10);
  const candidates = SOURCE_REGISTRY.sources
    .filter((source) => {
      if (!options.operation) return true;
      const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
      return adapter?.capabilities.includes(options.operation) ?? false;
    })
    .map((source) => ({
      id: source.id,
      offering: source.offering,
      fit: source.fit,
      overall_score: overallScore(source.ranking),
      connected: adapterState(source, ctx).connected,
      status: source.status,
    }));
  const scored = scoreCandidates(classification, candidates);
  const eligible = options.include_unconnected ? scored : scored.filter((entry) => entry.connected);
  const recommended = eligible.slice(0, max).map((entry) => {
    const source = SOURCE_REGISTRY.sources.find((item) => item.id === entry.source_id) as Source;
    const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
    return {
      ...entry,
      operations: adapter?.capabilities ?? [],
      ...(entry.connected ? {} : { needs: adapterState(source, ctx).reason }),
    };
  });
  const notConnected = options.include_unconnected
    ? []
    : scored
        .filter((entry) => !entry.connected)
        .slice(0, 3)
        .map((entry) => ({ source_id: entry.source_id, points: entry.points, needs: adapterState(SOURCE_REGISTRY.sources.find((item) => item.id === entry.source_id) as Source, ctx).reason }));
  return {
    request,
    classification,
    recommended,
    better_sources_not_connected: notConnected.filter((entry) => recommended.length === 0 || entry.points > recommended[recommended.length - 1].points),
    note:
      recommended.length === 0
        ? "No connected source fits this request. Configure one of the sources listed, or use search_organizations to find organizations that work on it."
        : "Query only these sources first. Results are each provider's own labels, not a verdict from this server.",
  };
}

export const REQUEST_TYPE_LABELS = Object.fromEntries(Object.entries(REQUEST_TYPES).map(([name, spec]) => [name, spec.label]));

export interface ProviderOutcome {
  source_id: string;
  status: "ok" | "error" | "skipped";
  error?: { code: string; message: string };
  count?: number;
  next_cursor?: string | null;
}

/** Searches connected sources. Each provider's failure is reported separately, never folded into "no results". */
export async function searchResources(
  query: string,
  options: { sources?: string[]; limit?: number; cursor?: string; max_sources?: number; request_type?: RequestType },
  ctx: AdapterContext = defaultContext(),
) {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  // With max_sources and no explicit list, only the recommended connected sources are queried.
  const selection =
    !options.sources?.length && options.max_sources
      ? recommendSources(query, { max_sources: options.max_sources, request_type: options.request_type, operation: "search" }, ctx)
      : null;
  const wanted = selection ? selection.recommended.map((entry) => entry.source_id) : options.sources;
  const candidates = SOURCE_REGISTRY.sources.filter((source) => {
    const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
    return adapter?.search && (!wanted?.length || wanted.includes(source.id));
  });
  const unknown = (options.sources ?? []).filter((id) => !SOURCE_REGISTRY.sources.some((source) => source.id === id));
  const items: ResourceItem[] = [];
  const providers: ProviderOutcome[] = unknown.map((id) => ({
    source_id: id,
    status: "skipped",
    error: { code: "not_found", message: "Unknown source id" },
  }));

  await Promise.all(
    candidates.map(async (source) => {
      const adapter = ADAPTERS[source.adapter as string];
      try {
        const page = await adapter.search!(query, { limit, cursor: options.cursor }, ctx);
        items.push(...page.items);
        providers.push({ source_id: source.id, status: "ok", count: page.items.length, next_cursor: page.next_cursor });
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        providers.push({
          source_id: source.id,
          status: code === "not_configured" ? "skipped" : "error",
          error: { code, message: (error as Error).message },
        });
      }
    }),
  );

  return {
    query,
    ...(selection
      ? { selected_sources: selection.recommended.map(({ source_id, points, reasons }) => ({ source_id, points, reasons })), classification: selection.classification }
      : {}),
    items,
    providers: providers.sort((a, b) => a.source_id.localeCompare(b.source_id)),
    coverage_note: selection
      ? `Only the ${selection.recommended.length} recommended connected source(s) were searched. A provider error means the source was not checked, not that it has nothing relevant.`
      : "Only sources with a connected adapter are searched. A provider error means the source was not checked, not that it has nothing relevant.",
  };
}

/** Sends one piece of content to one named detection or fact-check provider. Never fans out. */
export async function analyzeContent(sourceId: string, input: AnalyzeInput, ctx: AdapterContext = defaultContext()) {
  const source = SOURCE_REGISTRY.sources.find((item) => item.id === sourceId);
  if (!source) throw new ProviderError("not_found", `Unknown source '${sourceId}'`);
  const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
  if (!adapter?.analyze) throw new ProviderError("not_configured", `Source '${sourceId}' does not analyze content`);
  return adapter.analyze(input, ctx);
}

export async function getResource(sourceId: string, id: string, ctx: AdapterContext = defaultContext()) {
  const source = SOURCE_REGISTRY.sources.find((item) => item.id === sourceId);
  if (!source) throw new ProviderError("not_found", `Unknown source '${sourceId}'`);
  const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
  if (!adapter?.get) {
    throw new ProviderError("not_configured", `Source '${sourceId}' has no retrieval adapter yet`);
  }
  return adapter.get(id, ctx);
}
