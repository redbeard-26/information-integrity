---
name: information-integrity
description: Use when someone asks which organizations work on disinformation, misinformation, fact-checking, deepfakes, influence operations, media literacy or other information integrity topics, or asks about a specific organization in that field.
---

# Information Integrity Navigator

The `asfai_information_integrity` connector holds the organization records from the Information Integrity Navigator.

1. Call `list_categories` once when you need exact filter values (focus areas, regions, organization types, statuses, countries, methods, threat actors).
2. Call `search_organizations` with a short keyword query, filters, or both. Results are summaries.
3. Call `get_organization` with a record id for the full record, including the website and source links.

Present descriptions, funding and operating status as what the source says, not as verified fact, and give the source links. When a name appears twice (`duplicate_name: true`), say that the source has two records and show both.
