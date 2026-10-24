# Cost estimate against Claude Code's own recorded cost (2026-10-24)

Claude Code writes a `cost-state` line into its session logs with the cost it counted for the running process. The ledger now keeps those lines apart from every estimate (`reported_cost`, `reported_model_usage`; a computed figure can never overwrite them), and `desk reconcile` compares them with the estimate, per process and per model. This note records what that showed on the logs of one machine. Nothing here was compared with an invoice.

## Method

- **A process** is one run of Claude Code on a session, from the `startTime` its `cost-state` records. A session that was resumed has several. The counters are cumulative from that start, so calls that began earlier are not in them.
- **The estimate for a process** is the list-price cost of the session's calls that began at or after `startTime`, before the next process of the same session began, and no later than the last message the tool had read when it wrote its last record.
- A process **agrees** when the estimate is within 2% of the tool's figure. Tokens are compared per model first, so a difference can be put down to prices (tokens agree) or to coverage (tokens differ).
- Machine: 3,757 log files, 1.25 million lines, 218,026 calls in the ledger, 420 processes with a recorded cost. Run with `desk ingest --db data/desk/reconcile.db` and `desk reconcile --db data/desk/reconcile.db`.

## Result

| | processes | within 2% | within 10% | tool's cost | estimate |
|---|---|---|---|---|---|
| All | 420 (6 with no call in their window) | 248 | 306 | $9,352.69 | $15,205.65 |
| Without sub-agents | 407 | 248 | 305 | $483.27 | $442.73 |
| With sub-agents | 7 | 0 | 1 | $8,869.42 | $14,762.93 |

The median absolute difference is 0.0%: more than half of the processes agree to the cent. Without sub-agents the estimate is 8% below the tool's figure in total. Three processes hold 97% of the absolute dollar difference, all of them sessions that ran large numbers of sub-agent calls (the largest has 106,698 calls and 57,052 of them from sub-agents).

## What the differences are

1. **Exact where the tool's counter covers the same calls.** In one resumed session the 16 messages after the process start have 2,765,167 cache-write tokens in the log, and the tool recorded 2,765,167. The 68 earlier messages (2.8 million tokens, August) are not in its counter, which is why the estimate for the whole file was twice the tool's figure before the window was applied.
2. **The tool's counter lags and undercounts when sub-agents run.** In the largest session the ratio of estimate to tool's cumulative figure moved 1.00, 16.5, 1.36, 1.17, 3.07, 1.84, 2.47 over four weeks, and the tool's total stood at $1,802.74 for ten days while calls continued. The direction is not uniform: in another sub-agent session the tool recorded more than the estimate (0.47x). The cause is NOT VERIFIED; the numbers say that the counter is not a complete record of those sessions, not which of the two figures is closer to what was billed.
3. **The prices in our table match Anthropic's pricing page.** The page was read on 2026-10-24 through a text reader (`r.jina.ai`), not directly. Every model both list (Fable 5.1, Opus 5.5, Sonnet 5.5, Haiku 5.5, Mythos 5 and 5.1, Fable 5, Opus 5 to 4.5, Sonnet 4.6 and 4.5, Haiku 4.5) has the same input, output and cache prices once the page's cache-read multipliers are applied. For Sonnet 5 the page's table leaves the base prices blank; its batch prices of $1 and $5 imply the $2 and $10 in our table, which is an inference (0.1x of input; 0.05x on Opus 5.5 and Sonnet 5.5; 0.025x on Fable 5.1 and Mythos 5.1).
4. **Claude Code's own cost for Sonnet 5.5 is higher than the page's price.** Priced with the page's cache-read price ($0.10 per million), the tool's own reported tokens give 73% of the cost it reported. With cache reads at $0.20, the old 0.1x rate, they give $3,850.24 against the $3,838.56 it reported, a 0.3% match over 34 process-model rows. So the tool's displayed cost appears to use $0.20 where the page says $0.10. Third-party write-ups disagreed about whether Sonnet 5.5 cache reads were cut from $0.20 to $0.10 and when; the effective date is NOT VERIFIED, and our price table has no effective dates.
5. **Claude Haiku 5.5 is priced by prompt length, and our table was not.** The page prices a request whose prompt (fresh input, cache reads and cache writes together) is over 100,000 tokens at $0.50 / $2.50 / $0.625 / $1.00 / $0.05 per million instead of $0.10 / $0.50 / $0.125 / $0.20 / $0.01, each request on its own. Tiers are now part of the price book (`data/prices/anthropic-2026-10-24.json`, built from the dated 2026-10-22 snapshot and `data/prices/official-tiers-2026-10-24.json`); the sample and the recorded benchmark keep the old snapshot, which is not edited. The effect on this machine's total is small because Haiku 5.5 is a small share of its spend.
6. **Log lines undercount the tool's tokens a little.** In two clean sessions the logged output tokens were 91% to 94% of what the tool counted, and the logged non-cached input tokens were a small fraction of the tool's. Log lines carry a usage snapshot taken while the reply was still streaming. This is consistent with the estimate sitting below the tool's figure in the sessions without sub-agents.

## What this does to the product

- The Bill and the card must keep three classes apart: **reported** (the tool's own counter, known to lag and undercount with sub-agents, and to use a $0.20 Sonnet 5.5 cache-read price where the pricing page says $0.10; a second price source agrees with the tool, see `docs/verification/price-sources-2026-10-24.md`), **estimated** (tokens in the logs at the page's list prices), and **billed** (an invoice, not available here). Neither of the first two is billed.
- A statement such as "the estimate matches Claude Code's own figure" is true of 248 of 420 processes on this machine, and false for the sessions that matter most to a big bill. Do not state accuracy beyond that.
- The estimate for sessions that use sub-agents could be closer to the invoice than the tool's counter or farther. Settling it needs Anthropic's usage export or invoice for the same period.

## Not covered

- One machine, one user, the Claude Code versions installed here. Other versions may write `cost-state` differently or not at all (processes from before the feature have no record, so their calls are outside every window).
- No invoice or usage export. "Closer to the bill" is not claimed for either figure.
- Fast-mode, batch and US-only (1.1x) surcharges are not applied; the logs do not say which applied.
- Calls for models with no price (`<synthetic>`, `kimi-k3`, `glm-5.2`; 1,574 calls) are left out of the estimate and counted in each process's note.
- Subagent calls made while the tool's last record was written may fall outside the window (the window ends at the last main-log message the tool had read).

## To do

1. Ask for Anthropic's usage export for the same weeks and compare both figures with it.
2. Show the reported figure beside the estimate on the Bill screen, with the class label and the sub-agent warning.
3. Give price rows an effective date and read the cache-read price in force on each call's day.
4. Check the sub-agent undercount with a controlled run: a session with a known number of sub-agent calls, read before and after.
