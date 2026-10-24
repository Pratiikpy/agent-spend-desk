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

| Window | Windows used | Tokens per percent | 95% interval | Full window | Middle of windows (p10 to p90) |
|---|---|---|---|---|---|
| 5-hour | 82 | 242K | 221K to 263K | 24.2M | 134K to 339K |
| weekly | 16 | 2.0M | 1.6M to 2.4M | 200M | 1.3M to 2.9M |

**How good is it as a prediction?** Leave one window out, predict the points it moved from its tokens and the rate fitted on the others: for the 5-hour window the median error is 5.7 points (14% of what the window moved), 55 of 82 windows are within 25% and 70 of 82 within 50%; for the weekly window the median error is 15.4 points (19%), 10 of 16 within 25% and 13 of 16 within 50%. So the rate is real and stable enough to say "this much work is about this much of the limit", and not precise enough to predict one window.

**Why windows differ.** The percent is in whole points, and the same plan is used from other devices, the web and models whose use does not appear in these logs; the percent moves without a trace here. Calls through other providers (kimi, glm, minimax and others set up through a router) do not draw on the plan and are left out of the token count by model name.

## Not covered

- One user, one plan type, Codex only. Claude Code's equivalent (the statusline's rate-limit fields) has not been captured on this machine, so no Claude limit estimate exists.
- The model filter is by name (`gpt`, `o<digit>`, `codex`); a new model family with another prefix would be left out until the filter is extended.
- The fork rule (a gap of 1 second ends the replay) was checked on the one forked file on this machine. A fork written more slowly would be partly counted.
- A resumed session that rewrites the same file from the start would keep the same call ids and so store nothing twice, but a log truncated and rewritten with different content under the same ids would not be corrected.
- No tool-reported cost to compare with: Codex reports tokens and percent, not dollars.
