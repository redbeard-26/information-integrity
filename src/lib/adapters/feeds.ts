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

const MARKUP = /<\/?[a-z][a-z0-9:-]*(?:\s[^<>]*)?\/?>/gi;

// Windows-1252 bytes 0x80-0x9F; the five undefined ones map to themselves.
const CP1252 = "\u20ac\u0081\u201a\u0192\u201e\u2026\u2020\u2021\u02c6\u2030\u0160\u2039\u0152\u008d\u017d\u008f\u0090\u2018\u2019\u201c\u201d\u2022\u2013\u2014\u02dc\u2122\u0161\u203a\u0153\u009d\u017e\u0178";
const MOJIBAKE = /[\u00c2-\u00c6\u00e2][\u0080-\u00bf\u0152\u0153\u0160\u0161\u0178\u017d\u017e\u0192\u02c6\u02dc\u2013-\u2122]/;

/**
 * Some feeds (DUBAWA's, for one) publish UTF-8 text that was decoded as Windows-1252 and re-encoded,
 * so "’" arrives as "â€™". When a field looks like that and maps back to valid UTF-8, the original text is restored.
 */
export function repairMojibake(text: string): string {
  if (!MOJIBAKE.test(text)) return text;
  const bytes: number[] = [];
  for (const char of text) {
    const code = char.codePointAt(0)!;
    if (code < 0x80 || (code >= 0xa0 && code <= 0xff)) bytes.push(code);
    else {
      const index = CP1252.indexOf(char);
      if (index < 0) return text;
      bytes.push(0x80 + index);
    }
  }
  try {
    return new TextDecoder("utf-8", { fatal: true }).decode(new Uint8Array(bytes));
  } catch {
    return text;
  }
}

export function decodeText(raw: string): string {
  // Mojibake is repaired before entities are decoded, so a correct "&#8230;" cannot spoil the repair.
  const stripped = repairMojibake(raw.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1").replace(/<[^>]*>/g, " "));
  return stripped
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => String.fromCodePoint(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => String.fromCodePoint(Number(dec)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match)
    // Entity-escaped HTML (Aos Fatos sends <p> as &lt;p&gt;) only becomes markup after decoding.
    .replace(MARKUP, " ")
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

/** RSS <category>text</category>, Atom <category term="..."/>, and BOOM's "Fact Check,Top Stories" lists. */
function categories(block: string): string[] {
  const atom = [...block.matchAll(/<category\b[^>]*\bterm=["']([^"']+)["'][^>]*>/gi)].map((match) => decodeText(match[1]));
  const values = [...allTags(block, "category"), ...atom].flatMap((value) => value.split(",")).map((value) => value.trim());
  return [...new Set(values.filter(Boolean))];
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
      categories: categories(block),
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

// Function words that say nothing about the subject (English, Spanish, Portuguese). Words of two letters or fewer are dropped anyway.
const STOPWORDS = new Set(
  (
    "the and for are was were this that these those with from have has had not but what which who whom whose why how when where " +
    "does did its they them their there been being into about than then any all can could would should will our your you his her she him " +
    "los las del que por con una para como esta este son fue " +
    "não com uma dos das pelo pela"
  ).split(" "),
);

/** Lower-cased search terms: function words are dropped, and so are words of two letters or fewer unless the query has no others. */
export function queryTerms(query: string): string[] {
  const words = query.toLowerCase().normalize("NFKC").split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const long = words.filter((word) => (word.length > 2 || /[^\u0000-ɏ]/.test(word)) && !STOPWORDS.has(word));
  return [...new Set(long.length ? long : words)];
}

/** A query of four or more terms (a whole question, say) needs two of them to match, so one common word is not a hit. */
export function minimumMatches(terms: string[]): number {
  return terms.length >= 4 ? 2 : 1;
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
        .filter((hit) => hit.score >= minimumMatches(terms))
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
