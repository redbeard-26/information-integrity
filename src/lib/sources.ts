import registry from "@/data/sources.json";
import { cofactsAdapter } from "@/lib/adapters/cofacts";
import { type Adapter, type AdapterContext, ProviderError, type ResourceItem } from "@/lib/adapters/types";
import { DIRECTORY, type Organization, normalize } from "@/lib/directory";

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
}

export const SOURCE_REGISTRY = registry as { version: string; basis: string; status_order: string[]; sources: Source[] };

export const ADAPTERS: Record<string, Adapter> = { cofacts: cofactsAdapter };

export function defaultContext(): AdapterContext {
  return { fetch: globalThis.fetch.bind(globalThis), env: process.env, now: () => new Date(), timeoutMs: 10_000 };
}

/** Directory records whose name matches one of the source's organization names. */
export function linkedRecords(source: Source, records: Organization[] = DIRECTORY.records) {
  const names = new Set(source.organizations.map(normalize));
  return records.filter((record) => names.has(normalize(record.name))).map((record) => ({ id: record.id, name: record.name }));
}

function adapterState(source: Source, ctx: AdapterContext) {
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
    directory_records: linkedRecords(source),
    operations: adapter?.capabilities ?? [],
    ...adapterState(source, ctx),
  };
}

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
  options: { sources?: string[]; limit?: number; cursor?: string },
  ctx: AdapterContext = defaultContext(),
) {
  const limit = Math.min(Math.max(options.limit ?? 10, 1), 50);
  const candidates = SOURCE_REGISTRY.sources.filter(
    (source) => source.adapter && (!options.sources?.length || options.sources.includes(source.id)),
  );
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
        const page = await adapter.search(query, { limit, cursor: options.cursor }, ctx);
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
    items,
    providers: providers.sort((a, b) => a.source_id.localeCompare(b.source_id)),
    coverage_note:
      "Only sources with a connected adapter are searched. A provider error means the source was not checked, not that it has nothing relevant.",
  };
}

export async function getResource(sourceId: string, id: string, ctx: AdapterContext = defaultContext()) {
  const source = SOURCE_REGISTRY.sources.find((item) => item.id === sourceId);
  if (!source) throw new ProviderError("not_found", `Unknown source '${sourceId}'`);
  const adapter = source.adapter ? ADAPTERS[source.adapter] : undefined;
  if (!adapter || !adapter.capabilities.includes("get")) {
    throw new ProviderError("not_configured", `Source '${sourceId}' has no retrieval adapter yet`);
  }
  return adapter.get(id, ctx);
}
