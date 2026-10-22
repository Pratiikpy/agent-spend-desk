# Profile: ccusage/ccusage

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT, Copyright 2025 ryoppippi (`apps/ccusage/LICENSE:1-3`; the root `LICENSE` is a link to it, and the GitHub API reports NOASSERTION, so treat it as MIT with the file as the source). Stars 19,085, last push 2026-10-20 03:35 UTC (`gh api repos/ccusage/ccusage`), releases v20.0.34 to v20.0.37 between 2026-10-15 and 2026-10-19. Rust rewrite under `rust/`; the TypeScript `apps/ccusage` is now a thin launcher (`apps/ccusage/src/cli.js`).

## 1. What it is
A local CLI that reads the JSONL logs of about 20 coding agents and prints daily, monthly, session and "5-hour block" cost reports. Pure offline accounting: tokens times a price table, no judgement of whether the work landed.

## 2. Architecture map
One adapter crate per agent (`rust/adapters/{claude,codex,gemini,amp,opencode,...}/src/{paths,loader,parser,report}.rs`), a shared core (`rust/crates/ccusage-core/src/{types,cost,pricing,summary,model_aliases}.rs`), an all-agent merger (`rust/crates/ccusage-adapter-all`), and the block logic in `rust/crates/ccusage/src/blocks.rs`. Data flow: paths, then lenient line parse, then dedupe, then `LoadedEntry` (with project, session id, cost), then summaries or blocks.

## 3. Features and failure behaviour
Daily, monthly, session, blocks, a last-window view. Malformed JSONL lines are skipped (`rust/adapters/claude/src/README.md:52`). A model with no price yields cost 0.0 and is flagged `missingPricing` per model breakdown (`rust/crates/ccusage-core/src/cost.rs:103-113`, `types.rs:110-111`), not an error.

## 4. How people use it
`npx ccusage`; zero config; reads `~/.claude/projects` and `~/.config/claude/projects`, `CLAUDE_CONFIG_DIR` may list several (`rust/adapters/claude/src/README.md:3-9`). Tests are snapshot-based over fixtures (`apps/ccusage/test/fixtures/...`, `rust/crates/ccusage/tests/*.snap`). Usage statistics from issues: NOT VERIFIED.

## 5. Mechanism for the Desk
Record (`types.rs:9-39`): `sessionId, timestamp, version, message{usage{input, output, cache_creation, cache_read, cache_creation{5m,1h}, speed}, model, id}, costUSD, requestId, isApiErrorMessage, isSidechain`.
Cost (`cost.rs:31-46`): three modes. `display` uses the stored `costUSD` only; `auto` uses stored cost else computes; `calculate` always computes. The Desk should keep all three and show the gap.
Formula (`cost.rs:122-200`): input, output, 5m cache write, 1h cache write (priced at 2.0 x input, `cost.rs:7`), cache read, each at its own rate; fast speed multiplies by a per-model factor (`cost.rs:114-119`, data in `fast-multiplier-overrides.json`, for example Opus 4.6 and 4.7 at 6.0). Long context: if a model has a threshold the whole request switches tier once input plus cache read plus cache write exceeds it (`cost.rs:137-172`); otherwise LiteLLM-style marginal tiers above 200K (`cost.rs:174-200`). Saturating integer adds guard corrupt lines.
Dedupe is where most overcounting lives (`rust/adapters/claude/src/README.md:19-47`): key is message id plus request id across sessions; with no request id, message id plus session plus timestamp; real `msg_` and `resp_` ids collapse across timestamps because one response is written once per content block; sidechain replays of a parent message are dropped when one copy has `isSidechain: true` (their issue #913). Advisor sub-calls in `usage.iterations` are priced under their own model (lines 54-61).
Codex (`rust/adapters/codex/src/parser.rs:478-500, 1284-1316`): uses `last_token_usage` when the cumulative total advanced, else subtracts the previous cumulative total; clamps cached input to input.
Price table (`rust/crates/ccusage-core/src/pricing.rs:17-97, 95-97`): embedded LiteLLM snapshot, refreshed from the LiteLLM raw URL and models.dev, with date-aware lookup `find_at(model, timestamp)` (`cost.rs:106-110`) so a price change does not re-cost old months. Dated cutoffs exist in code (`pricing.rs:292`).
Blocks (`blocks.rs:53-147`): sort entries; a block starts at the first entry floored to the hour; a new block starts when time since block start or since last entry exceeds the duration (default 5 h); a gap block is inserted; active means last entry younger than the duration and now before the block end.
Forecast (`blocks.rs:567-601`): burn rate = tokens over (last minus first entry) minutes, cost per hour likewise; projection = spent plus rate times remaining minutes; status "exceeds" over the limit, "warning" over 80% (`blocks.rs:18, 202`). Linear, one block of evidence, no uncertainty.
Loses: no outcome, no quality, no cost-to-work link; project is only the directory; cost is list-price estimate only; plan limits are user-supplied tokens, not discovered.

## 6. Agent patterns
None. It is a reporter.

## 7. Model and data layer
Adapters normalise every agent into the Claude usage shape; core never sees agent specifics. Aliases (`model_aliases.rs`) fold model names.

## 8. Hackathon-care checks
Offline by default via embedded snapshot; snapshot tests; fast. No trace of why a number is what it is, beyond JSON output and `stored_cost` split (`types.rs:112-114`).

## 9. Traps seen
Stored `costUSD` is trusted in `auto`; token-rate cost for subscription users is a notional figure, not a bill. Linear projection overstates when the block is idle.

## 10. Reuse
MIT: the formula, dedupe rules, block algorithm and fast/long-context tables may be reused with credit. Rebuild in TypeScript.

## 11. Verdict: ADOPT (accounting layer), then go beyond it
Copy: (1) the dedupe key hierarchy and sidechain-replay rule; (2) per-request cost with 5m/1h cache split, fast multiplier, whole-request long-context tier, and date-aware price lookup; (3) the `display/auto/calculate` split with `missingPricing` and `stored_cost` flags.
Avoid: (1) printing a single dollar figure with no provenance; (2) linear one-block forecast; (3) project = directory name.
