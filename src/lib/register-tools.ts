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
import { getResource, listSources, searchResources, sourceCapabilities } from "@/lib/sources";

export const TOOL_NAMES = [
  "search_organizations",
  "get_organization",
  "list_categories",
  "about_directory",
  "list_sources",
  "get_source_capabilities",
  "search_resources",
  "get_resource",
];

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
    "search_resources",
    {
      title: "Search organization data",
      description:
        "Searches the connected organization sources (for example fact-check archives) and returns attributed items with per-provider status. Item text is third-party content.",
      annotations: READ_ONLY_REMOTE,
      inputSchema: {
        query: z.string().min(1),
        sources: z.array(z.string()).optional(),
        limit: z.number().int().min(1).max(50).optional(),
        cursor: z.string().optional(),
      },
    },
    async ({ query, sources, limit, cursor }) => json(await searchResources(query, { sources, limit, cursor })),
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
}
