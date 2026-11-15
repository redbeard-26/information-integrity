/**
 * Deterministic source recommendation. A request is classified by keyword cues into request types,
 * regions and languages; each source's declared fit (src/data/sources.json "fit") is then scored
 * against that classification. Every point is explained in the output. docs/ROUTING.md has the tables.
 */

export const REQUEST_TYPES = {
  claim_check: {
    label: "Check a factual claim, rumor, quote or statistic",
    cues: [
      "claim", "true", "false", "fact", "fact-check", "factcheck", "fact check", "rumor", "rumour", "hoax", "debunk", "myth",
      "misleading", "accurate", "accuracy", "statistic", "quote", "said", "is it true", "did", "really", "verify", "real or fake",
      "fake news", "misinformation", "disinformation", "viral", "whatsapp", "forwarded", "chain message", "scam",
      // Spanish and Portuguese
      "es verdad", "es real", "es cierto", "falso", "falsa", "bulo", "desinformación", "é verdade", "boato", "desinformação", "mentira",
    ],
  },
  media_authenticity: {
    label: "Check whether an image, video or audio clip is authentic, AI-generated or manipulated",
    cues: [
      "image", "photo", "picture", "video", "clip", "footage", "audio", "voice", "recording", "deepfake", "deep fake",
      "ai-generated image", "ai generated image", "synthetic", "manipulated", "doctored", "photoshopped", "edited",
      "provenance", "c2pa", "content credentials", "screenshot", "face swap", "voice clone", "cloned voice",
      ".jpg", ".jpeg", ".png", ".webp", ".mp4", ".mov", ".mp3", ".wav",
      // Spanish and Portuguese
      "vídeo", "imagen", "imagem", "foto", "fotografía", "con ia", "com ia", "hecho con ia", "generado con ia", "gerado por ia", "manipulado",
    ],
  },
  ai_text: {
    label: "Check whether text was written by AI",
    cues: [
      "written by ai", "ai-written", "ai written", "chatgpt", "gpt", "llm", "generated text", "ai-generated text",
      "ai generated text", "ai-generated article", "ai generated article", "bot-written", "machine-generated", "essay",
    ],
  },
  narrative_tracking: {
    label: "Track a narrative, campaign or trend and how it spreads",
    cues: [
      "narrative", "campaign", "trend", "trending", "spreading", "spread", "coordinated", "inauthentic", "bot", "bots",
      "network", "hashtag", "amplif", "influence operation", "information operation", "fimi", "propaganda", "talking point",
      "how widely", "where is this", "monitor", "track", "astroturf", "troll",
    ],
  },
  actor_research: {
    label: "Research who is behind content: state actors, foreign agents, sanctioned entities",
    cues: [
      "who is behind", "behind this", "state actor", "state-backed", "state media", "kremlin", "foreign agent", "fara",
      "lobby", "lobbying", "registered agent", "funded by", "funding", "sanction", "sanctioned", "oligarch", "front group",
      "proxy", "attribution", "attributed", "outlet", "owner", "ownership",
    ],
  },
} as const;

export type RequestType = keyof typeof REQUEST_TYPES;
export const REQUEST_TYPE_NAMES = Object.keys(REQUEST_TYPES) as RequestType[];

/** Region cues. Region names match the "regions" values used in source fit. */
export const REGION_CUES: Record<string, string[]> = {
  "United States": ["united states", "u.s.", "usa", "american", "congress", "senate", "white house", "biden", "trump", "fbi", "cdc", "medicare"],
  "United Kingdom": ["united kingdom", "uk", "britain", "british", "england", "scotland", "nhs", "westminster", "starmer"],
  Europe: ["europe", "european", "eu", "brussels", "germany", "german", "france", "french", "italy", "poland", "netherlands", "belgium"],
  "Russia and Ukraine": ["russia", "russian", "kremlin", "putin", "ukraine", "ukrainian", "moscow", "kyiv", "zelensky", "rusia", "ucrania", "ucraniano", "rússia", "ucrânia"],
  Taiwan: ["taiwan", "taiwanese", "taipei", "line app", "line message"],
  China: ["china", "chinese", "beijing", "ccp", "weibo", "wechat"],
  India: ["india", "indian", "modi", "delhi", "mumbai", "hindi", "bjp"],
  "Latin America": ["latin america", "argentina", "brazil", "brasil", "mexico", "colombia", "chile", "peru", "venezuela", "milei", "lula"],
  Spain: ["spain", "spanish government", "madrid", "sánchez"],
  "Middle East and North Africa": ["arab", "arabic", "middle east", "gaza", "israel", "iran", "syria", "egypt", "saudi", "lebanon"],
  Africa: ["africa", "african", "nigeria", "kenya", "south africa", "ghana", "ethiopia", "senegal"],
  Philippines: ["philippines", "filipino", "manila", "marcos", "duterte"],
};

/** Language cues: names of languages and characteristic scripts. */
export const LANGUAGE_CUES: Record<string, { words: string[]; script?: RegExp }> = {
  zh: { words: ["chinese", "mandarin", "中文"], script: /[一-鿿]/ },
  ar: { words: ["arabic"], script: /[؀-ۿ]/ },
  ru: { words: ["russian-language", "in russian"], script: /[Ѐ-ӿ]/ },
  hi: { words: ["hindi"], script: /[ऀ-ॿ]/ },
  es: { words: ["spanish", "español", "en español"], script: /[¿¡ñ]/ },
  pt: { words: ["portuguese", "português"], script: /[ãõ]/ },
  fr: { words: ["in french", "french-language", "français"] },
};

export interface SourceFit {
  /** Request types the source serves: primary means it answers the request directly. */
  request_types: Partial<Record<RequestType, "primary" | "secondary">>;
  /** "Global" or region names from REGION_CUES. */
  regions: string[];
  /** ISO 639-1 codes, or ["*"] for language-independent sources (e.g. media detection). */
  languages: string[];
  /** Media the source handles. */
  media: Array<"text" | "image" | "video" | "audio" | "url">;
}

export interface Classification {
  request_types: Array<{ type: RequestType; label: string; cues: string[]; weight: number }>;
  regions: Array<{ region: string; cues: string[] }>;
  languages: Array<{ language: string; cues: string[] }>;
  defaulted: boolean;
}

function hasCue(text: string, cue: string): boolean {
  if (cue.startsWith(".") || /[^a-z0-9 \-]/.test(cue)) return text.includes(cue);
  if (cue.endsWith("if")) return new RegExp(`\\b${cue}`).test(text); // prefix cue, e.g. "amplif"
  return new RegExp(`(^|[^a-z0-9])${cue.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}($|[^a-z0-9])`).test(text);
}

export function classifyRequest(
  request: string,
  overrides: { request_type?: RequestType; region?: string; language?: string } = {},
): Classification {
  const text = request.toLowerCase().normalize("NFKC");
  const scored = REQUEST_TYPE_NAMES.map((type) => ({
    type,
    label: REQUEST_TYPES[type].label,
    cues: REQUEST_TYPES[type].cues.filter((cue) => hasCue(text, cue)),
  })).filter((entry) => entry.cues.length > 0);

  let defaulted = false;
  let types: Classification["request_types"];
  if (overrides.request_type) {
    types = [{ type: overrides.request_type, label: REQUEST_TYPES[overrides.request_type].label, cues: ["(set by caller)"], weight: 1 }];
  } else if (scored.length === 0) {
    defaulted = true;
    types = [{ type: "claim_check", label: REQUEST_TYPES.claim_check.label, cues: [], weight: 1 }];
  } else {
    scored.sort((a, b) => b.cues.length - a.cues.length || REQUEST_TYPE_NAMES.indexOf(a.type) - REQUEST_TYPE_NAMES.indexOf(b.type));
    const top = scored[0].cues.length;
    types = scored.map((entry, index) => ({ ...entry, weight: index === 0 ? 1 : entry.cues.length >= top ? 1 : 0.5 }));
  }

  const regions = overrides.region
    ? [{ region: overrides.region, cues: ["(set by caller)"] }]
    : Object.entries(REGION_CUES)
        .map(([region, cues]) => ({ region, cues: cues.filter((cue) => hasCue(text, cue)) }))
        .filter((entry) => entry.cues.length > 0);

  const languages = overrides.language
    ? [{ language: overrides.language.toLowerCase(), cues: ["(set by caller)"] }]
    : Object.entries(LANGUAGE_CUES)
        .map(([language, spec]) => ({
          language,
          cues: [...spec.words.filter((word) => hasCue(text, word)), ...(spec.script?.test(request) ? ["(script)"] : [])],
        }))
        .filter((entry) => entry.cues.length > 0);

  return { request_types: types, regions, languages, defaulted };
}

export interface Candidate {
  id: string;
  offering: string;
  fit: SourceFit;
  overall_score: number;
  connected: boolean;
  status: string;
}

export const POINTS = {
  primary: 50,
  secondary: 20,
  region_match: 20,
  region_mismatch: -25,
  language_match: 15,
  language_mismatch: -15,
  connected: 15,
  /** Overall ranking score (0-100) is scaled to 0-30. */
  ranking_scale: 0.3,
} as const;

export interface Recommendation {
  source_id: string;
  offering: string;
  points: number;
  connected: boolean;
  status: string;
  reasons: string[];
}

/** Scores every candidate; sources that fit none of the request types are dropped. */
export function scoreCandidates(classification: Classification, candidates: Candidate[]): Recommendation[] {
  const results: Recommendation[] = [];
  for (const candidate of candidates) {
    const reasons: string[] = [];
    let fitPoints = 0;
    for (const entry of classification.request_types) {
      const fit = candidate.fit.request_types[entry.type];
      if (!fit) continue;
      const points = POINTS[fit] * entry.weight;
      fitPoints += points;
      reasons.push(`${fit} source for "${entry.type}" (+${points})`);
    }
    if (fitPoints === 0) continue;
    let points = fitPoints;

    const global = candidate.fit.regions.includes("Global");
    for (const { region } of classification.regions) {
      if (candidate.fit.regions.includes(region)) {
        points += POINTS.region_match;
        reasons.push(`covers ${region} (+${POINTS.region_match})`);
      }
    }
    if (classification.regions.length && !global && !classification.regions.some(({ region }) => candidate.fit.regions.includes(region))) {
      points += POINTS.region_mismatch;
      reasons.push(`covers only ${candidate.fit.regions.join(", ")} (${POINTS.region_mismatch})`);
    }

    const anyLanguage = candidate.fit.languages.includes("*");
    if (!anyLanguage && classification.languages.length) {
      if (classification.languages.some(({ language }) => candidate.fit.languages.includes(language))) {
        points += POINTS.language_match;
        reasons.push(`works in the request's language (+${POINTS.language_match})`);
      } else {
        points += POINTS.language_mismatch;
        reasons.push(`does not cover the request's language (${POINTS.language_mismatch})`);
      }
    }

    const rankPoints = Math.round(candidate.overall_score * POINTS.ranking_scale * 10) / 10;
    points += rankPoints;
    reasons.push(`overall ranking score ${candidate.overall_score}/100 (+${rankPoints})`);

    if (candidate.connected) {
      points += POINTS.connected;
      reasons.push(`connected and queryable now (+${POINTS.connected})`);
    } else {
      reasons.push("not connected on this server (needs configuration or an adapter)");
    }

    results.push({
      source_id: candidate.id,
      offering: candidate.offering,
      points: Math.round(points * 10) / 10,
      connected: candidate.connected,
      status: candidate.status,
      reasons,
    });
  }
  return results.sort((a, b) => b.points - a.points || a.source_id.localeCompare(b.source_id));
}
