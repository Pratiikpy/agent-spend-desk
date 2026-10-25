# Replaying an approved decision from its dossier (DF-110), 2026-10-25

`desk replay-decision <dossier folder>` re-executes the policy decision behind an approved dossier, offline, and compares every stage with what was attested when it was approved.

## What is recorded and signed

When a proposal that only narrows the current policy is issued for approval (`desk propose --dossier`), the Desk keeps, beside the pack: every request the model was asked and every reply or error it gave (keyed by the request's hash, in order), and the output of each stage of the pipeline: findings from the training period, the Drafter's draft, the Attacker's round and what it closed, the simplification, the restrict-only check, the replay on the training and held-out periods, which rules fired, and the digest of the final policy. Before it is kept, the pipeline is run again from the sessions as the dossier will carry them, with the recorded replies, and every stage must equal the live run's; a decision that does not replay (a redaction changed what a rule saw, a reply was not kept) is not attested, and the proposal says why.

On approval the record is signed (an in-toto statement in a DSSE envelope, by the key that signs the dossier) and written beside the dossier. The statement's subject is the digest of the dossier's manifest and its predicate carries the action digest the approval covers, so the record cannot be moved to another dossier or another action.

## What a replay does

1. Reads the dossier and verifies it at every level, including the recomputation of every cited figure from the rows. A dossier that does not verify is not replayed.
2. Verifies the record's signature against the pinned key, that it is bound to this dossier's manifest and action digest, and that the sessions it names are the sessions in the dossier.
3. Runs the pipeline again from the dossier's own sessions and policy documents, with each model request served from the recording (an unrecorded request, or one whose text changed, is a divergence and not a guess), with no network, no clock and no random choice in any stage.
4. Compares the eight stages in order. At the first stage that differs it stops, prints the paths at which the recorded and recomputed values differ, and exits 1. If all are identical, it checks that the policy the replay ends in is the one the approval covers and reports `V9-D: byte-identical reproduction`. The result is also stored in the ledger (`dossier_replay`, schema 28).

A policy-change dossier made before decisions were recorded, and a dossier of a kind with no agent stage (a month bill and a dispute pack are written by code from the figures), are recomputed from their rows only, and the output says so: `V9-D: not applicable`.

## What was run

`tests/desk/decision-replay.test.ts` (23): a decision replays identically on every run; a decision in which the model took part replays without calling the model; one in which the model failed first and the Desk fell back replays; the result is stored; the command line exits 0, and 1 on a divergence. Refused: a changed byte of the signed record; a dossier that no longer verifies; a record signed by another key; a record signed with the right key for another dossier; a missing pins file; a record naming other sessions or another action. Diverged: a stage altered and properly signed again (stops at that stage, names the path), and a model reply missing from the record. Capture: a decision that does not replay from the dossier's sessions is not attested. `desk prove`: `decision-replays-byte-for-byte-and-a-changed-record-is-refused` approves a proposal on the sample, replays it, and changes the record three ways.

## Not covered

- The Ask pipeline (Risk Router, Planner, Explainer, Auditor) is not replayed from a dossier: an Ask answer is re-run step by step with `desk verify-answer`, and its model replies are kept by the benchmark recordings, not in a dossier. No dossier of a month bill or dispute pack holds an Ask answer.
- The wall-clock limits of a live run are not part of a decision; a live run that ended because a time limit passed will not replay, and is then not attested.
- A signature proves the record came from the holder of the pinned key. It does not show the key is held by the person named; there is no transparency log (DF-102).
- A model reply is replayed as recorded. Nothing here shows the model would give the same reply again.
