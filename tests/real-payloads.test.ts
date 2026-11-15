import { readFileSync } from "node:fs";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { FACT_CHECK_FEEDS, FACT_CHECK_FEED_ADAPTERS } from "@/lib/adapters/fact-check-feeds";
import { clearFeedCache, parseFeed } from "@/lib/adapters/feeds";
import { faraAdapter, resetFaraState } from "@/lib/adapters/fara";
import { ctx, json, router, text } from "./helpers";

// Payloads captured from each provider on 2026-11-15 (long article bodies trimmed; see fixtures/real/README.md).
const fixture = (name: string) => readFileSync(join(__dirname, "fixtures", "real", name), "utf8");

const CASES: Array<{ source: string; file: string; query: string; minEntries: number; first: RegExp }> = [
  { source: "factcheckorg-feed", file: "factcheck.xml", query: "COVID vaccine study", minEntries: 1, first: /Surgeon General/ },
  { source: "fullfact-feed", file: "fullfact.xml", query: "NHS waiting lists", minEntries: 10, first: /NHS waiting lists/ },
  { source: "leadstories-feed", file: "leadstories.xml", query: "AI video", minEntries: 3, first: /AI/ },
  { source: "maldita-feed", file: "maldita.xml", query: "vídeo IA", minEntries: 6, first: /IA/ },
  { source: "altnews-feed", file: "altnews.xml", query: "doctored AI video", minEntries: 3, first: /doctored with AI/ },
  { source: "boom-feed", file: "boom.xml", query: "deepfake army", minEntries: 4, first: /Deepfakes/ },
  { source: "aosfatos-feed", file: "aosfatos.xml", query: "INSS aposentados", minEntries: 6, first: /INSS/ },
  { source: "stopfake-feed", file: "stopfake.xml", query: "Zelensky fake", minEntries: 10, first: /Zelensky/ },
  { source: "dubawa-feed", file: "dubawa.xml", query: "term limits", minEntries: 10, first: /Barrow/ },
];

beforeEach(() => {
  clearFeedCache();
  resetFaraState();
});

describe("adapters on real provider payloads", () => {
  for (const { source, file, query, minEntries, first } of CASES) {
    it(`${source}: parses the live feed and answers "${query}"`, async () => {
      const spec = FACT_CHECK_FEEDS.find((entry) => entry.sourceId === source)!;
      const body = fixture(file);
      const entries = parseFeed(body);
      expect(entries.length).toBeGreaterThanOrEqual(minEntries);
      for (const entry of entries) {
        expect(entry.title).toBeTruthy();
        expect(entry.link).toMatch(/^https:\/\//);
        expect(entry.published).toMatch(/^2026-/);
        const shown = `${entry.title} ${entry.summary ?? ""}`;
        expect(shown).not.toMatch(/<\/?[a-z]+[\s>]/i); // no leftover markup
        expect(shown).not.toMatch(/â€|Ã[\u0080-\u00bf]/); // no double-encoded text
      }
      const { impl } = router([[spec.feedUrl, () => text(body)]]);
      const page = await FACT_CHECK_FEED_ADAPTERS[source].search!(query, { limit: 3 }, ctx(impl));
      expect(page.total).toBeGreaterThan(0);
      expect(page.items[0].title).toMatch(first);
    });
  }

  it("reads Atom category terms (Lead Stories) and splits comma lists (BOOM)", () => {
    expect(parseFeed(fixture("leadstories.xml"))[0].categories.length).toBeGreaterThan(0);
    expect(parseFeed(fixture("boom.xml"))[0].categories).toEqual(["Fact Check", "Top Stories"]);
  });

  it("repairs DUBAWA's double-encoded text", () => {
    const titles = parseFeed(fixture("dubawa.xml")).map((entry) => entry.title).join(" ");
    expect(titles).toContain("videos… top claims");
    expect(titles).toContain("Barrow’s claim");
  });

  it("FARA: finds a registrant and names its foreign principal from the live field names", async () => {
    const { impl } = router([
      ["/Registrants/json/Active", () => json(JSON.parse(fixture("fara-registrants.json")))],
      ["/ForeignPrincipals/json/Active/7519", () => json(JSON.parse(fixture("fara-principals.json")))],
    ]);
    const page = await faraAdapter.search!("Who is QatarEnergy lobbying for in the United States?", { limit: 5 }, ctx(impl));
    expect(page.items[0]).toMatchObject({ original_id: "7519", title: "QatarEnergy U.S. Holding Corporation, Inc.", published_at: "2025-01-16" });
    const item = await faraAdapter.get!("7519", ctx(impl));
    expect(item.excerpt).toContain("Foreign principals: QatarEnergy (QATAR).");
  });

  it("a whole question needs two matching words, so one common word is not a hit", async () => {
    const spec = FACT_CHECK_FEEDS.find((entry) => entry.sourceId === "factcheckorg-feed")!;
    const { impl } = router([[spec.feedUrl, () => text(fixture("factcheck.xml"))]]);
    const page = await FACT_CHECK_FEED_ADAPTERS["factcheckorg-feed"].search!("Is it true that people on NHS waiting lists are not able to work?", { limit: 3 }, ctx(impl));
    expect(page.total).toBe(0);
  });
});
