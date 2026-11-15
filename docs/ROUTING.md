# Source routing

`recommend_sources` picks a small set of sources for a request so that a client queries a few relevant sources instead of all of them. `search_resources` uses the same routing when called with `max_sources` and no `sources` list. Routing is deterministic: the same request, configuration and registry give the same answer, and every point in the result comes with a reason. The code is in `src/lib/recommend.ts`; each source's `fit` in `src/data/sources.json` declares what it serves.

## Step 1: classify the request

The request text is lower-cased and matched against keyword cues. Cues match whole words, so "eu" does not match inside "eutopia". A caller can skip classification by passing `request_type`, `region` or `language`.

| Request type | What it covers | Example cues |
|---|---|---|
| `claim_check` | A factual claim, rumour, quote or statistic | claim, true, false, rumor, hoax, debunk, misleading, viral, forwarded, scam |
| `media_authenticity` | Whether an image, video or audio clip is authentic, AI-generated or manipulated | image, photo, video, audio, deepfake, doctored, provenance, c2pa, .jpg, .mp4 |
| `ai_text` | Whether text was written by AI | written by ai, chatgpt, llm, generated text, essay |
| `narrative_tracking` | A narrative, campaign or trend and how it spreads | narrative, campaign, coordinated, inauthentic, bots, hashtag, propaganda, track |
| `actor_research` | Who is behind content: state actors, foreign agents, sanctioned entities | who is behind, state media, foreign agent, fara, lobbying, sanctioned, oligarch, ownership |

The type with the most matching cues gets weight 1; other matched types get 0.5 (or 1 if tied). A request with no cue defaults to `claim_check` and is marked `defaulted: true`.

Regions: United States, United Kingdom, Europe, Russia and Ukraine, Taiwan, China, India, Latin America, Spain, Middle East and North Africa, Africa, Philippines, each with place names and other cues. Languages: zh, ar, ru and hi are also detected from script; es, pt and fr from language names. The full cue lists are in `src/lib/recommend.ts`.

## Step 2: score each source

Sources that fit none of the request's types are dropped. The rest are scored:

| Factor | Points |
|---|---|
| Primary source for a request type | +50 × type weight |
| Secondary source for a request type | +20 × type weight |
| Covers a region named in the request | +20 per region |
| Regional source that covers none of the named regions | −25 |
| Works in the request's language (sources marked `*` are language-independent and skip this) | +15 |
| Does not cover the request's language | −15 |
| Overall ranking score (0–100, see [RANKING.md](RANKING.md)) | × 0.3, so up to +30 |
| Connected and queryable on this server now | +15 |

Results sort by points, then id. By default only connected sources are returned (`max_sources`, default 3, at most 10). Higher-scoring sources that are not connected are listed separately under `better_sources_not_connected`, with the credential each one needs, so an operator can see what configuring them would add. `include_unconnected: true` ranks all sources together.

## Examples (default configuration, no credentials set)

| Request | Classified as | Recommended | Better but not connected |
|---|---|---|---|
| Is the claim that the NHS waiting list doubled in Britain true? | claim_check, United Kingdom | Full Fact (110.2), Lead Stories (92.3), FactCheck.org (68.2) | none above Full Fact |
| Check this image https://example.org/flood.jpg | media_authenticity | ChronoVerify (89), FactCheck.org, Alt News | Reality Defender, AI or Not, Deep Media |
| Is this Russian outlet sanctioned or a registered foreign agent? | actor_research, Russia and Ukraine | CORRECTIV sanctions (109), FARA eFile (67) | none |
| Is this LINE message rumor from Taiwan true? (with `include_unconnected`) | claim_check, Taiwan | Cofacts (93.7), Lead Stories, Meedan Check | n/a |
| Was this essay written by ChatGPT? | ai_text | nothing connected | Pangram, AI or Not |
| Is this hashtag campaign about the election coordinated? | narrative_tracking | StopFake, CheckFirst RADAR | EUvsDisinfo, Blackbird.AI, Alethea |

`tests/recommend.test.ts` checks these routes.

## Limits

- Keyword classification is simple by design: it is predictable and explainable, but it can miss a request phrased without any cue. Callers that know the request type should pass `request_type`.
- A fact-check feed only covers the provider's latest items, so a feed being recommended does not mean it holds an answer. `search_resources` reports per source whether it was checked and what it found.
- Results are each provider's own labels. This server adds no verdict.
