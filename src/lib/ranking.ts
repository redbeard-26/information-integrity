/**
 * Source ranking. Each source is scored 0-5 on six criteria by hand, with a written reason per score,
 * in src/data/sources.json. The overall score is computed here so the weights live in one place.
 * docs/RANKING.md explains the scale for each criterion.
 */
export const CRITERIA = {
  access: {
    weight: 25,
    question: "Can this server query it without a contract?",
    scale: "5 keyless public; 4 free key, self-serve; 3 paid key, self-serve; 2 approval or request only; 1 commercial contract; 0 self-host only or no shared data",
  },
  relevance: {
    weight: 20,
    question: "How directly does it help assess a piece of information?",
    scale: "5 itemized fact-checks or verdicts; 4 itemized analysis of narratives, actors or media; 3 indirect evidence (registries, datasets); 2 monitoring data needing analysis; 1 tangential; 0 not information-integrity data",
  },
  evidence: {
    weight: 20,
    question: "How strong and transparent is the method behind each item?",
    scale: "5 human editorial review with published method and sources (IFCN/EFCSN signatory or official record); 4 documented human or hybrid method; 3 automated model with published evaluation; 2 proprietary method, little disclosure; 1 unclear; 0 none",
  },
  freshness: {
    weight: 10,
    question: "How current is the data?",
    scale: "5 real-time or daily; 4 weekly; 3 monthly; 2 irregular; 1 stale (over a year); 0 unknown",
  },
  rights: {
    weight: 15,
    question: "What may we do with what it returns?",
    scale: "5 open licence (e.g. CC BY); 4 headline, link and excerpt use customary (public feed); 3 API terms allow display without redistribution; 2 customer terms only; 1 unconfirmed; 0 reuse prohibited",
  },
  reliability: {
    weight: 10,
    question: "How sure are we the interface works as documented?",
    scale: "5 live-tested here; 4 public schema verified against primary docs; 3 documented; 2 advertised, not public; 1 undocumented; 0 no interface",
  },
} as const;

export type Criterion = keyof typeof CRITERIA;
export const CRITERION_NAMES = Object.keys(CRITERIA) as Criterion[];

export type RankingScores = Record<Criterion, { score: number; reason: string }>;

/** Weighted score from 0 to 100, rounded to one decimal place. */
export function overallScore(ranking: RankingScores): number {
  let total = 0;
  for (const name of CRITERION_NAMES) total += (ranking[name].score / 5) * CRITERIA[name].weight;
  return Math.round(total * 10) / 10;
}

/** Sorts by overall score, then access, then id, so ties resolve the same way every time. */
export function rankOrder<T extends { id: string; ranking: RankingScores }>(sources: T[]) {
  return [...sources]
    .map((source) => ({ source, score: overallScore(source.ranking) }))
    .sort(
      (a, b) =>
        b.score - a.score || b.source.ranking.access.score - a.source.ranking.access.score || a.source.id.localeCompare(b.source.id),
    )
    .map((entry, index) => ({ ...entry, rank: index + 1 }));
}
