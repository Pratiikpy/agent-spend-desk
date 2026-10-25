# The scorecard, and three defects found while building it (2026-10-25)

Features DF-109 (published reasoning scorecard) and DF-122 (sponsor scorecard).

## What it is

`npm run desk -- scorecard` builds one page, `docs/evaluation/reasoning-scorecard.md`, with the same figures in `docs/evaluation/reasoning-scorecard.json`. Ten sections: which roles change an outcome (set E, with the eight predictions written before the run checked against the rows), the model against the rule brain, repeat runs (pass^k on set D), whether the recorded tables are reproduced from the recordings, what each Meterless engine changes, what Zetaris changes, whether citations hold the answer up, whether policy attacks survive, whether confidence means what it says, and Cursor.

Every number is computed by the function that builds its section, from files in the repository or from a run of the code. `--check` recomputes the page and fails on any difference of one byte, and it is a `desk prove` check (`scorecard-recomputes-byte-for-byte`). `--write --sign` signs the JSON with the local signer (a DSSE envelope, the public key pinned beside it); `--check` verifies the signature and that the signed payload is the recomputed scorecard.

A result against the Desk is published as it falls: Prediction 7 half failed, and the page says so. Taking the plan critic, the revision loop or the Explainer out did not change an exact answer on set E, and the page says "not shown necessary", not "useless" and not "useful". Two measures are not made and are marked on the page: the model's tool-call success rate, and Scout Intent's routing effect (the engine is not built). The expected calibration error is marked not applicable, because the Desk's confidence levels are words and not probabilities; a reliability table is reported instead.

## Defect 1: the sample's landing figures changed with the real date, and would have broken the recorded replays

The sample's commits run to 4 November 2026 and a merged commit is read as "kept" once it is a week old. Landing was judged at the real time of day (`Date.now()`), so the same sample gave different landing figures on different days, and the model replies recorded against it (benchmark arms, Ask) are keyed by the questions put to the model, which carry those figures. The first scorecard run, with landing judged at 1 November, replayed set E with 9 of 599 runs different and the recorded set could not be reproduced. The next change of state was due at 15:42 UTC on 25 October; every `desk prove` replay, every `desk bench --sample` run and every `desk ask --sample` question that touches landing would have started to miss its recording from then on.

Fixed: the sample has a clock of its own (`src/desk/sample/clock.ts`, 24 October 2026 00:00 UTC, inside the interval in which every recording was made), used wherever the sample is read: `desk prove`, `desk card --sample`, `desk landing --sample`, the calibration wind tunnel and the scorecard. With it, all 720 recorded runs of set D and all 599 of set E are reproduced from their recordings. `tests/desk/sample-clock.test.ts` reads the sample on two different system dates and compares the landing states (it fails with the real clock restored), and checks that a later instant moves merged commits to kept.

Not covered: a sample ledger built by an older version of the Desk and read with this one, and recordings made after the clock was pinned (a recording is made against whatever state the question was put to; new ones are consistent by construction).

## Defect 2: the advertised recall question found nothing, and did not show the note when it did

"What did I tell you about landed work?" is one of the questions the Desk lists. With a note defining landed in memory it returned "No note of yours matches this question", and so did every other phrasing tried (even the note's own words). H-MEM's retrieval score is a hybrid with a hash-embedding part that is small for a short note and a question about it, and about the same for an unrelated question (a question about the weather in Paris scored 0.20 against a note about a billing module, a question about landed work 0.18 against the note defining landed), so no threshold separates them. No test had asked this question through Ask.

Fixed in two parts. A note is recalled when the engine ranks it and it shares a topic word with the question (words that only frame a question to a memory, such as "what did I tell you about", are not topics, and plain inflections match: landed, landing). A question that names no topic gets the newest notes. And the answer now shows the notes it rests on as the owner's own words, quoted under a label that says they are not claims of the Desk, in the command line and on the Ask screen; they stay outside the sentences the Auditor checks, so a figure in a note is not mistaken for one the Desk computed. `tests/desk/memory-recall.test.ts` (13) and `tests/desk/ui/ask-your-words-ui.test.ts` (3).

Not covered: retrieval quality beyond a shared word (the hash embedder is still the weak part of DF-116), and a note that uses a synonym of the question's word.

## Defect 3: a question took 0.2 seconds, of which 0.15 was rebuilding the same world

Every Ask rebuilt the World Model from the ledger. A world built from the ledger alone is read-only once built, so it is now reused while the ledger's state is unchanged (the key is the connection's data version, its total changes and the schema version, and nothing is kept inside a transaction or savepoint, because a rollback does not move those counters). The scorecard went from 6 minutes 18 seconds to 3 minutes 16 seconds with the same output. `tests/desk/changes.test.ts` checks reuse, a new world after a row changes, and that a world built inside a change that is rolled back is not kept (the test fails without the transaction guard).

## Not covered by the scorecard

A model attacker against a drafted policy (the probing on the page is code with the rule brain); a model other than the one that served the recordings; any run on a real person's ledger (the page is the constructed sample throughout); signature checking by anyone who does not hold the pinned public key's counterpart is limited to verifying, which needs no secret.
