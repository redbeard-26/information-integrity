# Real provider payloads

Responses captured from each provider's public endpoint on 2026-11-15, opened in a cloud browser because the build environment's network proxy refuses these hosts. `tests/real-payloads.test.ts` runs the adapters on them.

| File | Endpoint | Notes |
|---|---|---|
| factcheck.xml | https://www.factcheck.org/feed/ | First 44 KB of a 250 KB feed |
| fullfact.xml | https://fullfact.org/feed/ | Complete |
| leadstories.xml | https://leadstories.com/atom.xml | Rebuilt from the browser's XML tree view; first 3 entries |
| maldita.xml | https://maldita.es/malditobulo/feed/ | Rebuilt from the browser's XML tree view; first 6 items |
| altnews.xml | https://www.altnews.in/feed/ | First 44 KB |
| boom.xml | https://www.boomlive.in/google_feeds.xml | Rebuilt from the browser's XML tree view; complete |
| aosfatos.xml | https://www.aosfatos.org/noticias/feed/ | First 44 KB |
| stopfake.xml | https://www.stopfake.org/en/feed/ | Complete |
| dubawa.xml | https://dubawa.org/feed/ | Complete; the provider's text is double-encoded as published |
| fara-registrants.json | https://efile.fara.gov/api/v1/Registrants/json/Active | First 212 of the active registrants |
| fara-principals.json | https://efile.fara.gov/api/v1/ForeignPrincipals/json/Active/7519 | Complete |

Article bodies longer than 700 characters are cut and marked `[trimmed]`, so the fixtures keep each feed's structure without republishing the providers' articles. Headlines, links and dates are as published.
