# Markovian on a twelve-month ledger (DF-118), 2026-10-25

What was built, what was run, and what it does not show.

## What the Desk does with the engine

A date range of three or more whole calendar months is read one month to a chunk through the Meterless Markovian engine. The only thing handed from one chunk to the next is the engine's carryover block: totals, the peak month, the five leading models, the cost of every month so far, and (in month mode) the month-by-month cost of the six leading models. A model that cost more in every month than in the month before is stated as such. Any other range is read in days, then whole weeks, as before.

The carry state of each month is kept in the ledger (`carry_state`, schema 27), under a digest of every period read up to it and a digest of the stored text. A second reading of the same year reuses every month whose rows are unchanged; a changed month, or an edited stored state, is worked out again from that month on. Ask runs read-only and keeps nothing; `desk engines warm` keeps the state and also writes the engine's own run record, which `desk engines history` reads back.

Commands: `desk engines year`, `desk engines warm`, `desk engines history`. Ask routes "grew every month", "which month had the highest spend" and "first or last third" questions on a range longer than 62 days to the range digest.

## The twelve-month ledger

`src/desk/sample/year.ts` writes twelve monthly Claude Code log files from a seed (3,744 calls, 2025-01-01 to 2025-12-31). The trends are planted so that the truth is known before any engine runs: opus is used more every month; sonnet goes up and down, with a burst of 200 sessions on 12 March that makes March the dearest month; haiku builds to June and falls away. The truth for each question is worked out from the rows by plain SQL in `year-check.ts`, not from the engine, and the same grader is shown a wrong truth and must mark it wrong.

## Results, `desk engines year`

Five year-long questions, each asked with the engine on and off.

- Which model's cost grew every month: with the engine, `claude-opus-5` and no other (right). Without it, the answer lists weekly figures newest first and does not say (not stated).
- Which month had the highest spend: with the engine, 2025-03-01, $61.36 (right). Without it, not stated.
- Total for the year, $243.96: right both ways.
- Which model cost the most, `claude-sonnet-5-5`, $132.93: right both ways.
- The last third against the first third, 99.8%: with the engine right. Without it, not stated.

Right with the engine: 5 of 5. Without it: 2 of 5. The engine-off answer is the Desk's own fallback (weekly claims newest first until the claim budget is used), which is a deliberately simple reader. The comparison says what the carry gives over that reader, not what no other design could do.

The engine read 12 periods in 12 chunks. The largest state it carried was 173 estimated tokens against a budget of 800, and that size does not depend on the number of months. A second reading used the kept state for 12 of 12 months.

## What the engine's own accounting says, and what it does not

The engine reports 263 tokens read and 0 saved over carrying the whole history. At this size the monthly periods are smaller than the state that carries them, so nothing is saved, and the Desk does not claim a saving. What the carry gives here is the fixed size of the state and the month-by-month series that answers the growth question.

The engine's projection for the last of 12 periods at its default chunk size of 8,000 tokens (not this ledger's chunks) is a prompt of 96,000 tokens with the history carried whole and 8,800 with the bounded carry. That is the engine's projection for its default configuration, not a measurement on this ledger.

## Found and fixed on the way

- A model id that holds the engine's end marker would have finished the chain early (the planted test fails with 1 chunk of 4 when ids are not sanitised). Ids are sanitised before they reach a chunk.
- The question "which model's cost grew every month" used to match the by-model rule first and so was answered with plain totals. It is now read in periods.
- The first draft of the check read 4 of 5 because the grader looked for a model name without the backticks the answer puts around entities. That was the check, not the product, and is fixed in the check.
- A stored state is used only when its digest and its text digest match; an edited state is recounted (tested, and part of `desk prove`).

## Not covered

- The chunk "generator" is code, not a language model. The engine's chunk, marker, carryover and budget contract is what is used. A model-written chunk has not been tried.
- The ledger is generated. No real user's twelve months has been read.
- Ranges longer than 32 months fall back to weeks. A year with more than six leading models keeps the series of the six leading by total cost only.
- Nothing here measures the engine's saving on a ledger large enough for the periods to exceed the state. NOT VERIFIED.

## Tests

`tests/desk/year-engine.test.ts` (35 cases): seeded files, planted truth, month buckets (leap year, year end, non-aligned ranges), the digest against the rows, a model first used in month two, a model absent mid-year, an empty month, a hostile model id, unpriced calls, the kept state (second reading, one changed month, edited text, edited digest, read-only connection, a ledger from before the table), the engine's run record and progress, the planner rules, Ask with the engine on and off, and the year check. `desk prove`: `markovian-year-long-questions-match-the-rows-and-kept-state-is-checked`.
