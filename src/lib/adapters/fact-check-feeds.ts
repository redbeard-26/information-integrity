import { type FeedSpec, makeFeedAdapter } from "@/lib/adapters/feeds";

/**
 * Fact-checkers' own public feeds, each confirmed on 2026-11-15 to serve RSS or Atom with current items.
 * Feeds cover recent publications only. Items are fetched per request and kept in memory for ten minutes;
 * nothing is stored. PolitiFact's feed is left out because its terms forbid redisplaying content.
 */
const linkBack = (name: string) => `Headline and link from ${name}'s public feed. Read the full fact-check on ${name}'s site.`;

export const FACT_CHECK_FEEDS: FeedSpec[] = [
  {
    sourceId: "factcheckorg-feed",
    provider: "FactCheck.org",
    feedUrl: "https://www.factcheck.org/feed/",
    language: "en",
    method: "Editorial fact-checks (Annenberg Public Policy Center)",
    attribution: { statement: "Source: FactCheck.org, a project of the Annenberg Public Policy Center. Link to the original.", license: null },
  },
  {
    sourceId: "fullfact-feed",
    provider: "Full Fact",
    feedUrl: "https://fullfact.org/feed/",
    language: "en",
    method: "Editorial fact-checks; the feed also carries other Full Fact articles",
    attribution: { statement: linkBack("Full Fact"), license: null },
    excerpts: false,
  },
  {
    sourceId: "leadstories-feed",
    provider: "Lead Stories",
    feedUrl: "https://leadstories.com/atom.xml",
    language: "en",
    method: "Editorial fact-checks",
    attribution: { statement: linkBack("Lead Stories"), license: null },
  },
  {
    sourceId: "maldita-feed",
    provider: "Fundación Maldita.es",
    feedUrl: "https://maldita.es/malditobulo/feed/",
    language: "es",
    method: "Editorial hoax debunks (Maldito Bulo section)",
    attribution: { statement: linkBack("Maldita.es"), license: null },
  },
  {
    sourceId: "altnews-feed",
    provider: "Alt News",
    feedUrl: "https://www.altnews.in/feed/",
    language: "en",
    method: "Editorial fact-checks",
    attribution: { statement: linkBack("Alt News"), license: null },
  },
  {
    sourceId: "boom-feed",
    provider: "BOOM",
    feedUrl: "https://www.boomlive.in/google_feeds.xml",
    language: "en",
    method: "Editorial fact-checks (short feed of the latest items)",
    attribution: { statement: linkBack("BOOM"), license: null },
  },
  {
    sourceId: "aosfatos-feed",
    provider: "Aos Fatos",
    feedUrl: "https://www.aosfatos.org/noticias/feed/",
    language: "pt",
    method: "Editorial fact-checks",
    attribution: { statement: linkBack("Aos Fatos"), license: null },
  },
  {
    sourceId: "stopfake-feed",
    provider: "StopFake",
    feedUrl: "https://www.stopfake.org/en/feed/",
    language: "en",
    method: "Editorial debunks of Kremlin-linked disinformation; the feed also carries organisation news",
    attribution: { statement: linkBack("StopFake"), license: null },
  },
  {
    sourceId: "dubawa-feed",
    provider: "DUBAWA",
    feedUrl: "https://dubawa.org/feed/",
    language: "en",
    method: "Editorial fact-checks; the feed also carries weekly round-ups",
    attribution: { statement: linkBack("DUBAWA"), license: null },
  },
];

export const FACT_CHECK_FEED_ADAPTERS = Object.fromEntries(FACT_CHECK_FEEDS.map((spec) => [spec.sourceId, makeFeedAdapter(spec)]));
