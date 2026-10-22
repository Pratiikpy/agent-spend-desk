# Profile: morgan-coded/agent-bisect (finding the first broken step in a transcript)

Reader: Claude Sonnet, 2026-10-20. Remote read only (raw files via curl, no clone). Paths are relative to the repository root; line numbers are from the files as fetched on 2026-10-20. Nothing was executed: every accuracy figure below is the repository's own, not reproduced.

## 1. What it is
"git-bisect for agent runs": it ingests a Claude, Codex or foreign-format transcript into a hash-chained journal of typed steps, runs three deterministic gates over it, and reports the first visible breaking step, or abstains (README.md:7). Pure Python standard library (README.md:112). Licence: MIT, "Copyright (c) 2026 agent-bisect contributors" (LICENSE:1-3), read first. Stars 0, pushed 2026-06-29 (`gh api`, 2026-10-20). Last commit read: 93a4723, 2026-06-29. A one-author, young repository.

## 2. Architecture map
`ingest_claude.py` / `ingest_codex.py` / `foreign.py` normalize transcripts to `Activity` rows; `gates.py` (G1 schema, G3 test results) and `foldforward.py` (G2 edit causality) judge them; `localize.py` walks failures backward over a step graph; `replay.py` renders an explanation; `eval.py`, `inject.py`, `accuracy.py` measure it. The "replay" command is a read-only explain view; the README says it "does not replay the model" (README.md:94; replay.py:15-18).

## 3. Features and how each behaves
Kinds: `user_msg, llm_call, tool_call, file_edit, test_run, opaque_shell, unmapped, verdict` (model.py:12-21). Gates return `PASS`, `FAIL` or `NA`, and "`NA` is a coverage result, not a hidden pass" (DESIGN.md:22); G4 raises `NotImplementedError` (gates.py:86-87). G2 rebuilds file contents only from full-content `Write` anchors in the same run, never from disk (foldforward.py:12-18, :41-58). G3 parses recorded exit codes and test output, failing closed to `NA` (gates.py:59-83).

## 4. How people use it
`pip install -e .`, `agent-bisect demo` (README.md:36-49). Usage by others: NOT VERIFIED.

## 5. Mechanism for the Desk
Data model: `Activity(run_id, step_index, ts, kind, tool_name, inputs, outputs, target, parent_step, content_hash)` (model.py:47-58). The content hash covers those fields (:23-33); the journal chains records, each committing to the previous hash from a zero genesis, and `read_jsonl` rejects a broken chain (:35, :96-122, :164-173). Canonical JSON is sorted-key and compact (:38-40). Invariants are listed in INVARIANTS.md:3-13.

Localization rule (localize.py:61-115, :143-161): build a graph from `parent_step` links plus "a later step that reads or writes a file depends on every earlier step that wrote it". For each failing step, take the earliest failing ancestor as the root and group the rest as its cascade. Confidence is `HIGH` only if the path is fully structured; any opaque shell, unlinked step or heuristic shell-target edge makes it `LOW` (:215-258).

The idea to copy for the Desk is the **cascade**: "first break plus every step downstream of it" is a principled way to mark spend after a failure as retry or loop waste, and to say what the run could have saved by stopping at step N. What it loses:
- `Activity` has no tokens, model, price or duration (model.py:23-33). Cost per step would need to be added.
- It sees only 1.7% of real runs. STUDY.md reports 113 of 6735 runs with a gate-visible break (STUDY.md:9-19), because 53.1% of activities are opaque or unmapped (STUDY.md:17). On real data the gates fired only through G2 (203 steps) and G3 (316), with 0 G1 failures (STUDY.md:31-36).
- The headline 94.3% exact-step accuracy is on **injected** faults in clean runs: 1000 of 1151 are the trivial G1 schema class; G2 and G3 are 100% on only 90 and 61 injections (ACCURACY.md:7, :46-48, :63). Eligible G3 steps in the whole corpus: 84 (ACCURACY.md:40). It is not evidence of real-world attribution, and the author says so (ACCURACY.md:63-65).
- Semantic attribution is zero: Who&When exact-step 0 of 181 (README.md:32).
- Heuristics worth challenging (my reading of the code, not run): G3 treats a bare `pass` as a pass signal and `error:` or `exception` anywhere as a fail signal (gates.py:179-209), which can misread test names and log lines.
Better for the Desk: use a stable, sourced signal for "this step failed" (non-zero exit, test runner JSON, tool error flag) and keep abstain-by-default.

## 6. Agent patterns
None; offline analyser. Its discipline: smallest justified claim, abstain outside the envelope (DESIGN.md:34).

## 7. Model and data layer
No model calls. Claude ingest links by `tool_use_id` (ingest_claude.py:30-38); subagent transcripts are an open `TODO` (:17).

## 8. Hackathon-care checks
Offline, no keys, packaged demo; every number carries its denominator and caveat (README.md:23-34), the framing to follow.

## 9. Traps seen
A 94% headline from injected, G1-weighted faults; "0 false positives" on controlled probes only (ACCURACY.md:9-16, :49); not a replay system despite the command name.

## 10. Reuse
MIT: may reuse with credit. The hash-chained journal and the gate/cascade shape are small; rebuild in TypeScript.

## 11. Verdict: ADAPT
Copy: (1) the hash-chained journal of typed steps with canonical JSON, so a stranger can verify a trace offline; (2) first-break-plus-cascade to price "work after the first failure"; (3) three-state gates with `NA` as an honest coverage result and a published coverage rate next to accuracy.
Avoid: (1) quoting accuracy measured on injected faults as if it were real-world; (2) keyword-sniffing test output for pass or fail; (3) a step model with no cost fields.
