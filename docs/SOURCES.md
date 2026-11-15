# Source registry and adapters

`src/data/sources.json` lists the interfaces that directory organizations offer: APIs, MCP servers, downloads and feeds. It is seeded from the survey in issue #1 (dated 2026-11-12) and is maintained by hand.

## Status

Each source moves through `discovered → documentation_verified → access_approved → implemented → live_tested`. Only a recorded live smoke test (provider, date, access mode, operation, result, with no credentials or restricted content) moves a source to `live_tested`.

| Status | Sources |
|---|---|
| implemented | Cofacts GraphQL API (needs `COFACTS_APP_ID`) |
| discovered | 14 MCP offerings from the survey, CheckFirst RADAR API, EDMO exports, CORRECTIV sanctions data, Meedan Check API |

The survey's full classification of all 251 names (82 with API/MCP evidence, 25 download/feed only, 127 with none found, 17 unverified) lives in the survey document linked from issue #1 and is not yet imported.

## Adding an adapter

1. Add or update the source in `src/data/sources.json`, with primary-source evidence, access requirements, rights and `last_checked`.
2. Implement `Adapter` from `src/lib/adapters/types.ts`: `search` and/or `get`, returning `ResourceItem`s with the provider's own labels and an attribution statement. Throw `ProviderError` with a specific code for every failure.
3. Register it in `ADAPTERS` in `src/lib/sources.ts` and set the source's `adapter` field.
4. Add tests with a mocked `fetch` for success, missing credentials, HTTP errors, timeouts and malformed responses.
5. Run a live smoke test and record the result before changing the status to `live_tested`.

## Rules

- Read-only. No writes to any provider.
- Results carry the provider's labels; this server adds no truth judgment.
- A provider failure is reported per provider and never shown as "no results".
- Provider text is third-party content (`untrusted: true`).
- Credentials stay in server environment variables and are never returned.
- Website-only organizations are linked, not scraped.
