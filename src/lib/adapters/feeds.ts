import {
  type Adapter,
  type AdapterContext,
  ProviderError,
  type ResourceItem,
  checkStatus,
  excerpt,
  fetchWithTimeout,
  safeUrl,
} from "@/lib/adapters/types";

/**
 * Adapter for a provider's own published RSS or Atom feed. A feed holds only the provider's most
 * recent items, so a search here covers recent publications, not the provider's whole archive.
 * Only headline, link, date and a short excerpt are returned; the full article stays on the provider's site.
 */
export interface FeedSpec {
  sourceId: string;
  provider: string;
  feedUrl: string;
  language: string | null;
  method: string;
  attribution: { statement: string; license: string | null };
  /** False when the provider's terms ask for full, unmodified republication: then only headline, link and date are returned. */
  excerpts?: boolean;
}

export interface FeedEntry {
  id: string;
  link: string | null;
  title: string | null;
  summary: string | null;
  published: string | null;
  categories: string[];
}

const ENTITIES: Record<string, string> = { amp: "&", lt: "<", gt: ">", quot: '"', apos: "'", nbsp: " " };

export function decodeText(raw: string): string {
  return raw
    .replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")
    .replace(/<[^>]*>/g, " ")
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    .replace(/\s+/g, " ")
    .trim();
}

function tag(block: string, names: string[]): string | null {
  for (const name of names) {
    const match = block.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"));
    if (match) {
      const text = decodeText(match[1]);
      if (text) return text;
    }
  }
  return null;
}

function allTags(block: string, name: string): string[] {
  return [...block.matchAll(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "gi"))]
    .map((match) => decodeText(match[1]))
    .filter(Boolean);
}

function atomLink(block: string): string | null {
  const links = [...block.matchAll(/<link\b([^>]*)\/?>/gi)].map((match) => match[1]);
  const preferred = links.find((attrs) => !/rel=["'](?!alternate)/i.test(attrs)) ?? links[0];
  const href = preferred?.match(/href=["']([^"']+)["']/i)?.[1];
  return href ? safeUrl(decodeText(href)) : null;
}

function toIso(value: string | null): string | null {
  if (!value) return null;
  const time = Date.parse(value);
  return Number.isNaN(time) ? null : new Date(time).toISOString();
}

/** Parses RSS 2.0, RSS 1.0 (RDF) and Atom. Throws bad_response when the body is not a feed. */
export function parseFeed(xml: string): FeedEntry[] {
  if (!/<(rss|feed|rdf:RDF)\b/i.test(xml)) throw new ProviderError("bad_response", "Response was not an RSS or Atom feed");
  const blocks = [...xml.matchAll(/<(item|entry)\b[^>]*>([\s\S]*?)<\/\1>/gi)].map((match) => match[2]);
  return blocks.map((block) => {
    const link = safeUrl(tag(block, ["link"])) ?? atomLink(block);
    const id = tag(block, ["guid", "id"]) ?? link;
    return {
      id: id ?? "",
      link,
      title: tag(block, ["title"]),
      summary: tag(block, ["description", "summary", "content:encoded", "content"]),
      published: toIso(tag(block, ["pubDate", "published", "updated", "dc:date"])),
      categories: allTags(block, "category"),
    };
  }).filter((entry) => entry.id);
}

const CACHE_TTL_MS = 10 * 60 * 1000;
const cache = new Map<string, { at: number; entries: FeedEntry[] }>();

export function clearFeedCache() {
  cache.clear();
}

async function loadFeed(spec: FeedSpec, ctx: AdapterContext): Promise<FeedEntry[]> {
  const cached = cache.get(spec.feedUrl);
  const now = ctx.now().getTime();
  if (cached && now - cached.at < CACHE_TTL_MS) return cached.entries;
  const response = await fetchWithTimeout(ctx, spec.feedUrl, {
    headers: { accept: "application/rss+xml, application/atom+xml, application/xml, text/xml" },
  });
  checkStatus(response);
  const entries = parseFeed(await response.text());
  cache.set(spec.feedUrl, { at: now, entries });
  return entries;
}

/** Lower-cased search terms. Words of two letters or fewer are ignored unless the query has no others. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const long = words.filter((word) => word.length > 2 || /[^\u0000-ɏ]/.test(word));
  return [...new Set(long.length ? long : words)];
}

export function matchScore(entry: FeedEntry, terms: string[]): number {
  const haystack = `${entry.title ?? ""} ${entry.summary ?? ""} ${entry.categories.join(" ")}`.toLowerCase().normalize("NFKC");
  return terms.filter((term) => haystack.includes(term)).length;
}

export function makeFeedAdapter(spec: FeedSpec): Adapter {
  const toItem = (entry: FeedEntry, ctx: AdapterContext): ResourceItem => ({
    provider: spec.provider,
    source_id: spec.sourceId,
    original_id: entry.id,
    original_url: entry.link,
    title: excerpt(entry.title, 200),
    excerpt: spec.excerpts === false ? null : excerpt(entry.summary, 300),
    published_at: entry.published,
    retrieved_at: ctx.now().toISOString(),
    language: spec.language,
    method: spec.method,
    original_labels: entry.categories.slice(0, 10),
    attribution: spec.attribution,
    untrusted: true,
  });

  return {
    sourceId: spec.sourceId,
    requiredEnv: [],
    capabilities: ["search", "get"],

    async search(query, { limit, cursor }, ctx) {
      const terms = queryTerms(query);
      const entries = await loadFeed(spec, ctx);
      const ranked = entries
        .map((entry) => ({ entry, score: matchScore(entry, terms) }))
        .filter((hit) => hit.score > 0)
        .sort((a, b) => b.score - a.score || (b.entry.published ?? "").localeCompare(a.entry.published ?? ""));
      const offset = Math.max(Number(cursor ?? 0) || 0, 0);
      const page = ranked.slice(offset, offset + limit);
      return {
        items: page.map((hit) => toItem(hit.entry, ctx)),
        total: ranked.length,
        next_cursor: offset + limit < ranked.length ? String(offset + limit) : null,
      };
    },

    async get(id, ctx) {
      const entry = (await loadFeed(spec, ctx)).find((item) => item.id === id || item.link === id);
      if (!entry) throw new ProviderError("not_found", `Item is not in ${spec.provider}'s current feed`);
      return toItem(entry, ctx);
    },
  };
}
