# Source registry and adapters

`src/data/sources.json` lists the interfaces that directory organizations offer: APIs, MCP servers, downloads and feeds. It was seeded from the survey in issue #1 (dated 2026-11-12) and extended on 2026-11-15 with fact-checkers' public feeds and endpoints confirmed against each provider's own documentation. It is maintained by hand. Each source carries its evidence, access requirements, rights, a [ranking](RANKING.md) and a [routing fit](ROUTING.md).

## Status

Each source moves through `discovered → documentation_verified → access_approved → implemented → live_tested`. Only a recorded live smoke test (date, access mode, operation, result, with no credentials or restricted content) moves a source to `live_tested`. Run them with `LIVE_SMOKE=1 npx vitest run tests/live.test.ts`.

The build environment's network proxy only reaches GitHub, so CORRECTIV is the only source live-tested so far. The other keyless endpoints were confirmed to answer on 2026-11-15 by fetching them directly, but the adapters have not yet run against them; they stay `implemented` until `tests/live.test.ts` passes from a host with open network access.

## Keyless adapters (work with no configuration)

| Source | Operations | Notes |
|---|---|---|
| `correctiv-sanctions` | search, get | Live-tested. Sanctions list (about 34,000 entries) from CORRECTIV's public repository, MIT licence. Data ends in 2024. |
| `fara-efile-api` | search, get | US DOJ FARA registrants and their foreign principals. Public domain. The adapter stays under the 5-requests-per-10-seconds limit and caches the registrant list for an hour. |
| `checkfirst-radar-api` | search, get | DSA infringement typology, CC BY 4.0. Sends a descriptive User-Agent as the API requires. |
| `chronoverify-mcp` | analyze (image URL) | Keyless evaluation with a per-IP limit. Optional `CHRONOVERIFY_API_KEY` raises it. |
| 9 fact-check feeds | search, get | FactCheck.org, Full Fact, Lead Stories, Maldita.es, Alt News, BOOM, Aos Fatos, StopFake, DUBAWA. Latest items only; headline, link, date and a 300-character excerpt (Full Fact: no excerpt). |

## Adapters that need credentials

Without its credential a source is reported as `not_configured` and no request is sent.

| Source | Required | Optional | How to get it |
|---|---|---|---|
| `cofacts-graphql` | `COFACTS_APP_ID` | `COFACTS_APP_ID_HEADER`, `COFACTS_ENDPOINT` | Request from the Cofacts working group (LEGAL.md section 3) |
| `factiverse-mcp` | `FACTIVERSE_TOKEN` | `FACTIVERSE_ENDPOINT` | From Factiverse; no self-serve signup documented. The default endpoint is inferred from their docs and should be confirmed with the token. |
| `meedan-check-api` | `CHECK_API_TOKEN`, `CHECK_TEAM_SLUG` | `CHECK_API_ENDPOINT` | A Check workspace owner. Search only; the adapter never sends mutations. |
| `aiornot-mcp` | `AIORNOT_API_KEY` | `AIORNOT_ENDPOINT` | Self-serve paid plan |
| `realitydefender-mcp` | `REALITY_DEFENDER_API_KEY` | `REALITY_DEFENDER_ENDPOINT` | Self-serve; free plan covers images only |
| `pangram-mcp` | `PANGRAM_API_KEY` | `PANGRAM_ENDPOINT`, `PANGRAM_MODEL` | Self-serve paid credits |
| `deepmedia-api` | `DEEPMEDIA_API_KEY` | `DEEPMEDIA_ENDPOINT` | On request. Submission by URL (`webLocation`) is not confirmed in public docs. |
| `blackbird-mcp` | `BLACKBIRD_CLIENT_KEY`, `BLACKBIRD_SECRET_KEY` | `BLACKBIRD_ENDPOINT`, `BLACKBIRD_TOKEN_URL` | Commercial Compass contract |

### Provider MCP servers (generic adapter)

These providers publish an MCP server but no public tool schema. `src/lib/adapters/remote-mcp.ts` calls one configured tool and maps its answer to items from common field names. Each needs `PREFIX_MCP_URL`, `PREFIX_API_KEY` (except GoPie) and `PREFIX_SEARCH_TOOL`; `PREFIX_AUTH_HEADER` (key header, default `Authorization: Bearer`) and `PREFIX_QUERY_ARG` (default `query`) are optional. They stay `discovered` until a customer configures one and runs the live test.

| Source | Prefix | Access |
|---|---|---|
| `euvsdisinfo` | `EUVSDISINFO` | Credentials by email request to EUvsDisinfo |
| `alethea-mcp` | `ALETHEA` | Commercial |
| `peakmetrics-mcp` | `PEAKMETRICS` | Commercial |
| `meltwater-mcp` | `MELTWATER` | Commercial |
| `recordedfuture-mcp` | `RECORDEDFUTURE` | Commercial |
| `signalai-integrations` | `SIGNALAI` | Commercial |
| `gopie-mcp` | `GOPIE` | Self-hosted; no key |

## Detection results

`analyze_content` sends a URL or text to a detection or verification service. The content leaves this server. Results are the provider's model output (`scores`, `original_labels`), not a finding of fact. Slow providers return `state: "pending"` with a `report_id`; call again with that `report_id` to collect the result. Media URLs are fetched only over https from public hosts, with size and type limits and no redirects.

## Not connected

| Source or provider | Why |
|---|---|
| EDMO fact-check archive | No API or feed; listed for routing and linked only |
| PolitiFact | Publishes a feed, but its terms forbid redisplaying content |
| Snopes, Africa Check, Chequeado, AFP Fact Check, Misbar, Rappler, VERA Files, Logically, Newschecker, PesaCheck | No working public feed confirmed on 2026-11-15 |

Google's Fact Check Tools API (free key) aggregates ClaimReview markup from many of these publishers. It is not a directory organization, so it is not in the registry, but it is the most direct way to add their fact-checks later.

## Adding an adapter

1. Add or update the source in `src/data/sources.json`, with primary-source evidence, access requirements, rights, `last_checked`, `fit` and `ranking` (one reason per score).
2. Implement `Adapter` from `src/lib/adapters/types.ts` (`search`, `get` and/or `analyze`) and throw `ProviderError` with a specific code for every failure.
3. Register it in `src/lib/adapters/index.ts` and set the source's `adapter` field.
4. Add tests with a mocked `fetch` (see `tests/helpers.ts`) for success, missing credentials and malformed answers.
5. Regenerate the table in `docs/RANKING.md` with `node scripts/rank-sources.mjs`.
6. Run the live smoke test and record it in `smoke_tests` before changing the status to `live_tested`.

## Rules

- Read-only. No writes to any provider.
- Results carry the provider's labels; this server adds no truth judgment.
- A provider failure is reported per provider and never shown as "no results".
- Provider text is third-party content (`untrusted: true`).
- Credentials stay in server environment variables and are never returned.
- Website-only organizations are linked, not scraped.
