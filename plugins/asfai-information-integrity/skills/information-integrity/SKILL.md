---
name: information-integrity
description: Use when someone asks which organizations work on disinformation, misinformation, fact-checking, deepfakes, influence operations, media literacy or other information integrity topics, asks about a specific organization in that field, or wants to check a claim, image, video, text or narrative against those organizations' own data.
---

# Information Integrity Navigator

The `asfai_information_integrity` connector holds the organization records from the Information Integrity Navigator and, where an organization offers one, read-only access to its data.

## Finding organizations

1. Call `list_categories` once when you need exact filter values (focus areas, regions, organization types, statuses, countries, methods, threat actors).
2. Call `search_organizations` with a short keyword query, filters, or both. Results are summaries.
3. Call `get_organization` with a record id for the full record, including the website and source links.

Present descriptions, funding and operating status as what the source says, not as verified fact, and give the source links. When a name appears twice (`duplicate_name: true`), say that the source has two records and show both.

## Assessing a piece of information

1. Call `recommend_sources` with the person's request in their words. It returns the few connected sources that fit best, with the reasons. Pass `request_type`, `region` or `language` when you already know them.
2. For claims, narratives and actors, call `search_resources` with `sources` set to the recommended ids (or with `max_sources` to let it choose). Keep queries short: a few distinctive words from the claim.
3. For an image, video or text, call `analyze_content` with one recommended detection source. Tell the person first that the content will be sent to that provider. If the result is `pending`, call again later with its `report_id`.
4. Report each provider's own labels and links, attributed to that provider. Do not turn them into a verdict of your own. A provider that errored was not checked; say so rather than reporting "no results".
5. If `better_sources_not_connected` lists a source, mention that it would fit but is not available on this server.

`rank_sources` explains how sources compare overall; use it when someone asks which sources are most reliable or useful.
