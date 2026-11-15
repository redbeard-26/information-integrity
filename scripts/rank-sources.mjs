// Prints the ranking table in docs/RANKING.md from src/data/sources.json. Run: node scripts/rank-sources.mjs
import { readFileSync } from "node:fs";

const WEIGHTS = { access: 25, relevance: 20, evidence: 20, freshness: 10, rights: 15, reliability: 10 };
const { sources } = JSON.parse(readFileSync(new URL("../src/data/sources.json", import.meta.url), "utf8"));
const score = (r) => Math.round(Object.entries(WEIGHTS).reduce((t, [k, w]) => t + (r[k].score / 5) * w, 0) * 10) / 10;
const rows = sources
  .map((s) => ({ s, total: score(s.ranking) }))
  .sort((a, b) => b.total - a.total || b.s.ranking.access.score - a.s.ranking.access.score || a.s.id.localeCompare(b.s.id));
console.log("| Rank | Source | Score | Access | Relevance | Evidence | Freshness | Rights | Reliability | Status |");
console.log("|---|---|---|---|---|---|---|---|---|---|");
rows.forEach(({ s, total }, i) => {
  const r = s.ranking;
  console.log(`| ${i + 1} | \`${s.id}\` | ${total} | ${r.access.score} | ${r.relevance.score} | ${r.evidence.score} | ${r.freshness.score} | ${r.rights.score} | ${r.reliability.score} | ${s.status} |`);
});
