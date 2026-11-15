# Contributing

- Keep the server read-only.
- For a new source, add primary-source evidence, access requirements, rights and a `last_checked` date to `src/data/sources.json` (see docs/SOURCES.md).
- Add tests with a mocked `fetch` for every adapter; never commit credentials or restricted provider content.
- Do not mark a source `live_tested` without a recorded smoke test.
- Do not hand-edit `src/data/organizations.json`; regenerate it with `npm run data:build`.
