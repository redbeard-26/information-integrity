import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";
import { CRITERIA, CRITERION_NAMES, type RankingScores, overallScore, rankOrder } from "@/lib/ranking";
import { SOURCE_REGISTRY } from "@/lib/sources";

describe("ranking", () => {
  it("weights add up to 100", () => {
    expect(CRITERION_NAMES.reduce((sum, name) => sum + CRITERIA[name].weight, 0)).toBe(100);
  });

  it("every source scores each criterion 0-5 with a reason", () => {
    for (const source of SOURCE_REGISTRY.sources) {
      for (const name of CRITERION_NAMES) {
        const entry = source.ranking[name];
        expect(Number.isInteger(entry.score) && entry.score >= 0 && entry.score <= 5, `${source.id}.${name}`).toBe(true);
        expect(entry.reason.trim().length, `${source.id}.${name}`).toBeGreaterThan(2);
      }
    }
  });

  it("computes the weighted score", () => {
    const all = (score: number) => Object.fromEntries(CRITERION_NAMES.map((n) => [n, { score, reason: "x" }])) as RankingScores;
    expect(overallScore(all(5))).toBe(100);
    expect(overallScore(all(0))).toBe(0);
    expect(overallScore({ ...all(5), freshness: { score: 0, reason: "x" } })).toBe(90);
  });

  it("the docs ranking table matches the computed order", () => {
    const doc = readFileSync("docs/RANKING.md", "utf8");
    for (const { source, score, rank } of rankOrder(SOURCE_REGISTRY.sources)) {
      expect(doc, source.id).toContain(`| ${rank} | \`${source.id}\` | ${score} |`);
    }
  });
});
