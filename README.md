# ASFAI Information Integrity

An ASFAI MCP server that gives AI assistants access to the organizations in the [Information Integrity Navigator](https://www.mitzinavigator.com/information-integrity/) and, where an organization offers one, to its data through a normalized, read-only interface.

> **Status:** Phase 1 of [issue #1](https://github.com/redbeard-26/information-integrity/issues/1). The directory and the source registry are in place; one API adapter (Cofacts) is implemented and unit-tested but not yet live-tested. No organization is claimed as integrated until a live smoke test is recorded.

```text
 Navigator directory (261 records)        Source registry (APIs, MCP servers, downloads)
          │                                          │
          ▼                                          ▼
 search_organizations · get_organization   list_sources · get_source_capabilities
 list_categories · about_directory         search_resources · get_resource ──► adapters (Cofacts, …)
```

## MCP tools

All tools are read-only.

| Tool | What it does |
|---|---|
| `search_organizations` | Keyword search plus exact filters: focus area, region, organization type, status, headquarters country, method, threat actor. Returns summaries. |
| `get_organization` | Full record by id or exact name, with mission, funders, website and source links. A duplicated name returns both source records. |
| `list_categories` | Filter values with record counts. |
| `about_directory` | Source, collection date, counts and caveats. |
| `list_sources` | APIs, MCP servers and downloads offered by directory organizations, with access requirements, status and whether this server is connected. |
| `get_source_capabilities` | One source's evidence, rights, linked directory records and supported operations. |
| `search_resources` | Searches every connected source and returns attributed items plus a per-provider status. A provider error means "not checked", never "no results". |
| `get_resource` | One item from a source, with attribution. |

Item text from providers is third-party content and is marked `untrusted: true`.

## Layout

The repository mirrors [asfai-education](https://github.com/redbeard-26/asfai-education): a Next.js service with a `mcp-handler` route, served under a base path so the main ASFAI site can present it.

```text
src/app/api/[transport]/route.ts     MCP endpoint (/information-integrity/api/mcp)
src/app/api/organizations/route.ts   JSON search endpoint for the directory
src/lib/directory.ts                 Directory search, facets and lookups
src/lib/sources.ts                   Source registry, unified search and retrieval
src/lib/adapters/                    Provider adapters (types.ts, cofacts.ts)
src/data/organizations.json          Directory records (generated)
src/data/sources.json                Source registry (hand-maintained, see docs/SOURCES.md)
scripts/build-data.mjs               Builds organizations.json from collected JSONL
scripts/scrape-navigator.mjs         Refreshes the JSONL from the live Navigator
plugins/asfai-information-integrity  Claude/Codex plugin: one remote connector and one skill
```

## Development

```bash
npm install
npm run dev      # http://localhost:3000/information-integrity
npm test
npm run lint
npm run build
```

Point an MCP client at `http://localhost:3000/information-integrity/api/mcp`.

## Configuration

| Variable | Needed for |
|---|---|
| `COFACTS_APP_ID` | Cofacts adapter. Issued by the Cofacts working group on request (see their LEGAL.md). Without it the source is reported as `not_configured`. |
| `COFACTS_APP_ID_HEADER` | Optional; defaults to `x-app-id`. |
| `COFACTS_ENDPOINT` | Optional; defaults to `https://cofacts-api.g0v.tw/graphql`. |

Credentials stay server-side and are never returned by a tool.

## Deployment

Not deployed. Like the education service, the image from `Dockerfile` is meant to run on the shared ASFAI host with `/information-integrity/*` rewritten to it from the main site. The plugin's `.mcp.json` assumes `https://constitution.asfai.org/information-integrity/api/mcp`.

## Data and rights

See [docs/DATA.md](docs/DATA.md), [docs/SOURCES.md](docs/SOURCES.md) and [NOTICE](NOTICE). The Navigator does not state reuse terms for its records; confirm them before relying on redistribution. Each provider's API and data terms are tracked per source in `src/data/sources.json`.
