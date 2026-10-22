# Profile: Helicone/helicone (observability plus gateway; the only one here that pre-authorizes spend with a wallet)

Reader: Claude Sonnet, 2026-10-20. Licence read first: Apache-2.0 (`LICENSE:1-3`, gh api). Stars 6,227; last commit read 6b057cd, 2026-10-20 06:02 UTC. Read at HEAD without cloning (5,952 files).

## 1. What it is
A hosted-first LLM observability and AI-gateway platform whose code is public: Cloudflare Worker proxy and gateway, "jawn" Express API, ClickHouse for analytics, Supabase/Postgres for metadata, a Next.js web app. Wind-down: the repo does NOT say that. `README.md` presents it as an active product with a free tier; recent commits are titled "Sync fixes from upstream" and "Sync security fixes from private repo" (commits 6b057cd, 0d37ddd), which shows the public repo trails a private one. Any wind-down claim is NOT VERIFIED (a web search for it was attempted and the search tool failed with 401).

## 2. Architecture map
`worker/src/lib/ai-gateway/{AttemptBuilder,AttemptExecutor,SimpleAIGateway,WalletKVSync,DisallowListKVSync}.ts` (routing and billing), `worker/src/lib/durable-objects/Wallet.ts` (balance), `worker/src/lib/managers/{WalletManager,RateLimitManager}.ts`, `packages/cost/` (registry, usage processors, cost math), `valhalla/jawn/src/managers/{wallet,stripe,alert}`, `clickhouse/migrations/`.

## 3. Features and how each behaves
Logging by header or by gateway; sessions; rate-limit policies; alerts; prompt management; pass-through billing (PTB: Helicone holds the provider keys and bills you in credits) versus bring-your-own-key (BYOK), with BYOK tried first, then PTB, each sorted by cost (`packages/cost/FLOWS.md:16-28`).

## 4. How people use it
Change `baseURL` to `https://ai-gateway.helicone.ai` and use a Helicone key (`README.md:44-58`). Self-hosting via `docker/`. Usage evidence outside the repo: NOT VERIFIED.

## 5. Mechanism for the Desk
Where money is counted:
- Cost is computed per request from the provider's reported usage by a per-provider processor (`packages/cost/usage/{anthropic,openAI,bedrock,vertex,...}UsageProcessor.ts`; Anthropic stream usage is consolidated from `message_start` and `message_delta`, `anthropicUsageProcessor.ts:42-76`), then priced from a TypeScript model registry. Each endpoint entry has tiered pricing: `threshold`, `input`, `output`, `web_search`, and cache multipliers (`cachedInput: 0.1, write5m: 1.25, write1h: 2.0`, `packages/cost/models/authors/anthropic/claude-3.5-haiku/endpoints.ts:10-21`; type at `models/types.ts:132-151`).
- The tier test differs per provider: Anthropic compares input plus cached plus both cache writes, Vertex compares only input, Google AI Studio total prompt (`models/calculate-cost.ts:114-167`). Missing tier fields inherit from the previous tier (:42-94). Output is a breakdown: input, output, cached, 5m write, 1h write, thinking, per-modality, web search, per-request fee (:12-29, :195-286). A provider-supplied `modelUsage.cost` replaces the sum (:262-263).
- An unknown model returns `null`, not an error (`calculate-cost.ts:177-181`): the spend row then has no cost.
- Storage: costs are integers scaled by 1,000,000,000 (`packages/cost/costCalc.ts:6-8`); ClickHouse `organization_ptb_spend` is a SummingMergeTree fed by a materialized view over requests flagged `is_passthrough_billing` (`clickhouse/migrations/schema_72_ptb_spend_redo.sql`).

Enforcement point: BEFORE the call, by escrow, and only for PTB.
- `AttemptExecutor.reserveEscrow` reserves the worst case: context length times first-tier input price plus max completion tokens times first-tier output price (`AttemptExecutor.ts:506-529`), and refuses models with zero price, no context length or no max completion (:508-518). That is far coarser than litellm (which counts the actual input tokens).
- `Wallet.reserveCostInEscrow` runs in a Durable Object transaction: refuses if disputes are active (403), computes `credits - escrows - debits` plus an optional credit line, and returns 429 if the remainder after the reserve would be under one cent (`Wallet.ts:463-516`). Escrow rows carry a random id so a client cannot reuse a request id to dodge it (:518-528).
- After the call `finalizeEscrow` upserts the actual cost into `aggregated_debits`, deletes the escrow, and 1% of the time deletes escrows older than one hour (`Wallet.ts:534-620`). If the escrow failed but the call already ran optimistically from a cached balance, a direct debit is attempted unless the wallet is suspended (`WalletManager.ts:65-115`).
- Requests whose cost cannot be parsed add the provider and model to a `disallow_list` so later calls to that model are blocked (`Wallet.ts:33-45, 116-122, 173-184`; filled by `WalletManager.ts:137, 193`; read at gateway step 4, `SimpleAIGateway.ts:204`; cached in KV for one hour, `DisallowListKVSync.ts:25-29`). That is a good rule: stop spending where you cannot measure.
- Rate limits are policy strings `quota;w=window[;u=request|cents][;s=segment]`, so a limit can be in cents per window per user or per custom property (`worker/src/lib/util/rateLimitOptions.ts:19-45`).
There is no budget per team, key, project or task for BYOK traffic in what I read: NOT VERIFIED beyond the files listed.

Estimated versus billed: PTB is the only path where the amount charged is the amount computed. BYOK spend is an estimate from list price and reported tokens. Price freshness: hand-edited TypeScript, with fixes such as "anthroppci price fix" and "Fix cost calculation for claude-4.6-opus on OpenRouter" as commits (2026-03-19, 2026-03-26); `packages/buildPricesOpenRouter.py:18-29` pulls OpenRouter prices for one legacy table.

## 6. Agent patterns
`cc-agent/` and `FULL_AGENT_LOOP.md` exist; I did not read them. Not relevant to spend.

## 7. Model and data layer
OpenAI-compatible gateway with provider adapters; registry O(1) indexes (`packages/cost/README.md:61-66`).

## 8. Hackathon-care checks
Heavy stack (Worker, ClickHouse, Supabase, Stripe). Tests include per-provider cost snapshots (`packages/__tests__/cost/`, file list only; contents not read).

## 9. Traps seen
Worst-case escrow locks too much balance on large-context models. Escrows are cleaned only probabilistically. Unknown-model cost is `null`, easy to sum as zero. Public repo is a delayed mirror.

## 10. Reuse
Apache-2.0: code and registry data may be reused with credit and notice.

## 11. Verdict: ADAPT
Copy: (1) escrow ledger with `credits - escrows - debits` and unique escrow ids; (2) a stop-list for models whose cost cannot be parsed; (3) tiered pricing with per-provider threshold rules and a full breakdown per request.
Avoid: (1) worst-case-only reservation; (2) `null` cost treated as free; (3) enforcement for the vendor's own wallet only, with no per-task cap.
