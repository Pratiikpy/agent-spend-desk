# Compactions and cache losses: what the log records, and what it cannot (2026-10-25)

Features DF-096 and DF-089 built. DF-033 advanced (C-BLOAT exists; four classes of its list do not).

## What the ledger now keeps (schema 15)

- **Each compaction** Claude Code records (`system` line, subtype `compact_boundary`): when, what started it (`auto` or `manual`), the tokens the context held before, the tokens after (older clients may not say), and how long it took. Nothing the summary said is read, and the list of tools it found is not kept. A boundary with no session, time, or a size before is counted as malformed and not stored. On this machine: 338 compactions in 15 sessions, 134 of them written by delegated agents in their own logs (so each is tied to the log file it came from, and a delegated agent's compaction is never put on the thread that started it). Average context at a compaction: 808,000 tokens before and 194,000 after, largest 1,723,288; 323 of the 338 started on their own.
- **The client version of each call** (`tool_version`), so a cache lost after an update can be told from one that was not. 219,557 calls carry one; the rest come from logs that do not say.

`desk ingest --backfill` fills both into a ledger read earlier and replaces nothing that is there.

## DF-089: why a cache was written again

The autopsy named three causes. It now names five, in this order, each read from what the log records: **compaction** (the log's own record, with its sizes; it rewrites the start of the prompt whatever else happened), **model_switch**, **ttl_expired** (a pause longer than the cache lives; an expired cache would have been lost by any client, so this comes before an update), **client_update** (the version changed with none of the above to explain it; the explanation says plainly that this is the likely cause, not a proven one) and **prefix_changed**, which is what is left.

`prefix_changed` is the spec's own `unverifiable_redacted` case: a changed tool definition or system prompt would look exactly like this, and the Desk never keeps prompt text, so it cannot be told which and does not guess. The autopsy card says so. Over 150 days on this machine's ledger, 1,881 cache losses: ttl_expired 1,372, prefix_changed 373, model_switch 87, compaction 46, client_update 3. The compaction and update records moved 49 losses out of the unexplained pile.

## DF-096: C-BLOAT, a phase between two compactions

Each compaction ends a phase. The compaction threw away `before − after` tokens (the log's own sizes; when the log gives none, the size of the first call after it, said so). A phase that the compaction cut by more than 50,000 tokens and in which **nothing is known to have landed** is billed at the least those tokens cost: the price of writing a token to the cache once, taken from what the phase's own calls were charged. Files read again within three calls of the compaction that the phase had already read are counted, with their size estimated from characters at four a token.

**What "landed nothing" needs.** The first version billed every phase with no commit tied to the session: 330 of 338, $1,166. That was wrong in kind: only 3 of the 15 compacting sessions have any commit linked, and most ran in folders that are not repositories the ledger scanned, so "no link" meant "unknown". A phase is now one of four: **landed** (a commit tied to the session inside it), **possible** (the session's repository has a commit inside the phase that is not tied to it), **none** (the session ran in a repository the ledger scanned after the phase ended, and it has no commit inside the phase) and **unknown** (anything else). Only **none** is billed. On this ledger: 338 compactions, 13 phases in 2 sessions billed (4,777,198 tokens thrown away, at least $19.81), 8 landed a commit, 317 ran outside a scanned repository and are counted, not billed.

These dollars overlap the calls that carried the context and are not added to any other class.

## What ran

`tests/desk/compaction-ingest.test.ts` (the parser, its malformed cases, ingest, backfill, forget), `bloat.test.ts` (14), `waste-landing.test.ts` (the four landing states and the repository match, written with a different case, slashes and a trailing slash), the compaction and update cases in `autopsy.test.ts` and `explain-blocks.test.ts`, three cases in `waste-command.test.ts`, the migration test (schema 15). Full suite: 98 files, 1,313 tests. `desk waste` was run on this machine's ledger over 150 days.

## Not covered

- Tool-schema and system-prompt mutations are never named apart; the prompt text is not kept (the spec's `unverifiable_redacted` case).
- `client_update` is attributed by elimination and could be a coincidence; three events on this ledger.
- The commit coverage of a repository is what the ledger read when it scanned: a repository scanned from a recent date cannot show an older commit, so an old phase there can read `none` when a commit existed. Only two repositories are scanned here.
- Re-read tokens are estimated from characters; the tokenizer is not known.
- The 85%-of-window and under-2%-new-content forms of C-BLOAT in section 7.4 of the spec are not built; this is the compaction-phase form (DF-096). Codex and OpenCode record no compactions.
- The spec's `compaction_phases` and `cache_invalidation_events` tables are not kept: both are computed from the calls when asked.
