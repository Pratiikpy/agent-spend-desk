# Profile: Portkey-AI/gateway (routing and guardrail gateway; money handling is mostly NOT in this repo)

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT (gh api; `LICENSE` of the companion pricing repo also MIT). Stars 13,231; last commit read 669825c, 2026-05-25 (gh api). Companion repo `Portkey-AI/models`: MIT, 143 stars, last commit 44e1204, 2026-10-19. Read at HEAD without cloning.

## 1. What it is
A small TypeScript (Hono) gateway that routes OpenAI-shaped calls to 1,600+ models with retries, fallbacks, load balancing, caching and request/response guardrail hooks. The budget, virtual-key and analytics features are sold in the hosted and enterprise versions, not here.

## 2. Architecture map
`src/index.ts` and `src/handlers/*Handler.ts` (one per API surface), `src/handlers/retryHandler.ts`, `src/handlers/services/{cacheService,hooksService,logsService}.ts`, `src/middlewares/{cache,hooks,log,requestValidator}`, `src/services/conditionalRouter.ts`, `src/shared/services/cache/backends/{memory,file,redis,cloudflareKV}.ts`, and `plugins/default/*.ts` for guardrail checks. Config is a JSON "Config" validated by zod (`src/middlewares/requestValidator/schema/config.ts`).

## 3. Features and how each behaves
- Routing: strategy mode is one of `single`, `loadbalance`, `fallback`, `conditional` (`config.ts:14-28`); targets carry `weight` (:77) and `on_status_codes` (:28, :78). Conditional routing matches request metadata or params with operators such as `$eq`, `$gt`, `$in`, `$regex` (`src/services/conditionalRouter.ts:15-25`).
- Retry: `attempts`, `on_status_codes`, `use_retry_after_header` (`config.ts:67-71`); the retry loop honours provider `retry-after` and skips the retry if the wait exceeds the cap (`retryHandler.ts:84, 108-134`).
- Cache: mode `simple` or `semantic`, `max_age` (`config.ts:53-61`); status reported as HIT, MISS or DISABLED (`cacheService.ts:54`). Semantic cache is hosted or enterprise only (`README.md:207, 296`).
- Hooks: `before_request_hooks`, `after_request_hooks`, `input_guardrails`, `output_guardrails` (`config.ts:97-111`). A hook only denies if its verdict is false AND the hook is marked `deny` AND it was not skipped (`src/middlewares/hooks/index.ts:265-268`).

## 4. How people use it
`npx @portkey-ai/gateway` runs it locally on port 8787 (`README.md:70-74`); point an OpenAI client at it with a config header. Issues and reviews: NOT VERIFIED.

## 5. Mechanism for the Desk (where money is counted, and what this repo lacks)
There is no budget, spend table or cost computation in the gateway source I listed: the tree has no budget or cost files outside `src/providers` and the README (`gh api` tree filter; a code search through the API was refused, 404, so the absence is from the file listing and README, not a full-text grep: NOT VERIFIED for provider adapters). The README says budgets, virtual keys and usage analytics sit in the hosted and enterprise product (`README.md:202-209, 292-300`).

What it does publish is the price book, as data, in a separate repo (`README.md:222-223`; `Portkey-AI/models/README.md:17`).
- Unit trap: prices are in cents per token, not dollars (`models/README.md:62-74`).
- Schema: `pay_as_you_go` rates for `request_token`, `response_token`, `cache_write_input_token`, `cache_read_input_token`, audio tokens, image, and `additional_units` such as `web_search`, `file_search`, `thinking_token`, `video_seconds`, plus `currency` (`models/README.md:78-142`).
- The formula is data too: `pricing/*.json` carries a `calculate` expression tree (sum and multiply over `input_tokens`, `cache_write_tokens`, `cache_read_tokens` times `rates.*`), so a new price shape needs no code release (`pricing/anthropic.json`, head of file).
- Freshness: community pull requests and a "Pricing Update" issue template that asks for a source URL (`models/.github/ISSUE_TEMPLATE/pricing-update.yml`), a CI check that only validates JSON syntax (`models/.github/workflows/validate-json.yml`), and a sync to S3. Whether prices are checked against provider pages: NOT VERIFIED.
- Estimated versus billed: the OSS gateway logs to the console and an SSE feed with headers redacted and a 100,000-character response cap (`src/middlewares/log/index.ts:5, 18-19`); no billed figure is reconciled anywhere I could read.

## 6. Agent patterns
None. Fallback and conditional routing are static config; `modelRules.ts` maps request metadata to allowed models (`plugins/default/modelRules.ts:41-70`), and `requiredMetadataKeys.ts` rejects calls missing metadata keys, which is the hook for attributing spend to a team or task.

## 7. Model and data layer
Provider adapters under `src/providers`, a generated `src/data/models.json` and `providers.json` list of ids with no prices.

## 8. Hackathon-care checks
One-command run, no database. Logs are not a durable ledger. Secrets are redacted in logs (`log/index.ts:18-38`).

## 9. Traps seen
Hook errors fail open: if hook execution throws, `executeHooks` returns `shouldDeny: false` (`hooks/index.ts:271-274`), so a broken guardrail lets traffic through. Pricing in cents is easy to misread by 100x. The README's cost features are mostly not in the open code.

## 10. Reuse
MIT: the price data and the `calculate` schema may be reused with credit; the gateway code is not needed.

## 11. Verdict: ADAPT (the price-book format only)
Copy: (1) prices and the cost formula as versioned data with a currency field; (2) a metadata-required hook so every call carries owner and task labels; (3) `retry-after`-aware retry with a hard cap.
Avoid: (1) fail-open guardrails; (2) cents-per-token units; (3) a price repo whose CI checks syntax but not truth.
