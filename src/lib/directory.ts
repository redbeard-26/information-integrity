import dataset from "@/data/organizations.json";

export interface Organization {
  id: string;
  name: string;
  organization_type: string | null;
  operating_status: string | null;
  geographic_focus: string | null;
  headquarters_country: string | null;
  mission: string | null;
  why_included: string | null;
  focus_areas: string[];
  methods: string[];
  threat_actors: string[];
  countries_of_focus: string | null;
  languages: string | null;
  funders: string | null;
  website: string | null;
  source_links: string[];
  verification_status: string | null;
  last_verified: string | null;
  source_workbook_row: number | null;
  duplicate_name: boolean;
  extra: Record<string, unknown>;
}

export interface DirectoryDataset {
  source: {
    name: string;
    url: string;
    publisher: string;
    workbook: string;
    collected_at: string;
    notes: string[];
  };
  counts: { records: number; distinct_names: number; duplicate_name_groups: number };
  records: Organization[];
}

export const DIRECTORY = dataset as DirectoryDataset;

function splitList(value: string | null): string[] {
  return value ? value.split(/\s*[;/]\s*/).filter(Boolean) : [];
}

export const FACETS = {
  focus_area: (org: Organization) => org.focus_areas,
  // The source sometimes lists two regions, e.g. "Europe; North America".
  region: (org: Organization) => splitList(org.geographic_focus),
  organization_type: (org: Organization) => (org.organization_type ? [org.organization_type] : []),
  status: (org: Organization) => (org.operating_status ? [org.operating_status] : []),
  headquarters_country: (org: Organization) => (org.headquarters_country ? [org.headquarters_country] : []),
  method: (org: Organization) => org.methods,
  threat_actor: (org: Organization) => org.threat_actors,
} as const;

export type FacetName = keyof typeof FACETS;
export const FACET_NAMES = Object.keys(FACETS) as FacetName[];

export function normalize(value: string): string {
  return value
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function matchesFacet(values: string[], wanted: string | undefined): boolean {
  if (!wanted) return true;
  const target = normalize(wanted);
  return values.some((value) => normalize(value) === target);
}

const SEARCH_FIELDS: Array<[keyof Organization, number]> = [
  ["name", 8],
  ["mission", 2],
  ["why_included", 2],
  ["focus_areas", 3],
  ["methods", 2],
  ["threat_actors", 2],
  ["headquarters_country", 2],
  ["countries_of_focus", 1],
  ["organization_type", 1],
  ["geographic_focus", 1],
  ["funders", 1],
  ["languages", 1],
];

function fieldText(org: Organization, field: keyof Organization): string {
  const value = org[field];
  if (Array.isArray(value)) return normalize(value.join(" "));
  return typeof value === "string" ? normalize(value) : "";
}

function score(org: Organization, terms: string[], phrase: string): number {
  let total = 0;
  for (const term of terms) {
    let termScore = 0;
    for (const [field, weight] of SEARCH_FIELDS) {
      const text = fieldText(org, field);
      if (!text) continue;
      if (` ${text} `.includes(` ${term} `)) termScore += weight;
      else if (text.includes(term)) termScore += weight / 2;
    }
    if (termScore === 0) return 0;
    total += termScore;
  }
  const name = normalize(org.name);
  if (name === phrase) total += 50;
  else if (name.startsWith(phrase)) total += 10;
  return total;
}

export interface SearchFilters {
  query?: string;
  focus_area?: string;
  region?: string;
  organization_type?: string;
  status?: string;
  headquarters_country?: string;
  method?: string;
  threat_actor?: string;
  limit?: number;
  offset?: number;
}

export function summarize(org: Organization) {
  return {
    id: org.id,
    name: org.name,
    organization_type: org.organization_type,
    operating_status: org.operating_status,
    geographic_focus: org.geographic_focus,
    headquarters_country: org.headquarters_country,
    focus_areas: org.focus_areas,
    mission: org.mission,
    website: org.website,
    duplicate_name: org.duplicate_name,
  };
}

export function searchOrganizations(filters: SearchFilters, records: Organization[] = DIRECTORY.records) {
  const limit = Math.min(Math.max(filters.limit ?? 20, 1), 100);
  const offset = Math.max(filters.offset ?? 0, 0);
  const phrase = filters.query ? normalize(filters.query) : "";
  const terms = phrase ? phrase.split(" ").filter(Boolean) : [];

  const matched = records
    .filter(
      (org) =>
        matchesFacet(FACETS.focus_area(org), filters.focus_area) &&
        matchesFacet(FACETS.region(org), filters.region) &&
        matchesFacet(FACETS.organization_type(org), filters.organization_type) &&
        matchesFacet(FACETS.status(org), filters.status) &&
        matchesFacet(FACETS.headquarters_country(org), filters.headquarters_country) &&
        matchesFacet(FACETS.method(org), filters.method) &&
        matchesFacet(FACETS.threat_actor(org), filters.threat_actor),
    )
    .map((org) => ({ org, score: terms.length ? score(org, terms, phrase) : 1 }))
    .filter((entry) => entry.score > 0)
    .sort((a, b) => b.score - a.score || a.org.name.localeCompare(b.org.name));

  return {
    total: matched.length,
    offset,
    limit,
    results: matched.slice(offset, offset + limit).map((entry) => summarize(entry.org)),
  };
}

export function getOrganization(
  ref: { id?: string; name?: string },
  records: Organization[] = DIRECTORY.records,
): Organization[] {
  if (ref.id) {
    const id = ref.id.trim().toUpperCase();
    return records.filter((org) => org.id.toUpperCase() === id);
  }
  if (ref.name) {
    const target = normalize(ref.name);
    return records.filter((org) => normalize(org.name) === target);
  }
  return [];
}

export function facetCounts(facet: FacetName, records: Organization[] = DIRECTORY.records) {
  const counts = new Map<string, number>();
  for (const org of records) {
    for (const value of new Set(FACETS[facet](org))) counts.set(value, (counts.get(value) ?? 0) + 1);
  }
  return [...counts.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

export function directoryInfo() {
  return {
    source: DIRECTORY.source,
    counts: DIRECTORY.counts,
    facets: FACET_NAMES,
    caveat:
      "Descriptions, classifications, funding statements and operating statuses are claims from the source workbook, not independently verified. Follow source_links before relying on them.",
  };
}
