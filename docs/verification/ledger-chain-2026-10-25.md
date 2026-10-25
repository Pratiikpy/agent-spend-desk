# The usage ledger's chain (2026-10-25)

Feature DF-071 built. The ledger is a SQLite file that is rewritten by design: a content block merges into a call, a price list is applied again, a forgotten session is deleted. A chain over its rows would fight that, so the chain is over what happens to the ledger, and a digest over the usage facts ties it to the rows.

## How it works

- **Events.** Every ingest (Claude Code, Codex, OpenCode), repricing, backfill and forget appends an event to `ledger_event` (schema 21): a gapless number, its kind, a small record of what it did (counts, never a path or text), the root of every source's digest, the hash of the event before it, and its own hash. The hash is the dossier log's (`computeRowHash`, over canonical JSON), so one verifier rule serves both. A run that reads nothing new is not an event.
- **Digests.** Each source file has a digest of the usage facts of its calls (id, session, time, model, the five token counts), taken when an event seals it. The event holds the root of all the digests.
- **A head file.** Each event's number and hash are also written to `<ledger>.head.jsonl` beside the ledger, a file that is chained itself. The specification mirrors this into the dossier log; a separate file was chosen because ingesting must not require opening the dossier database.
- **`desk ledger verify [--deep]`** checks all of it: the events (gapless, linked, each hash recomputed), the root against the sources, the head file against every event it names, each source's digest against its calls, and with `--deep` every stored cost worked out again from its tokens and the price list it names. A broken chain prints `E_LEDGER_CHAIN`, `E_LEDGER_ROWS` or `E_LEDGER_COST`, the event, source or call, and how to get back (rebuild from the logs with `desk forget --all --yes` then `desk ingest`, or restore a copy). It exits 1.
- **Fatal.** An ingest into a broken chain refuses, and `desk ui` puts a red banner naming the event and the way back on every screen while the screens still read what is there.
- A ledger read before the chain existed is adopted at its first event, which says so: what came before is vouched for only from that point.

## What ran

- `tests/desk/ledger-chain.test.ts` (18): the chain starts at the first ingest and links the second; a run that read nothing adds no event; the head file mirrors each event; an edited event is named; an event removed from the middle shows as a gap; events cut off the end are seen against the head file; an event forged with a valid hash is seen as replaced; a call's tokens edited by hand name the source file (and the chain alone stays intact, which is why the full check reads the calls); a call added or deleted by hand is seen; a digest edited to hide a change breaks the root the event sealed; a stored cost edited is seen by the deep check, and a cost whose price list was not supplied is counted as skipped, not guessed; a repricing and a forget made by the Desk are events and keep the ledger valid, while a deletion made by hand is not; an adopted ledger says so; a broken chain stops an ingest with the event and the restore command, and shows on every screen.
- **On the real ledger** (this machine's, 242,335 calls from 4,291 source files): one `desk ingest` sealed it (adopted), and `desk ledger verify --deep` took 5 seconds and worked **240,616 stored costs out again from their tokens and their price lists: none differed**. The other 1,719 calls are unpriced.
- `desk prove` has a check: the sample ledger verifies (66,654 stored costs work out again), and on a copy one call's token count and one event are edited and each is seen.

## Defects found on the way

- The first draft marked every ledger "adopted", because it was decided after the first ingest had already added the calls. It is now decided from the sources read before the event could seal them.
- A forged event written through the Desk itself also wrote its own line to the head file, so checking only the head file's last line passed it. Every line of the head file is now checked against the event it names.
- The migration tests compared whole source rows before and after an upgrade, and the new digest column differs by design; they compare the original columns.

## Not covered

- **A forgery that rewrites the head file as well** is not seen. The file is beside the ledger and is not signed; someone who can rewrite both can seal what they like. Mirroring the head into the signed dossier log, or signing the events, would close that and is not done.
- **Only the usage facts and the costs are covered.** A landing outcome, a task label, a session's folder and the Desk's own calls can change without the chain noticing.
- **Nothing before the first event is vouched for**, and a ledger whose first event adopted existing calls says so.
- **A cost priced from an owner's price or a price list that is not in `data/prices`** cannot be worked out again, and is counted as skipped.
- The chain shows the ledger was not changed after it was sealed. It does not show the logs were truthful, or that the sealing run read the right files.
- A rewrite in place of a whole source with the same digest (identical facts) is, correctly, not a change.
