import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { describe, expect, it } from "vitest";
import {
  DIRECTORY,
  type Organization,
  facetCounts,
  getOrganization,
  normalize,
  searchOrganizations,
} from "@/lib/directory";
import { TOOL_NAMES, registerInformationIntegrityTools } from "@/lib/register-tools";

function org(partial: Partial<Organization> & Pick<Organization, "id" | "name">): Organization {
  return {
    organization_type: "NGO / Nonprofit",
    operating_status: "Active",
    geographic_focus: "Global",
    headquarters_country: "United States",
    mission: null,
    why_included: null,
    focus_areas: [],
    methods: [],
    threat_actors: [],
    countries_of_focus: null,
    languages: null,
    funders: null,
    website: null,
    source_links: [],
    verification_status: "Internet Research Only",
    last_verified: "2026-08-08",
    source_workbook_row: 1,
    duplicate_name: false,
    extra: {},
    ...partial,
  };
}

const FIXTURE = [
  org({
    id: "00000000-0000-0000-0000-000000000001",
    name: "Fact Check Africa",
    geographic_focus: "Africa",
    headquarters_country: "South Africa",
    mission: "Fact-checking public claims across Africa.",
    focus_areas: ["Media & News Integrity", "Health & Science Misinformation"],
    methods: ["Fact-Checking"],
  }),
  org({
    id: "00000000-0000-0000-0000-000000000002",
    name: "Deepfake Lab",
    organization_type: "Academic / Research",
    geographic_focus: "Europe",
    headquarters_country: "Germany",
    mission: "Detects synthetic media and deepfakes.",
    focus_areas: ["AI-Generated Content & Deepfakes"],
    threat_actors: ["Russia"],
  }),
  org({
    id: "00000000-0000-0000-0000-000000000003",
    name: "Deepfake Lab",
    operating_status: "Inactive",
    mission: "Second source record with the same name.",
    duplicate_name: true,
  }),
];

describe("directory search", () => {
  it("ranks a name match above a description match", () => {
    const { results } = searchOrganizations({ query: "deepfake" }, FIXTURE);
    expect(results[0].name).toBe("Deepfake Lab");
    expect(results).toHaveLength(2);
  });

  it("requires every query term to match somewhere", () => {
    expect(searchOrganizations({ query: "deepfake africa" }, FIXTURE).total).toBe(0);
    expect(searchOrganizations({ query: "fact africa" }, FIXTURE).total).toBe(1);
  });

  it("applies exact facet filters case- and punctuation-insensitively", () => {
    expect(searchOrganizations({ focus_area: "media and news integrity" }, FIXTURE).total).toBe(1);
    expect(searchOrganizations({ region: "europe", threat_actor: "russia" }, FIXTURE).total).toBe(1);
    expect(searchOrganizations({ status: "Inactive" }, FIXTURE).results[0].id).toBe("00000000-0000-0000-0000-000000000003");
  });

  it("pages results", () => {
    const page = searchOrganizations({ limit: 1, offset: 1 }, FIXTURE);
    expect(page.total).toBe(3);
    expect(page.results).toHaveLength(1);
  });

  it("returns both records for a duplicated name and one for an id", () => {
    expect(getOrganization({ name: "deepfake lab" }, FIXTURE)).toHaveLength(2);
    expect(getOrganization({ id: "00000000-0000-0000-0000-000000000001" }, FIXTURE)[0].name).toBe("Fact Check Africa");
  });

  it("counts facet values once per record", () => {
    expect(facetCounts("region", FIXTURE)).toEqual([
      { value: "Global", count: 1 },
      { value: "Africa", count: 1 },
      { value: "Europe", count: 1 },
    ].sort((a, b) => b.count - a.count || a.value.localeCompare(b.value)));
  });

  it("normalizes accents and ampersands", () => {
    expect(normalize("Agência Lupa")).toBe("agencia lupa");
    expect(normalize("Media & News")).toBe("media and news");
  });
});

describe("bundled dataset", () => {
  it("matches the source counts", () => {
    expect(DIRECTORY.counts).toEqual({ records: 261, distinct_names: 251, duplicate_name_groups: 10 });
    expect(DIRECTORY.records).toHaveLength(261);
    expect(new Set(DIRECTORY.records.map((record) => record.id)).size).toBe(261);
  });

  it("has a name, type, region and source link on every record", () => {
    for (const record of DIRECTORY.records) {
      expect(record.name, record.id).toBeTruthy();
      expect(record.organization_type, record.id).toBeTruthy();
      expect(record.geographic_focus, record.id).toBeTruthy();
      expect(record.source_links.length + (record.website ? 1 : 0), record.id).toBeGreaterThan(0);
    }
  });
});

interface RegisteredTool {
  handler: (input: Record<string, unknown>) => Promise<{ content: Array<{ text: string }>; isError?: boolean }>;
}

function tools() {
  const server = new McpServer({ name: "test", version: "1" });
  registerInformationIntegrityTools(server);
  return (server as unknown as { _registeredTools: Record<string, RegisteredTool> })._registeredTools;
}

describe("MCP tools", () => {
  it("registers the read-only tool set", () => {
    expect(Object.keys(tools())).toEqual(TOOL_NAMES);
  });

  it("searches, fetches and lists through the tool handlers", async () => {
    const registered = tools();
    const search = JSON.parse((await registered.search_organizations.handler({ query: "bellingcat" })).content[0].text);
    expect(search.results[0].name).toBe("Bellingcat");
    const record = JSON.parse((await registered.get_organization.handler({ id: search.results[0].id })).content[0].text);
    expect(record.records[0].website).toMatch(/^https:\/\//);
    const categories = JSON.parse((await registered.list_categories.handler({ facet: "region" })).content[0].text);
    expect(categories.region.reduce((sum: number, item: { count: number }) => sum + item.count, 0)).toBeGreaterThanOrEqual(261);
    const missing = await registered.get_organization.handler({});
    expect(missing.isError).toBe(true);
  });
});
