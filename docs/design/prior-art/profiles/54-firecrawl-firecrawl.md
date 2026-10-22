# Profile: firecrawl/firecrawl

Reader: Haiku (low effort), 2026-10-16, about 97 seconds, 91k tokens, 36 tool calls. Shallow clone (depth 1) (deleted after the profile pass). Paths relative to `apps/api/src/` unless stated. **AGPL-3.0: mechanism only, no code is copied or reproduced.**

Spot-check (reviewer, against the files): GNU AGPL 3.0 text (confirmed); `scraper/scrapeURL/retryTracker.ts`, `lib/robots-txt.ts` and `lib/threat-protection/index.ts` exist (confirmed). The engine fallback order, the retry categories, the model choice for extraction (a smaller model by default, a larger one for recursive schemas), the claim of "96% web coverage" and the line numbers are the reader's account and were not rechecked. Result: PASS on licence and file existence; the rest unverified.

## 1. What it is
A web data API: scrape one URL to markdown or structured JSON, crawl a site, map its URLs, batch-scrape, and extract fields against a schema with a model. AGPL-3.0 (the hosted product is commercial).

## 2. Architecture map
Controllers for the endpoints; a scrape coordinator that builds a list of engines per URL and falls back through them; two job queue back ends; a worker pool with a per-team semaphore; webhooks on completion; a robots.txt check; an optional threat check on URLs; spans and a zero-retention mode.

## 3. Features and how each behaves
Scrape returns a document. Crawl discovers URLs from sitemaps, robots and links, then scrapes each asynchronously. Map returns discovered URLs. Extract converts to markdown, then asks a model for JSON that matches a schema. Timeouts are per request, bounded by each engine's maximum reasonable time.

## 4. How people use it
An API key and a POST with the URL and formats; poll for crawl status; batch by array of URLs. Self-hosting through containers and Helm charts. Tests exist for scraping and for search schema. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M1 live-web channel)
The scrape coordinator tries engines in order with a timeout each and a retry tracker that keeps a total attempt limit plus a budget per failure category (for example a missing feature, a bot wall on a PDF). Pre-flight gates: robots rules and an optional URL threat check, plus blocking of local IP ranges in the request validation (SSRF). Markdown conversion is done by a native library. Lost: the retry categories are enumerated in code, so a new error type needs a code change; exhausting the budget throws and does not emit its own telemetry (reader's account).

## 6. Agent patterns
None: single pass with deterministic fallback; asynchronous jobs.

## 7. Model and data layer
One hosted model family for extraction, chosen by schema complexity; many scraping engines; Redis for queues and crawl tracking; FoundationDB for an index cache.

## 8. Hackathon-care checks
Spans with a zero-data-retention option; container images per worker type; a mock loader for tests; no benchmark data in the repository; no standalone sample mode.

## 9. Traps seen
An unfinished type-handling comment in the extraction code; a coverage claim in the README without evidence in the code; the threat check is tied into the scrape flow.

## 10. Reuse
AGPL-3.0: no copying. Re-implement the ideas; do not read-and-transcribe. Respect robots rules and site terms when we fetch.

## 11. Verdict: REFERENCE ONLY for the M1 live-web channel (optional)
Copy (as ideas): (1) an ordered list of fetch engines with a timeout each and a total retry budget that is also split by failure category; (2) pre-flight gates: robots, allow and block lists, private-address blocking, a threat check; (3) extraction against a schema where the schema, not the model, defines what a valid answer looks like, and the verified quote still has to exist in the page text.
Avoid: (1) code reuse; (2) a coverage claim we cannot measure; (3) letting a model-extracted field become evidence without a quote check.
Where we are already ahead: every fetched page is stored with a hash and text layer, so a citation can be re-opened offline.
