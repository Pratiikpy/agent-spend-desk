# Codex logs and the plan limit (2026-10-24)

A second tool's logs, and what they say about a plan's rate limit. Codex writes, beside its token counts, the percent of the plan's 5-hour and weekly windows that is used and when each window resets. The ledger reads both (`desk ingest --agent codex`), and `desk limits` fits tokens to percent. Everything below is from the Codex logs of one machine (87 session files, 2026-04-29 to 2026-10, Codex 0.125 to 0.130, a Plus plan); nothing is claimed for other users or plans.

## What the logs contain, and what would make a count wrong

| Fact in the real logs | How it is handled |
|---|---|
| The same `token_count` event is written many times with an unchanged total: 1,371 repeats | A call is a growth of the cumulative total and nothing else |
| The total sometimes grows by more than the last request (4 cases, two requests between events) | A call's tokens are the growth of the cumulative counters, which always add up to the tool's own total; the call is marked as merged |
| A forked (sub-agent) session replays its parent's whole history into the child's file in the milliseconds after the fork: one file has 782 replayed calls and 119.3 million tokens beside 7 calls of its own | Lines in the first burst after a fork (no gap of 1 second or more) are history: they set the starting total and are not counted. Without this the replay would add 119 million tokens, about 8% of everything on this machine |
| `input_tokens` includes the cached part | Fresh input = input - cached; cached input is stored as cache reads; output includes reasoning, which is recorded separately |
| The model is named by `turn_context`, not by the event | A call takes the model of the latest turn (the 782 calls that looked model-less were the replayed ones: none of the 10,344 own calls is without a model) |
| In 2 of 87 files the tool's own `total_tokens` is up to 0.3% above input plus output (30 tokens per event) | Not counted; the residual is stated, and the sum of calls is within 0.3% of the tool's own total in every file |

Read in 1.7 seconds: 10,344 own calls, 2,584 limit readings, 0 malformed lines. Calls are unpriced (`unknown-model`) because the price table has no OpenAI rows: Codex is used on a plan whose limit, not a price, is the currency, and no dollar is invented.

## The plan limit in tokens

Method: a window (one `resets_at`) with at least two readings gives one observation, the points the percent moved against the tokens of covered models used between the first and last reading. The estimate pools the windows that moved at least 10 points (all tokens over all points), puts a 95% interval on it by resampling windows, and abstains below 8 such windows. Tokens are all input and output as the tool counts them, cached input included; five other weightings were tried (fresh tokens only, output only, cached input at 10% and 25%, output at 5 to 8 times) and none was steadier across windows.

**Correction, 2026-10-24 (later the same day).** The first version of this fit took every reading labelled "primary" as the 5-hour limit and every "secondary" as the weekly one. The readings also carry the plan and the window length, and they differ: on this machine Codex's primary window was five hours on the plus and team plans, a week or 30 days on the free plan, and the ledger holds all of them. The first fit therefore mixed other plans and other window lengths into the 5-hour and weekly rows (it reported 242K tokens per percent over 82 windows, and 2.0M over 16). The fit now takes each plan and window length as its own limit (`desk limits` lists them), and the numbers below are the corrected ones. The change is small for the plus plan (258K against 242K, 7% higher) and the earlier figure is withdrawn.

| Plan and window | Windows used | Tokens per percent | 95% interval | Full window | Middle of windows (p10 to p90) |
|---|---|---|---|---|---|
| plus, 5-hour | 76 | 258K | 244K to 275K | 25.8M | 193K to 338K |
| plus, weekly | 15 | 2.1M | 1.7M to 2.4M | 205M | 1.5M to 2.9M |

The other plans and lengths in the ledger (free: 30-day and weekly; team: 5-hour and weekly; readings with no plan recorded: 5-hour and weekly) have too few windows that moved the percent by 10 points for an estimate, and the fit says so for each.

**How good is it as a prediction?** Leave one window out, predict the points it moved from its tokens and the rate fitted on the others (`leaveOneOut`, printed by `desk limits`): for the plus 5-hour window the median error is 5.0 points (12% of what the window moved), 59 of 76 windows are within 25% and 70 of 76 within 50%; for the plus weekly window the median error is 17.3 points (21%), 10 of 15 within 25% and 14 of 15 within 50%. So the rate is real and stable enough to say "this much work is about this much of the limit", and not precise enough to predict one window.

**Why windows differ.** The percent is in whole points, and the same plan is used from other devices, the web and models whose use does not appear in these logs; the percent moves without a trace here. Calls through other providers (kimi, glm, minimax and others set up through a router) do not draw on the plan and are left out of the token count by model name.

## Claude Code's plan limit: the reader is built, no readings exist yet

Claude Code documents one source for the plan limit: the JSON it sends a status line script, with `rate_limits.five_hour` and `rate_limits.seven_day` (`used_percentage` 0 to 100, `resets_at` in epoch seconds), present for claude.ai Pro and Max users after a session's first response (https://code.claude.com/docs/en/statusline, read 2026-10-24). `src/desk/statusline/main.ts` is a command Claude Code can run as its status line: it prints a one-line gauge (`claude-opus-5 · 5h 31% (resets in 3h 1m) · wk 9% · $1.50 · ctx 12%`), keeps a sample when a limit changed or a minute passed, never keeps the working directory or any text, and never errors loudly (checked on Node 24: 116 ms from start to output, junk input prints nothing and exits 0). `desk ingest --agent statusline` reads the samples into the same table as Codex's readings, and `desk limits --agent claude_code` fits them against Claude's token counts.

Not turned on: Claude Code's settings are the user's, so `desk statusline install` prints the setting and does not edit anything. Until it has run for a few days there are no Claude readings and no Claude fit. The reader is tested against the fields the documentation lists; **NOT VERIFIED against a real Claude Code status line run**. Claude's plan limit may weight models differently (an Opus token may count for more than a Haiku token), which the Codex fit above does not need to model; a Claude fit should be checked per model before it is trusted.

## Not covered

- One user, Codex only; one plan (plus) has enough windows for an estimate. Claude Code's equivalent (the statusline's rate-limit fields) has not been captured on this machine, so no Claude limit estimate exists.
- The model filter is by name (`gpt`, `o<digit>`, `codex`); a new model family with another prefix would be left out until the filter is extended.
- The fork rule (a gap of 1 second ends the replay) was checked on the one forked file on this machine. A fork written more slowly would be partly counted.
- A resumed session that rewrites the same file from the start would keep the same call ids and so store nothing twice, but a log truncated and rewritten with different content under the same ids would not be corrected.
- No tool-reported cost to compare with: Codex reports tokens and percent, not dollars.
