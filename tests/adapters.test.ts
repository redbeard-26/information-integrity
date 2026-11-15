import { beforeEach, describe, expect, it } from "vitest";
import { aiOrNotAdapter } from "@/lib/adapters/aiornot";
import { blackbirdAdapter } from "@/lib/adapters/blackbird";
import { checkFirstAdapter } from "@/lib/adapters/checkfirst";
import { chronoVerifyAdapter } from "@/lib/adapters/chronoverify";
import { correctivAdapter, parseCsv, resetCorrectivCache } from "@/lib/adapters/correctiv";
import { deepMediaAdapter } from "@/lib/adapters/deepmedia";
import { factiverseAdapter } from "@/lib/adapters/factiverse";
import { faraAdapter, resetFaraState } from "@/lib/adapters/fara";
import { publicHttpsUrl } from "@/lib/adapters/http";
import { meedanCheckAdapter } from "@/lib/adapters/meedan-check";
import { pangramAdapter } from "@/lib/adapters/pangram";
import { realityDefenderAdapter } from "@/lib/adapters/realitydefender";
import { ctx, json, router, text } from "./helpers";

beforeEach(() => {
  resetFaraState();
  resetCorrectivCache();
});

describe("CheckFirst RADAR", () => {
  it("sends a descriptive User-Agent and maps search results", async () => {
    const { impl, calls } = router([
      ["/infringements/search", () => json({ results: [{ infringement_id: "INF-1", infringement_name: "Coordinated inauthentic behaviour", category_name: "Manipulation", description: "d" }], total_above_threshold: 1 })],
    ]);
    const page = await checkFirstAdapter.search!("bot network", { limit: 5 }, ctx(impl));
    expect((calls[0].init.headers as Record<string, string>)["user-agent"]).toMatch(/^ASFAI-Information-Integrity\/.+\(https:/);
    expect(calls[0].url).toContain("q=bot%20network");
    expect(page.items[0]).toMatchObject({ original_id: "INF-1", original_labels: ["Manipulation"], attribution: { license: "CC BY 4.0" } });
  });

  it("gets one infringement and rejects malformed answers", async () => {
    const good = router([["/infringements/INF-2", () => json({ id: "INF-2", name: "n", dsaArticles: ["34"], category: { name: "c" } })]]);
    expect((await checkFirstAdapter.get!("INF-2", ctx(good.impl))).original_labels).toEqual(["c", "DSA 34"]);
    const bad = router([["/infringements/search", () => json({ nope: true })]]);
    await expect(checkFirstAdapter.search!("x", { limit: 5 }, ctx(bad.impl))).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("FARA eFile", () => {
  const active = { REGISTRANTS_ACTIVE: { ROW: [
    { Registration_Number: 6, Registration_Date: "01/02/2020", Name: "Example Strategies LLC", City: "Washington", State: "DC" },
    { Registration_Number: 7, Registration_Date: "03/04/2021", Name: "Other Group", Business_Name: "Rossiya Media Partners" },
  ] } };

  it("searches active registrants by name and spaces calls to respect the rate limit", async () => {
    const waits: number[] = [];
    const { impl, calls } = router([
      ["/Registrants/json/Active", () => json(active)],
      ["/ForeignPrincipals/json/Active/7", () => json({ ROWSET: { ROW: { REG_NUMBER: 7, FP_NAME: "Example Ministry", COUNTRY_NAME: "RUSSIA" } } })],
    ]);
    const context = { ...ctx(impl), sleep: async (ms: number) => { waits.push(ms); } };
    const page = await faraAdapter.search!("rossiya media", { limit: 5 }, context);
    expect(page.items).toHaveLength(1);
    expect(page.items[0]).toMatchObject({ original_id: "7", published_at: "2021-03-04", attribution: { license: "Public domain" } });
    const item = await faraAdapter.get!("7", context);
    expect(item.excerpt).toContain("Foreign principals: Example Ministry (RUSSIA)");
    expect(calls).toHaveLength(2); // registrant list cached
    expect(waits.length).toBe(1);
    expect(waits[0]).toBeGreaterThan(2000);
  });

  it("rejects non-numeric ids and unknown registrants", async () => {
    const { impl } = router([["/Registrants/json/Active", () => json(active)]]);
    await expect(faraAdapter.get!("../x", ctx(impl))).rejects.toMatchObject({ code: "not_found" });
    await expect(faraAdapter.get!("99", ctx(impl))).rejects.toMatchObject({ code: "not_found" });
  });
});

describe("CORRECTIV sanctions data", () => {
  const csv = 'name,category_en,category_de,start,end,authority,sourceurl\r\n"Ivanov, Ivan",Person,Person,2022-03-01,,:eu: EU,[URL](https://eur-lex.europa.eu/x)\r\nAk Alrosa Pao,Company,Unternehmen,2024-01-03,,:be: BE,[URL](https://example.org/y)\r\n';

  it("parses quoted CSV fields", () => {
    expect(parseCsv('a,b\n"x, ""y""",z\n')).toEqual([["a", "b"], ['x, "y"', "z"]]);
  });

  it("searches names and links the sanctioning source", async () => {
    const { impl } = router([["raw.githubusercontent.com", () => text(csv, "text/plain")]]);
    const page = await correctivAdapter.search!("alrosa", { limit: 5 }, ctx(impl));
    expect(page.items[0]).toMatchObject({ title: "Ak Alrosa Pao", original_url: "https://example.org/y", original_labels: ["Company", "BE"], published_at: "2024-01-03" });
    expect((await correctivAdapter.get!("0", ctx(impl))).title).toBe("Ivanov, Ivan");
    await expect(correctivAdapter.get!("9", ctx(impl))).rejects.toMatchObject({ code: "not_found" });
  });

  it("rejects a file with unexpected columns", async () => {
    const { impl } = router([["raw.githubusercontent.com", () => text("a,b\n1,2\n", "text/plain")]]);
    await expect(correctivAdapter.search!("x", { limit: 5 }, ctx(impl))).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("ChronoVerify", () => {
  it("submits an image URL without a key and returns the provider's verdict", async () => {
    const { impl, calls } = router([["/v1/verify", () => json({ verdict: "metadata_anomaly", confidence: 71, headline: "h", summary: "s", permalink: "https://chronoverify.com/r/1" })]]);
    const result = await chronoVerifyAdapter.analyze!({ url: "https://news.example.org/photo.jpg" }, ctx(impl));
    expect((calls[0].init.body as FormData).get("url")).toBe("https://news.example.org/photo.jpg");
    expect((calls[0].init.headers as Record<string, string>).authorization).toBeUndefined();
    expect(result).toMatchObject({ state: "complete", original_labels: ["metadata_anomaly"], scores: { confidence: 71 }, report_id: "https://chronoverify.com/r/1", untrusted: true });
  });

  it("refuses private hosts and text input", async () => {
    const { impl } = router([]);
    await expect(chronoVerifyAdapter.analyze!({ url: "https://127.0.0.1/x.png" }, ctx(impl))).rejects.toMatchObject({ code: "bad_response" });
    await expect(chronoVerifyAdapter.analyze!({ text: "hello" }, ctx(impl))).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("URL guard", () => {
  it("accepts public https and rejects everything else", () => {
    expect(publicHttpsUrl("https://example.org/a.jpg").hostname).toBe("example.org");
    for (const bad of ["http://example.org", "https://localhost/x", "https://10.0.0.1/x", "https://192.168.1.2/", "https://user:pw@example.org/", "file:///etc/passwd", "https://2130706433/"]) {
      expect(() => publicHttpsUrl(bad), bad).toThrow();
    }
  });
});

describe("keyed adapters report missing credentials without calling out", () => {
  it.each([
    ["factiverse", () => factiverseAdapter.search!("q", { limit: 5 }, ctx(router([]).impl)), "FACTIVERSE_TOKEN"],
    ["meedan", () => meedanCheckAdapter.search!("q", { limit: 5 }, ctx(router([]).impl)), "CHECK_API_TOKEN"],
    ["aiornot", () => aiOrNotAdapter.analyze!({ text: "x".repeat(300) }, ctx(router([]).impl)), "AIORNOT_API_KEY"],
    ["realitydefender", () => realityDefenderAdapter.analyze!({ url: "https://x.com/a/status/1" }, ctx(router([]).impl)), "REALITY_DEFENDER_API_KEY"],
    ["pangram", () => pangramAdapter.analyze!({ text: "some text" }, ctx(router([]).impl)), "PANGRAM_API_KEY"],
    ["deepmedia", () => deepMediaAdapter.analyze!({ url: "https://example.org/v.mp4" }, ctx(router([]).impl)), "DEEPMEDIA_API_KEY"],
    ["blackbird", () => blackbirdAdapter.analyze!({ text: "claim" }, ctx(router([]).impl)), "BLACKBIRD_CLIENT_KEY"],
  ])("%s", async (_name, call, variable) => {
    await expect(call()).rejects.toMatchObject({ code: "not_configured", message: expect.stringContaining(variable) });
  });
});

describe("Factiverse", () => {
  const env = { FACTIVERSE_TOKEN: "t" };
  it("searches published fact-checks", async () => {
    const { impl, calls } = router([["/v1/claim_search", () => json({ searchResults: [{ claim: "c", label: "False", url: "https://fc.example/1", domainName: "fc.example", publishDate: "2026-01-01" }] })]]);
    const page = await factiverseAdapter.search!("q", { limit: 5 }, ctx(impl, env));
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe("Bearer t");
    expect(page.items[0]).toMatchObject({ provider: "Factiverse (via fc.example)", original_labels: ["False"], original_url: "https://fc.example/1" });
  });
  it("maps fact_check predictions to labels", async () => {
    const { impl } = router([["/v1/fact_check", () => json({ _id: "r1", fact_checks: [{ claim: "Water boils at 50C", finalPrediction: 0, finalScore: 0.1, summary: "Refuted." }] })]]);
    const result = await factiverseAdapter.analyze!({ text: "Water boils at 50C" }, ctx(impl, env));
    expect(result).toMatchObject({ original_labels: ["Water boils at 50C: REFUTES"], scores: { claim_1_score: 0.1 }, report_id: "r1" });
  });
});

describe("Meedan Check", () => {
  it("sends a read-only search with workspace headers", async () => {
    const { impl, calls } = router([["graphql", () => json({ data: { search: { medias: { edges: [{ node: { dbid: 5, title: "t", status: "false", report_status: "published", published: "1700000000", claim_description: { fact_check: { title: "FC", summary: "S", url: "https://check.example/fc" } } } }] } } } })]]);
    const page = await meedanCheckAdapter.search!("q", { limit: 1 }, ctx(impl, { CHECK_API_TOKEN: "k", CHECK_TEAM_SLUG: "newsroom" }));
    const headers = calls[0].init.headers as Record<string, string>;
    expect(headers["x-check-team"]).toBe("newsroom");
    expect(JSON.parse(calls[0].init.body as string).query).not.toMatch(/mutation/);
    expect(page.items[0]).toMatchObject({ original_id: "5", title: "FC", original_url: "https://check.example/fc", original_labels: ["false", "published"], published_at: "2023-11-14T22:13:20.000Z" });
    expect(page.next_cursor).toBe("1");
  });
});

describe("AI or Not", () => {
  const env = { AIORNOT_API_KEY: "k" };
  it("checks text synchronously", async () => {
    const { impl } = router([["/v2/text/sync", () => json({ id: "r", report: { ai_text: { is_detected: true, confidence: 0.93 } } })]]);
    const result = await aiOrNotAdapter.analyze!({ text: "x".repeat(300) }, ctx(impl, env));
    expect(result).toMatchObject({ original_labels: ["ai_detected"], scores: { confidence: 0.93 }, input_kind: "text" });
  });
  it("rejects short text before sending it", async () => {
    await expect(aiOrNotAdapter.analyze!({ text: "short" }, ctx(router([]).impl, env))).rejects.toMatchObject({ code: "bad_response" });
  });
  it("downloads an image within limits and uploads it", async () => {
    const { impl, calls } = router([
      ["example.org/p.png", () => new Response(new Uint8Array([1, 2, 3]), { headers: { "content-type": "image/png" } })],
      ["/v2/image/sync", () => json({ id: "r", report: { ai_generated: { verdict: "ai", ai: { confidence: 0.9 }, human: { confidence: 0.1 } }, deepfake: { is_detected: false } } })],
    ]);
    const result = await aiOrNotAdapter.analyze!({ url: "https://example.org/p.png" }, ctx(impl, env));
    expect(calls[0].init.redirect).toBe("error");
    expect((calls[1].init.body as FormData).get("image")).toBeInstanceOf(Blob);
    expect(result).toMatchObject({ original_labels: ["ai"], scores: { ai_confidence: 0.9, human_confidence: 0.1 } });
  });
  it("refuses non-image downloads", async () => {
    const { impl } = router([["example.org/p.html", () => text("<html>", "text/html")]]);
    await expect(aiOrNotAdapter.analyze!({ url: "https://example.org/p.html" }, ctx(impl, env))).rejects.toMatchObject({ code: "bad_response" });
  });
});

describe("Reality Defender", () => {
  const env = { REALITY_DEFENDER_API_KEY: "k" };
  it("submits a social link and polls until a verdict", async () => {
    let polls = 0;
    const { impl, calls } = router([
      ["/api/files/social", () => json({ requestId: "req-1" })],
      ["/api/media/users/req-1", () => (++polls < 2 ? json({ overallStatus: "ANALYZING" }) : json({ overallStatus: "FAKE", resultsSummary: { metadata: { finalScore: 88 } }, models: [{ name: "m1", finalScore: 90 }] }))],
    ]);
    const result = await realityDefenderAdapter.analyze!({ url: "https://www.tiktok.com/@a/video/1" }, ctx(impl, env));
    expect((calls[0].init.headers as Record<string, string>)["x-api-key"]).toBe("k");
    expect(result).toMatchObject({ state: "complete", original_labels: ["FAKE"], scores: { finalScore: 88, "model:m1": 90 }, report_id: "req-1" });
  });
  it("returns a pending result when the poll budget runs out, and collects it later", async () => {
    const pending = router([["/api/files/social", () => json({ requestId: "req-2" })], ["/api/media/users/req-2", () => json({ overallStatus: "ANALYZING" })]]);
    const first = await realityDefenderAdapter.analyze!({ url: "https://x.com/a/status/1" }, { ...ctx(pending.impl, env), pollBudgetMs: 0 });
    expect(first).toMatchObject({ state: "pending", report_id: "req-2" });
    const done = router([["/api/media/users/req-2", () => json({ overallStatus: "AUTHENTIC" })]]);
    expect(await realityDefenderAdapter.analyze!({ report_id: "req-2" }, ctx(done.impl, env))).toMatchObject({ state: "complete", input_kind: "report", original_labels: ["AUTHENTIC"] });
  });
});

describe("Pangram", () => {
  it("submits text, polls the task and reports fractions", async () => {
    const { impl, calls } = router([
      [/\/task$/, () => json({ task_id: "t1" })],
      ["/task/t1", () => json({ stage: "STAGE_SUCCESS", prediction_short: "AI", headline: "Fully AI generated", fraction_ai: 1, fraction_human: 0 })],
    ]);
    const result = await pangramAdapter.analyze!({ text: "some text" }, ctx(impl, { PANGRAM_API_KEY: "k" }));
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ model: "default", public_dashboard_link: false });
    expect(result).toMatchObject({ original_labels: ["AI"], scores: { fraction_ai: 1, fraction_human: 0 }, details: "Fully AI generated" });
  });
  it("reports a failed task as unavailable", async () => {
    const { impl } = router([[/\/task$/, () => json({ task_id: "t2" })], ["/task/t2", () => json({ stage: "STAGE_FAILED" })]]);
    await expect(pangramAdapter.analyze!({ text: "x" }, ctx(impl, { PANGRAM_API_KEY: "k" }))).rejects.toMatchObject({ code: "unavailable" });
  });
});

describe("Deep Media", () => {
  it("submits a media URL with the guessed modality and reads scores", async () => {
    const { impl, calls } = router([
      ["/v2/file/process", () => json({ id: "f1" })],
      ["/file/status/f1", () => json({ status: "RESULTS", results: { video: 0.82 } })],
    ]);
    const result = await deepMediaAdapter.analyze!({ url: "https://example.org/clip.mp4" }, ctx(impl, { DEEPMEDIA_API_KEY: "k" }));
    expect(JSON.parse(calls[0].init.body as string)).toMatchObject({ modalities: ["video"], webLocation: "https://example.org/clip.mp4" });
    expect(result).toMatchObject({ state: "complete", scores: { video: 0.82 } });
  });
});

describe("Blackbird.AI", () => {
  it("gets a client-credentials token, runs a context check and polls it", async () => {
    const { impl, calls } = router([
      ["oauth2/token", () => json({ access_token: "tok" })],
      [/contextChecks$/, () => json({ id: "c1" })],
      ["/contextChecks/c1", () => json({ status: "success", context: { risk_label: "High", confidence: 0.7, summary: "Context summary" } })],
    ]);
    const result = await blackbirdAdapter.analyze!({ text: "claim" }, ctx(impl, { BLACKBIRD_CLIENT_KEY: "id", BLACKBIRD_SECRET_KEY: "secret" }));
    expect((calls[0].init.headers as Record<string, string>).authorization).toBe(`Basic ${btoa("id:secret")}`);
    expect((calls[1].init.headers as Record<string, string>).authorization).toBe("Bearer tok");
    expect(result).toMatchObject({ original_labels: ["High"], scores: { confidence: 0.7 }, details: "Context summary" });
  });
});
