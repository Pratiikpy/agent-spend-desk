# The Desk pays through its own ledger (2026-10-25)

Feature DF-077 built. The tool that watches what agents spend now shows what it spends itself.

## What it does

Every model call the Desk makes (the Ask planner and explainer, the policy drafter and attacker, the benchmark arms, the canary) goes through one function, `callModel`, or, for the canary, `completeOwn`. Both now:

1. **Reserve** before the call: with a daily limit set (`DESK_OWN_DAILY_CAP_USD`), the worst case of the request (its prompt at three characters a token, plus the most it may reply, priced at the configured model) is added to today's estimated own spend, and a call that could pass the limit is refused before it is sent with `E_BUDGET_EXCEEDED: own_spend`, naming what was spent and the limit. Every role already degrades on a budget error (Ask falls back to its rules, the drafter and attacker to their fallbacks, the explainer to its sentence), and the canary records an "own spend limit" row and stops retrying.
2. **Record** after the call, in the ledger's `desk_call` table (schema 19): role, served model and route, tokens, time, whether it succeeded, and an estimate priced from the price book like any other call. A model with no price is **counted, its tokens kept, no dollars invented, and not refused** (the specification's unpriced-deny rule would have denied the Desk's own free-tier calls). A failed call is recorded as failed, with a cleaned reason and no dollars, because whether it was billed is unknown.

A reply replayed from a recording sent nothing and cost nothing, so it is not recorded. With no limit set, the calls are still recorded and each run is still bounded in calls and seconds by its budget.

The bill (`desk bill` and the Bill screen) shows "The Desk's own calls" apart from the agents' spend, by role, with the limit and today's spend when one is set, and "not priced" where no call in a role was priced. They are not in the agents' totals: a test compares the bill's headline with and without them.

## What ran

- `tests/desk/own-calls.test.ts` (13): a call recorded with its role, model, tokens and an estimate equal to the tokens times the list price, recomputed in the test; a model with no price counted and not refused under a limit of one micro-dollar; a failed call recorded as failed; a replayed reply not recorded; nothing written when no sink is set; a canary-style call outside `callModel`; an Ask run writing one row per model call it made, equal to the count in its trace; the limit refusing a call before it is sent and Ask falling back to its rules with `own_spend` in the trace; calls allowed until the day's spend plus the next worst case would pass the limit, and the next UTC day starting again; the error text; the bill's section and its totals; the bill's headline unchanged by them; `desk forget --all` and `--before` removing them.
- **On the real ledger, with the live model.** One `desk ask` over the last 30 days ran through Meterless Nightshift to NVIDIA's free endpoint: two calls were written (planner 2,842 tokens in and 77 out, explainer 391 and 132), both `unpriced` with the reason `no price for this model (unknown-model)`, served by `nightshift`, and `desk bill` printed them as "2 calls, 3,233 tokens in and 209 out: no call was priced; 2 on a model with no price (counted, not priced)".
- The Bill screen was looked at in light at 1440 px and dark at 390 px with a scratch ledger holding priced, unpriced and failed calls: no overflow, no console error.

## Defects found on the way

- The bill's period ends at the last agent call, and the Desk's own calls usually come after it, so they were left out of a bill that named the day. The own-calls total now covers the whole of each day the bill names.
- A role whose calls were all unpriced showed `$0.00`, which reads as free; it now says "not priced".
- The canary would have retried a call the limit had refused; it now stops.

## Not covered

- **The limit is its own, not the gate's.** The specification puts the Desk's calls through the same reserve-and-settle gate as an agent's. They go through a separate daily limit in the ledger instead, because the gate meters tool calls and a model price per micro-dollar for another tool's session, and the Desk's calls have no session to cap. Whether a shared gate would add anything is open.
- The estimate for a priced model uses list prices and the tokens the endpoint reports; no priced model has been run live here (the only live model is free), so a priced live call is tested with a scripted port, not an invoice.
- The reservation's worst case is a rough bound (three characters a token), not a count by the model's tokenizer. It over-counts ordinary English.
- The ledger is written by the process that makes the call. Two commands running at once write through SQLite's write-ahead log with a ten-second wait; a ledger locked longer than that loses the row and the call goes on (the trace line still says it was made).
- `desk prove` and `desk demo` do not record, so a check that runs scripted "live" calls cannot write into a real ledger.
