# Waste rules beyond the autopsy: error echo, cut-short results, edit churn, ungrounded runs, orphaned agents (2026-10-25)

Features DF-092 and DF-100 built, DF-033 advanced (five of its classes now exist; five do not). `desk waste` reports them; the session screen lists them as waste blocks beside the autopsy's own.

## What the ledger now keeps (schema 14)

For each tool result: **a hash of what it said** (digits, long hex, uuids, whitespace and case folded away, only the first 200 characters compared) and **whether the tool said it cut its output short**. The text is not kept. A result that is a bare exit status (`Exit code 1`) or under eight characters gets no hash, because a search with no match and a broken build both say that and cannot be told apart. `desk ingest --backfill` fills both for results read before version 14 (run on this machine: 277,917 results, 243,408 with a hash, 1,026 marked in the last 60 days).

## The rules (thresholds are those of master spec section 7.4)

- **C-LOOP-2, error echo.** The third time a tool returns the same error with no success of that tool between; a prompt from you starts the count again. Priced from the third call on.
- **C-TRUNC.** A result that says it was cut short (Claude Code's "output too large, full output saved to a file", a size limit exceeded, a count of lines left out) and the same tool use asked for again within three calls. Billed: the calls from the cut to the repeat. A cut that was not repeated is listed, never billed.
- **C-CHURN.** The fourth edit of one file with no call that could run a check between the edits (any tool that is not a read, a search or an edit counts as able to). Marked a heuristic, shown apart from the directly read dollars: one document edited thirty times in a row is a document being written.
- **C-UNREF.** The third call in a row that used no tool, when the first two did not hand control back (`stop_sequence`, `max_tokens`, `pause_turn`). A bare call that ended its turn (`end_turn`) answered something, so it never counts.
- **C-ORPHAN.** A delegated agent still calling the model more than 30 minutes after the session's main thread made its last call, with no prompt from you in between.

A call the autopsy counts as a loop or as idle time is never counted again, and a call one rule flags is not flagged by another, so the classes add up.

## What ran

`tests/desk/waste.test.ts` (positive and negative per rule, the reset conditions, claiming, unpriced calls), `result-facts.test.ts` (folding, the hash, the marker with its false positives, ingest and backfill), `waste-command.test.ts`, `ui/waste-blocks.test.ts` (the blocks and their explanations over the API), a case in the migration and backfill tests. Full suite: 96 files, 1,279 tests.

On this machine's ledger, 60 days (2026-08-25 to 2026-10-24, 199,722 calls): C-LOOP-2 344 runs in 157 sessions, 399 calls, $22.04; C-TRUNC 1 run, $0.13; C-CHURN 250 runs in 9 sessions, 560 calls, $46.03 (heuristic); C-UNREF and C-ORPHAN none. Over 150 days: C-UNREF one run of two calls on a model with no price, C-ORPHAN none.

**Checked against the raw logs, not the ledger.** Eight C-LOOP-2 runs sampled across the period: all eight were the same error repeated (`Fork is not available inside a forked worker`, `Unauthorized: Invalid token` from a firecrawl tool called again and again, `Contains brace with quote character`, `This command requires approval`). The C-TRUNC run was a shell command whose output had been cut, run again. C-CHURN samples were one markdown file edited thirty times in a row.

## Defects found while building, and fixed

- First marker matched the bare word *truncated*: a quarter of the sample were JSON fields called `truncated`, test names and prose. Now phrases only; the false positives are cases in the test.
- First error-echo rule compared whole results and needed the inputs to differ; it was also two to three times more generous than the spec. Rebuilt to the spec's rule (same head, three times, no success between).
- A bare `Exit code 1` hashed as an error: grep with no match would have been flagged as a loop. Now no hash.
- **C-UNREF as first written flagged harness replies as a reflection loop.** Six of six sampled "runs" were a delegated agent answering task notifications with `end_turn` and a few dozen tokens. A reflection loop cannot be seen in Claude Code's logs through bare calls alone, because every bare call that ends its turn was answering something. The rule now needs the earlier calls not to have ended their turn, which fires almost never here; that is the honest result.
- `rows.push(...rows)` over 200,000 rows overflowed the stack on the real ledger; fixed.

## Not covered

- **C-UNREF has not been seen on a real positive**, only on constructed sequences. NOT VERIFIED beyond that. Codex and OpenCode logs, which may behave differently, were not run through it.
- **C-TRUNC does not match result sizes against a harness cap.** The spec allows it for truncations that carry no sentinel; across 277,917 results no size clusters at a cap (the sizes that repeat are the same files read again), so a size rule could only guess. Silent cuts with no sentinel are therefore invisible here.
- C-CHURN's "check" is any call that is not a read, a search or an edit; the ledger holds no command text, so a shell call that is not a test still resets the count. That errs toward flagging less.
- The dollars are the price of the calls from the stop point on, and an upper bound: the rules cannot show that stopping would have lost nothing. Other classes of section 7.4 are not built: C-BLOAT (DF-096), C-ABANDON, C-PR, C-REVERT, C-LANG.
- Only Claude Code logs carry result text, so these rules read nothing from Codex, OpenCode, a gateway or OpenTelemetry sources.
