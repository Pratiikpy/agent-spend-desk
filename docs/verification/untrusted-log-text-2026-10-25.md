# Untrusted log text: what a planted instruction can and cannot do (2026-10-25)

Feature DF-072 built. Text that comes out of a log is written by whatever produced the log, and some of it goes to a model. This note says what the Desk does about that, and what was found when it was tested on purpose.

## What it does

- **A name that reads as an instruction is not shown to a model.** `src/desk/security/injection.ts` screens text for six kinds of instruction (ignore your rules, role markup that imitates a system message, you are now someone else, reveal secrets, drop your limits, a tool call). A label that matches is replaced by `withheld (instruction-like text)` wherever it would go into a prompt or a claim (`sanitizeLabel`), and a model id that is not a plain token, or that matches, is withheld from the planner's prompt.
- **The finding is kept.** After every ingest (Claude Code, Codex, OpenCode) the ledger is scanned, over distinct values, for the folder, branch, client version, edited paths and model names, and a row is written for each session, field and kind with a short excerpt cut down to plain characters and 80 characters (`untrusted_flag`, schema 18). It is idempotent, `desk forget` removes it with the session, and the session detail and the Sources screen show it ("Instruction-like text in the log").
- **Nothing a log says is read as a decision.** A model's reply is a typed program that code checks, a landing state comes from commits, a cap comes from a signed policy, a cost from tokens and a price. None takes a log's text as an input, so text that slips past the screen has nothing to act on.

## What ran (the systematic test)

`tests/desk/injection.test.ts` plants eight instruction texts (two phrasings of ignore, two kinds of role markup, a persona change, a request for secrets, a jailbreak, a tool call) in a session's folder, branch, client version, edited path and model name, and checks:

- the screen recognises each kind and leaves 14 ordinary names alone (a branch, a path, a model id, a version, a file named `IgnoreList.tsx`, a doc named `system-design.md`);
- the excerpt is at most 80 plain characters; every planted label comes out of `sanitizeLabel` as withheld;
- a finding is recorded for each of the five fields, once, with its kind; a clean session has none; a second ingest adds none; forgetting removes them;
- for four questions that reach the ledger's names, **no request a model is sent contains any planted text**, and no line that carries a planted name reads as an instruction;
- a model that does what the text says (it replies with an `approve_all` call and a plan with a `set_cap` op) is refused by the plan check, and Ask returns **the same status and the same figures as the rule planner**; no sentence says anything was approved or raised;
- the gate decides the same: five calls against a $6 day cap are allowed and denied in the same order with a planted project and person as with a plain one, for every planted text (the cap holds from the same call);
- calls and tokens per session are identical with planted names and plain ones.

`tests/desk/ui/untrusted-ui.test.ts` checks the session detail and the Sources totals, and `tests/desk/security-e2e.test.ts` and `tests/desk/security.test.ts` still hold.

## A defect the test found

The planner's prompt listed "Models seen" from the ledger as they were written, so a model id that carried `<tool_call>{"name": "approve_all"...}` or `ignore the above rules` reached the model verbatim. The earlier work had cut labels down to plain characters, but the model ids in the planner's coverage line were not labels. They now pass through `promptModelId`: a plain token (letters, digits and `. _ : @ / + [ ] -`) that does not read as an instruction, or `withheld`. The recorded benchmark replies are unaffected (real ids are plain tokens, so the prompt text is byte-identical; `desk prove` replays all three sets).

## What it cannot do

- **The screen is a set of patterns, not a proof.** A rewording they do not know passes it. The third rule is what holds then, and the tests above show it holding for the plan, the gate and the figures; they do not show it for a model the Desk has not been tried with.
- **A harmless name can match** (a branch called `chore/ignore-all-eslint-rules` does). It is withheld from a model and flagged for the owner, with the excerpt, and nothing else changes. The test states this case on purpose.
- The Sessions list and the other screens still show a flagged folder name as text, because a person reads it, not a model; the screen escapes it.
- Text a log carries in a language other than English, or hidden in characters the cut-down removes, is not recognised by the patterns (and is cut down to plain characters before it is shown to a model).
- The Explainer is shown claims whose names are cut down and withheld the same way; the Auditor rejects a figure no claim supports. That path was exercised through the rule planner and the stand-in model above, not with a live model that was shown planted text.
