# The agents, and how the product answers Track 3

Moved out of the README so that it stays short. Everything here is unchanged; the README links here.

## How it answers Track 3

The track asks for "a novel ability to turn data, knowledge, memory, and reasoning into reliable decisions and actions." Here each of the five has a place and a test:

| | In desk. | Where |
|---|---|---|
| Data | Agent logs into a SQLite ledger; invoices, CI and roster through one Zetaris statement | `src/desk/ledger/`, `src/sponsors/zetaris/` |
| Knowledge | A price book, a policy language with a restrict-only check, owner definitions of "landed" | `src/desk/policy/`, `src/desk/pricing/` |
| Memory | Meterless H-MEM holds the owner's definitions and past decisions; the World Model holds what changed when | `src/engines/` |
| Reasoning | A typed program the Planner writes and code runs; an Auditor that rejects unsupported figures; a Drafter, an Attacker and a held-out replay for policy | `src/desk/ask/`, `src/desk/agents/` |
| Decisions and actions | A signed dossier, an approval echo, and a gate Claude Code calls before each tool use | `src/desk/dossier/`, `src/desk/gate/` |

## Do the roles earn their place?

Each role was taken out in turn on 60 preregistered questions, and each arm was compared with the full Desk on the same questions by the exact McNemar test (`docs/verification/ablation/RESULTS-ablation.md`, method and predictions in Addendum 7 of `docs/verification/benchmark/PREREGISTRATION.md`). The Planner is necessary on this set: without it 30 questions are lost and none gained. The plan critic, the revision loop, the Auditor (on good runs) and the Explainer are not shown necessary, which is an absence of evidence. The Auditor is necessary under a fault: with the Explainer's first figure corrupted on purpose, the arm that has the Auditor has 26 clean answers the arm without it does not. The specification says a role that fails such a test becomes code. The plan critic, the Auditor and the revision loop already are code; the Explainer is the one model role not shown necessary, and one set of 60 questions on one ledger is not enough to say it changes nothing, so it stays and the question is open.

## Which model should each role use?

The Desk was run on three Nemotron models, and on two mixes, on 60 new questions (set F, preregistered in Addendum 8 before any run; `docs/verification/mix/RESULTS-mix.md`). With the Planner on the 550B model and the Explainer on the 30B model it answered 60 of 60; with the Planner on the 30B model and the Explainer on the 550B model, 50, against 54 for the 30B model throughout. The Planner is where the larger model paid off in this run; one run per arm, so this is a pattern in 60 questions and not an established effect. `DESK_ROLE_MODELS` (for example `ask_planner=nvidia/...,explainer=nvidia/...`) sets a model per role, and every reply's signed receipt names the model that answered.

## The agents

| Agent | Role | Reads | Writes | Works with |
|---|---|---|---|---|
| Risk Router | A code classifier: is this a read of the ledger, or an action or policy change phrased as a question; flags text that tries to redirect the Planner | The question | A route (`read`, `spend_action`, `policy_change`) and flags | Planner |
| Planner | Turns the question into a typed program; may call `cannot_answer` | The question, the program schema | A program (spend, share, per-day, top sessions, landing, changes before, ...) | Plan critic, specialists |
| Plan critic | Checks the program against what the question needs (a share needs a numerator and a denominator) and sends the Planner back | The question, the program | A one-line objection or a pass | Planner |
| Specialists | Run each step read-only; code does every sum and percentage | Ledger, Zetaris facts, Meterless engines | Claims with their rows | Auditor |
| Auditor | Rejects any sentence whose figure no claim supports | The draft answer, the claims | Accept, or the sentences to fix | Explainer |
| Explainer | Writes the answer from claims; never sees the question, only what the program is about | Claims, a topic | The answer | Auditor |
| Drafter | Drafts a spend policy from the training month | Waste findings | A policy | Restrict check, Attacker |
| Attacker | Looks for requests that step around the policy | The policy | Counter-examples | Hardener |
| Canary | Runs a 52-task pack daily on two arms | The task pack | A verdict, an interval, the control arm | Gate, dossier |

The organizers' collaboration checklist asks for three of nine; desk. has all nine, each with a place to look:

| Item | Where |
|---|---|
| Planner delegates subtasks | The Planner's program steps are run by separate specialists (`src/desk/ask/specialists.ts`) |
| Specialist uses data or tools | Ledger queries, the Zetaris statement, Meterless engines |
| Evaluator critiques the output | The Auditor on every answer; the plan critic on every plan |
| Agent revises after critique | The Explainer revises at most twice; the Planner revises once after the plan critic; the Drafter after a failed check (`revision.applied` in the trace) |
| Risk agent flags unsupported claims | The Risk Router flags an action phrased as a question before anything runs; the Auditor flags unsupported figures after |
| Structured messages to shared memory | A claim ledger per run; H-MEM across runs |
| Branches on confidence | A plan the critic rejects goes back; a range with too few clusters is not called; a question the ledger cannot hold is declined |
| Fallback if data or an API fails | Every language role has a rule-based fallback; Zetaris and Nemotron fall back to recordings, then to the rule brain, and the trace says which |
| Final answer has traceable evidence | Each figure carries its claim and its rows; the trace says why each decision was made |

A human stays in the loop where it matters: the gate turns an `ask` into an allow only on the owner's approval, echoed back with its request id and action digest, it never overrides a deny, and it fails closed.
