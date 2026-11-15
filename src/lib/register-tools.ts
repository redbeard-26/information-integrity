import type { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";
import { z } from "zod";
import {
  FACET_NAMES,
  type FacetName,
  directoryInfo,
  facetCounts,
  getOrganization,
  searchOrganizations,
} from "@/lib/directory";
import { ProviderError } from "@/lib/adapters/types";
import { REQUEST_TYPE_NAMES, type RequestType } from "@/lib/recommend";
import { analyzeContent, getResource, listSources, rankSources, recommendSources, searchResources, sourceCapabilities } from "@/lib/sources";

export const TOOL_NAMES = [
  "search_organizations",
  "get_organization",
  "list_categories",
  "about_directory",
  "list_sources",
  "get_source_capabilities",
  "rank_sources",
  "recommend_sources",
  "search_resources",
  "get_resource",
  "analyze_content",
];

const requestType = z.enum(REQUEST_TYPE_NAMES as [RequestType, ...RequestType[]]);

const READ_ONLY = { readOnlyHint: true, destructiveHint: false, idempotentHint: true, openWorldHint: false };
const READ_ONLY_REMOTE = { ...READ_ONLY, idempotentHint: false, openWorldHint: true };

function json(data: unknown) {
  return { content: [{ type: "text" as const, text: JSON.stringify(data, null, 2) }] };
}

function err(message: string) {
  return { content: [{ type: "text" as const, text: message }], isError: true };
}

const facetName = z.enum(FACET_NAMES as [FacetName, ...FacetName[]]);

export function registerInformationIntegrityTools(server: McpServer) {
  server.registerTool(
    "search_organizations",
    {
      title: "Search information integrity organizations",
      description:
        "Searches the Information Integrity Navigator directory. Combine a keyword query with exact filters (values from list_categories). Returns summaries; use get_organization for the full record and source links.",
      annotations: READ_ONLY,
      inputSchema: {
        query: z.string().optional().describe("Keywords matched against name, mission, focus, methods, actors, countries and funders"),
        focus_area: z.string().optional(),
        region: z.string().optional().describe("Geographic focus, e.g. Europe or Global"),
        organization_type: z.string().optional(),
        status: z.string().optional().describe("Active or Inactive, as recorded in the source"),
        headquarters_country: z.string().optional(),
        method: z.string().optional(),
        threat_actor: z.string().optional(),
        limit: z.number().int().min(1).max(100).optional(),
        offset: z.number().int().min(0).optional(),
      },
    },
    async (input) => json(searchOrganizations(input)),
  );

  server.registerTool(
    "get_organization",
    {
      title: "Get an organization record",
      description:
        "Returns full directory records by record id or exact name. A name can return two records when the source lists it twice.",
      annotations: READ_ONLY,
      inputSchema: { id: z.string().optional(), name: z.string().optional() },
    },
    async ({ id, name }) => {
      if (!id && !name) return err("Pass an id or a name.");
      const records = getOrganization({ id, name });
      if (records.length === 0) {
        return err(`No record for ${id ? `id '${id}'` : `name '${name}'`}. Use search_organizations to find it.`);
      }
      return json({ count: records.length, records });
    },
  );

  server.registerTool(
    "list_categories",
    {
      title: "List directory categories",
      description:
        "Lists filter values with record counts: focus_area, region, organization_type, status, headquarters_country, method, threat_actor. Omit facet for all.",
      annotations: READ_ONLY,
      inputSchema: { facet: facetName.optional() },
    },
    async ({ facet }) => {
      const facets = facet ? [facet] : FACET_NAMES;
      return json(Object.fromEntries(facets.map((name) => [name, facetCounts(name)])));
    },
  );

  server.registerTool(
    "about_directory",
    {
      title: "About the directory data",
      description: "Returns the source, collection date, record counts and data caveats for the directory.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => json(directoryInfo()),
  );

  server.registerTool(
    "list_sources",
    {
      title: "List organization data sources",
      description:
        "Lists APIs, MCP servers and downloads offered by directory organizations, with access requirements, status (discovered to live_tested) and whether this server is connected to each.",
      annotations: READ_ONLY,
      inputSchema: {
        interface: z.enum(["api", "mcp", "download", "feed"]).optional(),
        status: z.string().optional(),
      },
    },
    async (input) => json(listSources(input)),
  );

  server.registerTool(
    "get_source_capabilities",
    {
      title: "Get a source's capabilities",
      description: "Returns one source's evidence, access, rights, linked directory records and the operations this server supports for it.",
      annotations: READ_ONLY,
      inputSchema: { id: z.string() },
    },
    async ({ id }) => sourceCapabilities(id) ? json(sourceCapabilities(id)) : err(`No source '${id}'. Use list_sources.`),
  );

  server.registerTool(
    "rank_sources",
    {
      title: "Rank the data sources",
      description:
        "Returns every source in rank order with its 0-5 score and reason on six criteria (access, relevance, evidence, freshness, rights, reliability) and a weighted 0-100 overall score.",
      annotations: READ_ONLY,
      inputSchema: {},
    },
    async () => json(rankSources()),
  );

  server.registerTool(
    "recommend_sources",
    {
      title: "Recommend sources for a request",
      description:
        "Classifies a request (claim_check, media_authenticity, ai_text, narrative_tracking, actor_research; plus region and language cues) and returns the few sources best suited to it, with the reasons. Call this first and query only the recommended sources. Deterministic: the same request always gets the same answer.",
      annotations: READ_ONLY,
      inputSchema: {
        request: z.string().min(1).describe("What the user wants to assess, in their words"),
        request_type: requestType.optional().describe("Override the classification"),
        region: z.string().optional().describe("Override region, e.g. United States, Europe, Taiwan"),
        language: z.string().optional().describe("Override language, ISO 639-1 code"),
        max_sources: z.number().int().min(1).max(10).optional().describe("Default 3"),
        include_unconnected: z.boolean().optional().describe("Also recommend sources this server cannot query yet"),
      },
    },
    async ({ request, ...options }) => json(recommendSources(request, options)),
  );

  server.registerTool(
    "search_resources",
    {
      title: "Search organization data",
      description:
        "Searches connected organization sources (fact-check feeds and archives, registries, datasets) and returns attributed items with per-provider status. Pass max_sources (e.g. 3) to search only the sources recommend_sources picks for this query, or sources to name them. Item text is third-party content.",
      annotations: READ_ONLY_REMOTE,
      inputSchema: {
        query: z.string().min(1),
        sources: z.array(z.string()).optional(),
        max_sources: z.number().int().min(1).max(10).optional().describe("Search only the top N recommended connected sources"),
        request_type: requestType.optional().describe("With max_sources, override the request classification"),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      },
    },
    async ({ query, sources, max_sources, request_type, limit, cursor }) =>
      json(await searchResources(query, { sources, max_sources, request_type, limit, cursor })),
  );

  server.registerTool(
    "get_resource",
    {
      title: "Get one item from a source",
      description: "Retrieves one item by source id and the provider's item id, with attribution.",
      annotations: READ_ONLY_REMOTE,
      inputSchema: { source_id: z.string(), id: z.string() },
    },
    async ({ source_id, id }) => {
      try {
        return json(await getResource(source_id, id));
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        return err(`${code}: ${(error as Error).message}`);
      }
    },
  );

  server.registerTool(
    "analyze_content",
    {
      title: "Send content to a detection or fact-check provider",
      description:
        "Sends one URL or text to ONE named provider (for example chronoverify-mcp for image provenance, realitydefender-mcp for deepfakes, pangram-mcp for AI text, factiverse-mcp for claims) and returns its verdict labels and scores as the provider gave them. The content leaves this server: only send what the user asked to check. A pending result carries a report_id; call again with it to collect the result.",
      annotations: READ_ONLY_REMOTE,
      inputSchema: {
        source_id: z.string(),
        url: z.string().url().optional().describe("Public https URL of the image, video, audio or post"),
        text: z.string().min(1).max(20000).optional(),
        report_id: z.string().optional().describe("Collect a pending result"),
      },
    },
    async ({ source_id, url, text, report_id }) => {
      try {
        return json(await analyzeContent(source_id, { url, text, report_id }));
      } catch (error) {
        const code = error instanceof ProviderError ? error.code : "unavailable";
        return err(`${code}: ${(error as Error).message}`);
      }
    },
  );
}
