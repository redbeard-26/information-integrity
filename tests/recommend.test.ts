import { describe, expect, it } from "vitest";
import { classifyRequest } from "@/lib/recommend";
import { recommendSources, searchResources, SOURCE_REGISTRY } from "@/lib/sources";
import { ctx, router, text } from "./helpers";

const keyless = ctx(router([]).impl);
const ids = (result: ReturnType<typeof recommendSources>) => result.recommended.map((entry) => entry.source_id);

describe("classifyRequest", () => {
  it("reads request type, region and language cues", () => {
    const c = classifyRequest("Is this viral photo of the Kyiv protest doctored?");
    expect(c.request_types[0].type).toBe("media_authenticity");
    expect(c.regions.map((r) => r.region)).toContain("Russia and Ukraine");
    expect(classifyRequest("這張圖是真的嗎").languages[0]).toMatchObject({ language: "zh", cues: ["(script)"] });
  });

  it("defaults to claim checking when nothing matches, and honours caller overrides", () => {
    expect(classifyRequest("tell me about this")).toMatchObject({ defaulted: true, request_types: [{ type: "claim_check" }] });
    expect(classifyRequest("anything", { request_type: "ai_text", region: "India", language: "HI" })).toMatchObject({
      request_types: [{ type: "ai_text" }],
      regions: [{ region: "India" }],
      languages: [{ language: "hi" }],
    });
  });

  it("does not match cues inside other words", () => {
    expect(classifyRequest("the eutopia of guitars").regions).toEqual([]);
    expect(classifyRequest("I trusted it").request_types.map((t) => t.type)).not.toContain("narrative_tracking");
  });
});

describe("Spanish and Portuguese requests", () => {
  it("detects the language from ¿ or ã and routes to the regional checker", () => {
    const es = recommendSources("¿Es real el vídeo hecho con IA del soldado ucraniano que llora?", {}, keyless);
    expect(es.classification.languages.map((l) => l.language)).toContain("es");
    expect(es.classification.request_types[0].type).toBe("media_authenticity");
    expect(ids(es)).toContain("maldita-feed");
    const pt = recommendSources("É verdade que o INSS vai cobrar os aposentados? Não sei.", {}, keyless);
    expect(pt.classification.languages.map((l) => l.language)).toContain("pt");
    expect(ids(pt)).toContain("aosfatos-feed");
  });
});

describe("recommendSources", () => {
  it("is deterministic", () => {
    const request = "Is the claim that the NHS waiting list doubled true?";
    expect(recommendSources(request, {}, keyless)).toEqual(recommendSources(request, {}, keyless));
  });

  it("routes a UK claim to Full Fact first", () => {
    const result = recommendSources("Is the claim that the NHS waiting list doubled in Britain true?", {}, keyless);
    expect(ids(result)[0]).toBe("fullfact-feed");
    expect(result.recommended).toHaveLength(3);
    expect(result.recommended[0].reasons.join(" ")).toMatch(/covers United Kingdom/);
  });

  it("routes an image URL to ChronoVerify, the keyless media check", () => {
    expect(ids(recommendSources("Check this image https://example.org/flood.jpg", {}, keyless))[0]).toBe("chronoverify-mcp");
  });

  it("routes sanctions and foreign-agent questions to the registries", () => {
    const top = ids(recommendSources("Is this Russian outlet sanctioned or a registered foreign agent?", {}, keyless)).slice(0, 2);
    expect(top.sort()).toEqual(["correctiv-sanctions", "fara-efile-api"]);
  });

  it("puts Cofacts first for Taiwanese rumours when unconnected sources are allowed", () => {
    const result = recommendSources("Is this LINE message rumor from Taiwan true?", { include_unconnected: true }, keyless);
    expect(ids(result)[0]).toBe("cofacts-graphql");
    expect(result.recommended[0]).toMatchObject({ connected: false, needs: expect.stringContaining("COFACTS") });
  });

  it("lists better sources that are not connected, and none after they are configured", () => {
    const unconfigured = recommendSources("Was this essay written by ChatGPT?", {}, keyless);
    expect(unconfigured.better_sources_not_connected.map((s) => s.source_id)).toContain("pangram-mcp");
    const configured = recommendSources("Was this essay written by ChatGPT?", {}, ctx(router([]).impl, { PANGRAM_API_KEY: "k" }));
    expect(ids(configured)[0]).toBe("pangram-mcp");
  });

  it("caps max_sources at 10 and returns at least one", () => {
    expect(recommendSources("fact check", { max_sources: 50, include_unconnected: true }, keyless).recommended.length).toBe(10);
    expect(recommendSources("fact check", { max_sources: 0 }, keyless).recommended.length).toBe(1);
  });
});

describe("searchResources with max_sources", () => {
  it("queries only the recommended sources", async () => {
    const rss = '<rss><channel><item><title>NHS waiting list claim</title><link>https://fullfact.org/a</link><guid>a</guid></item></channel></rss>';
    const { impl, calls } = router([[/./, () => text(rss, "application/rss+xml")]]);
    const result = await searchResources("NHS waiting list claim in Britain", { max_sources: 2 }, ctx(impl));
    expect(result.selected_sources).toHaveLength(2);
    expect(calls.length).toBe(2);
    expect(result.selected_sources?.[0]).toMatchObject({ source_id: "fullfact-feed" });
  });
});

describe("source fit", () => {
  it("every implemented source with an adapter declares a fit or is deliberately unrouted", () => {
    for (const source of SOURCE_REGISTRY.sources) {
      expect(source.fit, source.id).toBeDefined();
      expect(Array.isArray(source.fit.regions), source.id).toBe(true);
    }
  });
});
