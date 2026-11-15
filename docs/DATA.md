# Directory data

`src/data/organizations.json` holds every record shown by the [Information Integrity Navigator](https://www.mitzinavigator.com/information-integrity/), which presents the "Navigator Export.xlsx" workbook: 261 source records, 251 distinct names, 10 duplicate-name groups. All original record ids are kept.

## Record fields

| Field | Meaning |
|---|---|
| `id` | Original record id from the workbook |
| `name`, `organization_type`, `operating_status` | As shown in the source |
| `geographic_focus` | One region, or two separated by `; ` (for example `Europe; North America`) |
| `headquarters_country`, `countries_of_focus`, `languages` | As shown; `null` where the source says "Not provided in source" |
| `mission`, `why_included`, `funders` | Source text, verbatim |
| `focus_areas`, `methods`, `threat_actors` | Source chips |
| `website`, `source_links` | Links from the record page |
| `verification_status`, `last_verified` | Source labels (all "Internet Research Only", 8–9 Aug 2026) |
| `source_workbook_row` | Row in the source workbook |
| `duplicate_name` | `true` when the source has two records with this name |
| `extra` | Other labelled text on the record page: `acronym`, `duplicate_notice`, `duplicate_other_record_id`, `status_conflict_notice`, `list_card_badge` |

Descriptions, classifications, funding statements and operating statuses are claims from the source. No independent verification has been done.

## Refreshing

The Navigator renders its directory in the browser, so collection uses a browser.

1. `npm install --no-save playwright && npx playwright install chromium`
2. `npm run data:scrape` writes `data/raw/navigator.jsonl`.
3. `npm run data:build -- data/raw --collected-at YYYY-MM-DD` validates the records, merges duplicates seen under more than one region, recomputes the counts and rewrites `src/data/organizations.json`.
4. `npm test` checks the counts against the source (update the expected counts if the Navigator changes).

The first collection (2026-11-15) was done with a browser agent reading each record page; `scrape-navigator.mjs` follows the same page structure but has not been run against the live site yet.
