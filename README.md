# ASFAI Information Integrity

An ASFAI MCP server that gives AI assistants access to the organizations in the [Information Integrity Navigator](https://www.mitzinavigator.com/information-integrity/) and, where an organization offers one, to its data through a normalized, read-only interface.

> **Status:** Phase 2 of [issue #1](https://github.com/redbeard-26/information-integrity/issues/1). The registry holds 29 sources, each ranked on six criteria. 28 have adapters: 13 work with no credentials and 15 need a provider credential. One (CORRECTIV) is live-tested; the rest are unit-tested and wait for a live smoke test from a host with open network access. No organization is claimed as integrated until a live smoke test is recorded.

```text
 Navigator directory (261 records)        Source registry (APIs, MCP servers, downloads)
          │                                          │
          ▼                                          ▼
 search_organizations · get_organization   list_sources · get_source_capabilities · rank_sources
 list_categories · about_directory         recommend_sources ─► search_resources · get_resource
                                                              └► analyze_content ──► 28 adapters
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
| `rank_sources` | Every source in rank order, with its 0-5 score and reason on six criteria and a 0-100 overall score. See [docs/RANKING.md](docs/RANKING.md). |
| `recommend_sources` | Classifies a request (claim, media, AI text, narrative, actor; region; language) and returns the few connected sources that fit best, with reasons, plus better sources that are not connected. See [docs/ROUTING.md](docs/ROUTING.md). |
| `search_resources` | Searches connected sources and returns attributed items plus a per-provider status. With `max_sources`, searches only the recommended sources. A provider error means "not checked", never "no results". |
| `get_resource` | One item from a source, with attribution. |
| `analyze_content` | Sends a URL or text to one detection or verification source and returns its own labels and scores. The content leaves this server. Slow providers return a `report_id` to collect the result later. |

Item text from providers is third-party content and is marked `untrusted: true`.

## Layout

The repository mirrors [asfai-education](https://github.com/redbeard-26/asfai-education): a Next.js service with a `mcp-handler` route, served under a base path so the main ASFAI site can present it.

```text
src/app/api/[transport]/route.ts     MCP endpoint (/information-integrity/api/mcp)
src/app/api/organizations/route.ts   JSON search endpoint for the directory
src/lib/directory.ts                 Directory search, facets and lookups
src/lib/sources.ts                   Source registry, ranking, recommendation, unified search and retrieval
src/lib/ranking.ts                   Ranking criteria, weights and overall score
src/lib/recommend.ts                 Request classification and source scoring
src/lib/adapters/                    Provider adapters (one file per provider, feeds, generic MCP client)
src/data/organizations.json          Directory records (generated)
src/data/sources.json                Source registry (hand-maintained, see docs/SOURCES.md)
scripts/build-data.mjs               Builds organizations.json from collected JSONL
scripts/scrape-navigator.mjs         Refreshes the JSONL from the live Navigator
scripts/rank-sources.mjs             Prints the ranking table for docs/RANKING.md
plugins/asfai-information-integrity  Claude/Codex plugin: one remote connector and one skill
```

## Development

```bash
npm install
npm run dev      # http://localhost:3000/information-integrity
npm test
LIVE_SMOKE=1 npx vitest run tests/live.test.ts   # live smoke tests of keyless sources
npm run lint
npm run build
```

Point an MCP client at `http://localhost:3000/information-integrity/api/mcp`.

## Configuration

Keyless sources (9 fact-check feeds, FARA, CheckFirst RADAR, ChronoVerify, CORRECTIV) need no configuration. Every other source is reported as `not_configured` until its variables are set:

| Source | Required variables |
|---|---|
| Cofacts | `COFACTS_APP_ID` |
| Factiverse | `FACTIVERSE_TOKEN` |
| Meedan Check | `CHECK_API_TOKEN`, `CHECK_TEAM_SLUG` |
| AI or Not | `AIORNOT_API_KEY` |
| Reality Defender | `REALITY_DEFENDER_API_KEY` |
| Pangram | `PANGRAM_API_KEY` |
| Deep Media | `DEEPMEDIA_API_KEY` |
| Blackbird.AI | `BLACKBIRD_CLIENT_KEY`, `BLACKBIRD_SECRET_KEY` |
| EUvsDisinfo, Alethea, PeakMetrics, Meltwater, Recorded Future, Signal AI, GoPie | `PREFIX_MCP_URL`, `PREFIX_API_KEY` (not GoPie), `PREFIX_SEARCH_TOOL` |

Optional endpoint overrides and the provider MCP prefixes are listed in [docs/SOURCES.md](docs/SOURCES.md). Credentials stay server-side and are never returned by a tool.

## Deployment

Not deployed. Like the education service, the image from `Dockerfile` is meant to run on the shared ASFAI host with `/information-integrity/*` rewritten to it from the main site. The plugin's `.mcp.json` assumes `https://constitution.asfai.org/information-integrity/api/mcp`.

## Data and rights

See [docs/DATA.md](docs/DATA.md), [docs/SOURCES.md](docs/SOURCES.md) and [NOTICE](NOTICE). The Navigator does not state reuse terms for its records; confirm them before relying on redistribution. Each provider's API and data terms are tracked per source in `src/data/sources.json`.
