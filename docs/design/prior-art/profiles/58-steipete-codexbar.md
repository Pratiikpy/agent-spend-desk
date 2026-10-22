# Profile: steipete/CodexBar

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT, Copyright 2026 Peter Steinberger (`LICENSE:1-3`). Stars 22,682, last push 2026-10-20 09:33 UTC (`gh api repos/steipete/CodexBar`); releases v0.76.0 (2026-10-15), v0.77.0 (10-16), v0.78.0 (10-19). Swift 6, macOS 14+ menu-bar app plus bundled CLI and widget.

## 1. What it is
A menu-bar tracker of plan limits (session, weekly, per-model windows, credits) across dozens of AI providers, with a separate local-log scanner for token cost. The best repository found for how limits are discovered, because it reads the vendors' own numbers instead of guessing.

## 2. Architecture map
`Sources/CodexBarCore` (fetch, parse, cost scan), `Sources/CodexBar` (UsageStore, menus, pace), `CodexBarCLI`, `CodexBarWidget` (`docs/architecture.md:8-14`). Provider descriptors (about 60 under `Sources/CodexBarCore/Providers/*/...ProviderDescriptor.swift`) register a fetch strategy list. Data flow: background refresh, provider probes, `UsageStore`, menu, icon, widget (`docs/architecture.md:21-22`).

## 3. Features and failure behaviour
Per provider a fetch strategy chain with fallback. Codex: PAT, then OAuth (`auth.json`), then CLI RPC `codex app-server`; web dashboard only when selected; auth failures may fall through, network and decode failures keep the original error, stale external OAuth fails closed (`docs/codex.md`, "Data sources + fallback order"). Claude: Admin API key if set; else OAuth, CLI PTY, Web (`docs/claude.md`, selection order). Last good measurement is kept through temporary network failure with its original timestamp shown.

## 4. How people use it
Install, enable providers; CLI `codexbar`. Large changelog and issue labelling docs (`docs/ISSUE_LABELING.md`). Tests: `Tests/CodexBarTests`. Issue-level usage evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
How limits are discovered (the answer): ask the vendor. Claude: `GET https://api.anthropic.com/api/oauth/usage` with header `anthropic-beta: oauth-2025-04-20` returns `five_hour`, `seven_day`, `seven_day_sonnet/opus`, and `extra_usage` (monthly spend and limit) (`docs/claude.md:204-223`). Codex: RPC to the local app-server. Each window is a `RateWindow` of `usedPercent`, `windowMinutes`, `resetsAt`. No token-to-limit conversion is needed because the vendor reports percent.
Plan-pace forecast (`Sources/CodexBarCore/UsagePace.swift:43-124`): expected used percent = elapsed over window (or work-day-weighted, `workDays` 2 to 6, `:59-72`); delta = actual minus expected, bucketed into seven stages (`:4-12`); rate = actual over elapsed; if remaining over rate is at least the time to reset the plan "will last to reset", else an ETA to exhaustion; `speedMultiplierToReset` = remaining capacity over projected remaining usage (`:152-159`). Synthetic guards: reject windows where `elapsed == 0` and usage is above 0 (`:74-76`).
Historical forecast (`Sources/CodexBar/HistoricalUsagePace.swift:751-871`): needs 3 complete weeks, risk needs 5; week weights `exp(-age/3 weeks)`; effective sample size `nEff = (Σw)² / Σw²`; blend weight `lambda = clamp((nEff-2)/6, 0, 1)` between the weighted-median historical curve and a linear baseline; curve capped at the linear line so excess demand is never called reserve (`:805-809`); run-out probability is the weighted share of past weeks that would hit 100%, smoothed `(mass + 0.5) / (Σw + 1)`, and `willLastToReset` when that is under 0.5 (`:859-865`). 169-point weekly grid, 56-day retention, 30-minute write interval (`:67-76`).
Session-equivalents (`SessionEquivalentForecast.swift:9-106`): how many 5-hour windows fit in the remaining weekly percent, from the median weekly percent per window, and only with a minimum sample count.
Cost scanner (`Sources/CodexBarCore/Vendored/CostUsage/*`, `CostUsageFetcher.swift`): incremental, file-stamp cache (`CostUsageCacheModels.swift:5-31`: mtime, size, file id, per-day token arrays, resumable scan cursor). Honest-state types are the best part: `CostProvenance` = `listPriceEstimate | vendorMetered | mixed | unknown` with `isBillingReceipt` hard-coded false (`CostProvenance.swift:4-15`); coverage counts `priced/unpriced/unmetered/estimated` and `coverageRatio` (`:48-70`); quota-aligned weeks with `tokensAreComplete`, `costIsComplete`, `boundariesAreEstimated` (`CostUsageModels.swift:70-112`); incomplete proxy records excluded and counted, an incomplete-only period shown as unavailable, never zero (`docs/claude.md`, paragraph on null `stop_reason`).
Loses: percent only, so no dollar value of a window unless cost history is joined; no per-task or per-outcome view; macOS only; login-cookie and PTY scraping is fragile and not shippable to a judge.

## 6. Agent patterns
None. Strategy chain with fallback and typed errors is the closest.

## 7. Model and data layer
Descriptor plus fetch-strategy per provider; scripted plugins (`Plugins/ScriptFetchStrategy.swift`); custom pricing overlay (`Vendored/CostUsage/CostUsageCustomPricing.swift`).

## 8. Hackathon-care checks
Not a hackathon project. Needs real logged-in accounts: fails the "judge has no key" test unless a recorded-sample mode is built. Never prints secrets in docs I read.

## 9. Traps seen
Seven-stage pace is only as good as the vendor percent; refactor notes admit two inconsistent `.auto` orders (`docs/claude.md`, "A lower-level direct Claude fetcher...").

## 10. Reuse
MIT: algorithms and types may be reused with credit; rebuild in TypeScript. Do not copy cookie scraping.

## 11. Verdict: ADAPT
Copy: (1) `CostProvenance` plus coverage counts, with "never a billing receipt" as a type; (2) recency-weighted, effective-sample-size-blended historical forecast with smoothed run-out probability; (3) vendor-reported windows as truth, local logs as estimate, shown side by side.
Avoid: (1) browser-cookie and PTY scraping; (2) percent-only limits with no dollar join; (3) several competing auto-selection paths.
