# Reasoning and sponsor scorecard

Every number on this page is computed by `npm run desk -- scorecard` from files in this repository or from a run of the code, and the page is rewritten by that command; none is typed. `npm run desk -- scorecard --check` recomputes it and fails if this file differs by one byte. A quantity that was not measured says NOT VERIFIED, and one that does not exist for this product says so.

A result that goes against the Desk is published as it falls. A role that is not shown necessary is not claimed as useful and is not called useless: sixty questions cannot show that a part changes nothing.

Contents: Which roles of the Desk change an outcome; The model against the rule brain; Does the same question get the same answer when it is asked again; Are the tables reproduced from the recordings; What each Meterless engine changes in an answer; What Zetaris changes; Do the citations hold the answer up; Do policy attacks survive; Does confidence mean what it says; Cursor.

## Which roles of the Desk change an outcome

**Asks:** With one role taken out, are fewer questions answered exactly, on the same questions, by the exact McNemar test?

- The plan critic: not shown necessary. 0 questions only the full Desk got right, 0 only this arm, p = 1.000.
- The Auditor: not shown necessary. 0 questions only the full Desk got right, 0 only this arm, p = 1.000.
- The revision loop: not shown necessary. 0 questions only the full Desk got right, 0 only this arm, p = 1.000.
- The Explainer: not shown necessary. 0 questions only the full Desk got right, 0 only this arm, p = 1.000.
- The Planner: necessary on this set. 30 questions only the full Desk got right, 0 only this arm, p = 0.000.
- The Auditor necessary under this fault: with it 24 of 60 answers state a figure nothing asked for, without it 50 of 60. The fault is synthetic and says what the Auditor catches, not how often the model errs.
- Of the 8 predictions written before the run, 6 held, 2 held in part and 0 failed.
- A role not shown necessary is the absence of evidence on this set, not equivalence. It is not claimed as useful, and it is not called useless.

| Measure | Value | Note |
|---|---|---|
| A0, the model with no tools: exact answers | 12 of 60 |  |
| A0: answers stating a figure nothing asked for | 43 of 48 |  |
| A1, a plain tool-using agent: exact answers | 48 of 60 |  |
| A1: answers stating a figure nothing asked for | 5 of 46 |  |
| A2, the full Desk: exact answers | 60 of 60 |  |
| A2: answers stating a figure nothing asked for | 32 of 50 |  |
| A3, without the plan critic: exact answers | 60 of 60 |  |
| A3: answers stating a figure nothing asked for | 32 of 50 |  |
| A4, without the Auditor: exact answers | 60 of 60 |  |
| A4: answers stating a figure nothing asked for | 32 of 50 |  |
| A5, without the revision loop: exact answers | 60 of 60 |  |
| A5: answers stating a figure nothing asked for | 32 of 50 |  |
| A6, the Explainer replaced by code: exact answers | 60 of 60 |  |
| A6: answers stating a figure nothing asked for | 47 of 50 |  |
| A7, the Planner replaced by the rule planner: exact answers | 30 of 60 |  |
| A7: answers stating a figure nothing asked for | 42 of 51 |  |
| A2F, the full Desk, Explainer made wrong on purpose: exact answers | 45 of 60 |  |
| A2F: answers stating a figure nothing asked for | 24 of 46 |  |
| A4F, without the Auditor, Explainer made wrong on purpose: exact answers | 46 of 60 |  |
| A4F: answers stating a figure nothing asked for | 50 of 50 |  |
| plan critic: finding against the full Desk | not shown necessary | 0 questions only the full Desk got right, 0 only this arm; exact McNemar p 1.000 |
| Auditor: finding against the full Desk | not shown necessary | 0 questions only the full Desk got right, 0 only this arm; exact McNemar p 1.000 |
| revision loop: finding against the full Desk | not shown necessary | 0 questions only the full Desk got right, 0 only this arm; exact McNemar p 1.000 |
| Explainer: finding against the full Desk | not shown necessary | 0 questions only the full Desk got right, 0 only this arm; exact McNemar p 1.000 |
| Planner: finding against the full Desk | necessary on this set | 30 questions only the full Desk got right, 0 only this arm; exact McNemar p < 0.001 |
| Auditor under the fault: clean answers only with it, only without it | 26, 0 | exact McNemar p < 0.001; necessary under this fault |
| Prediction 1: A2 answers at least 54 of 60 exactly | held | 60 |
| Prediction 2: A7 answers at least 10 fewer exactly and is necessary | held | 30 fewer, necessary on this set |
| Prediction 3: A3 differs from A2 on at most 3 questions and is not shown necessary | held | 0 differ, not shown necessary |
| Prediction 4: A4 is within 2 questions of A2 and follows no hidden instruction | held | 0 apart, 0 of 5 followed |
| Prediction 5: A5 is within 2 questions of A2 and not shown necessary | held | 0 apart, not shown necessary |
| Prediction 6: A6 is within 3 questions of A2 and states a figure nothing asked for in at least ten points more of its answers | held | 0 apart; 94% against 64% |
| Prediction 7: Under the fault A4F shows a figure nothing asked for in at least 30 answers, A2F in none, and the Auditor is necessary | half held, half failed | A4F 50 of 50 (held); A2F 24 of 46 (failed); Auditor necessary (held) |
| Prediction 8: A6 and A7 use fewer model calls and fewer seconds per question than A2 | calls held; seconds NOT VERIFIED | calls per question: A2 1.8, A6 1.0, A7 0.8; the recorded seconds of arms that share a request with A2 are replay times and are not compared |

Reproduce: `npm run desk -- bench report --set E --db data/desk/sample/ledger.db`; `npm run desk -- bench run --set E --sample --arm A0,A1,A2,A3,A4,A5,A6,A7,A2F,A4F`. Seed 20261028.

Inputs: `docs/verification/ablation/set-e/results.jsonl` sha256:d3bfc17b8b07; `docs/verification/ablation/set-e/questions.json` sha256:cbe58fb0dd9c; `data/sample/bench-cassettes-e/` sha256:5a45c29422cd

What this does not show:

- 60 questions on a constructed ledger, one model, one run each at temperature 0; run-to-run variation was not measured on this set.
- The unanswerable and adversarial categories hold ten questions each, so a category-level difference is not testable here.
- The fault is synthetic. It measures what the Auditor catches, not how often a model makes the error.
- The Desk was not changed after set E was read. A change made from its misses would end its status as held out.

## The model against the rule brain

**Asks:** On the same questions, how much of the result depends on the language model?

- Replacing the model Planner with the rule planner leaves 30 of 60 questions exact against 60 of 60 (necessary on this set). The rule planner cannot compute a share, an average or a count of days.

| Measure | Value | Note |
|---|---|---|
| Model that served the recorded runs | nvidia/nemotron-3.5-super-vl-120b-a12b |  |
| Planner is the model, against the rule planner: exact answers | 60 of 60, 30 of 60 | exact McNemar p < 0.001 |
| Tool-calling success rate of the model through the provider | NOT VERIFIED | the rate is not published; the benchmark rows record answers, not tool-call attempts |

Reproduce: `npm run desk -- bench report --set E --db data/desk/sample/ledger.db`. Seed 20261028.

Inputs: `docs/verification/ablation/set-e/results.jsonl` sha256:d3bfc17b8b07; `docs/verification/benchmark/set-d/results.jsonl` sha256:05a44f81c09d

What this does not show:

- One model family, as served by the provider named above. A different model was not run.
- Latency is not compared: recorded seconds for arms that share a request with the full Desk are replay times.

## Does the same question get the same answer when it is asked again

**Asks:** pass^k: the chance that k sampled trials of one question are all exact, averaged over questions.

- The full Desk answers a question right in 89.4% of sampled trials and in all of 3 trials of the same question 85.0% of the time (pass^3).

| Measure | Value | Note |
|---|---|---|
| A0: exact at temperature 0 | 12 of 60 |  |
| A0: pass^1 | 19.4% | 60 questions, 3 sampled trials each |
| A0: pass^2 | 18.9% | 60 questions, 3 sampled trials each |
| A0: pass^3 | 18.3% | 60 questions, 3 sampled trials each |
| A1: exact at temperature 0 | 45 of 60 |  |
| A1: pass^1 | 75.6% | 60 questions, 3 sampled trials each |
| A1: pass^2 | 72.2% | 60 questions, 3 sampled trials each |
| A1: pass^3 | 70.0% | 60 questions, 3 sampled trials each |
| A2: exact at temperature 0 | 55 of 60 |  |
| A2: pass^1 | 89.4% | 60 questions, 3 sampled trials each |
| A2: pass^2 | 87.2% | 60 questions, 3 sampled trials each |
| A2: pass^3 | 85.0% | 60 questions, 3 sampled trials each |

Reproduce: `npm run desk -- bench report --set D --db data/desk/sample/ledger.db`. Seed 20261027.

Inputs: `docs/verification/benchmark/set-d/results.jsonl` sha256:05a44f81c09d; `docs/verification/benchmark/set-d/questions.json` sha256:69831925646d; `data/sample/bench-cassettes-d/` sha256:09ef8d90a88a

What this does not show:

- Sampled trials run at a temperature above zero; the figure for the greedy run is shown beside them.
- One model on one constructed ledger.

## Are the tables reproduced from the recordings

**Asks:** Re-running every recorded arm from the recorded model replies, with no network, gives the recorded answers and scores?

- Set D: all 720 recorded runs are reproduced from the recorded replies.
- Set E: all 599 recorded runs are reproduced from the recorded replies.

| Measure | Value | Note |
|---|---|---|
| Set D: recorded runs replayed from recordings, and how many differ | 720, 0 |  |
| Set E: recorded runs replayed from recordings, and how many differ | 599, 0 | 1 recorded runs ended in an error and are not replayed |

Reproduce: `npm run desk -- prove`.

Inputs: `docs/verification/benchmark/set-d/results.jsonl` sha256:05a44f81c09d; `docs/verification/ablation/set-e/results.jsonl` sha256:d3bfc17b8b07; `data/sample/bench-cassettes-d/` sha256:09ef8d90a88a; `data/sample/bench-cassettes-e/` sha256:5a45c29422cd

What this does not show:

- This reproduces the tables. It does not say the Desk wins, and it does not show the model would give the same replies again.

## What each Meterless engine changes in an answer

**Asks:** Asked the same question with the engine on and off, does the answer change, and is the changed answer the right one?

- World Model: asked "What changed before 2026-10-15?", the answer with the engine has 13 sentences and states the tool version planted on 2026-10-14; without it the question is unknowable.
- H-MEM: with a definition of landed remembered, the answer to "How much of our spend landed?" states it with the engine and does not state it without; "What did I tell you about landed work?" returns 2 of the owner's notes with the engine and none without, and a question no note is about returns 0.
- Markovian: on a generated twelve-month ledger of 3,744 calls, 5 of 5 year-long answers match the rows with the engine and 2 without it. The carry stays inside its budget and does not grow with the range; at this size it saves no tokens.
- Scout Intent: on 218 test questions (150 plain, 68 that ask for a change or a secret) 2.9% of the requests reach the planner as questions with Scout, 61.8% with the older word rules alone and 100.0% with Scout off; 0.7% of the plain questions are refused. The router reads the request before any step runs, and on a failure it refuses.
- Scout Intent with recorded nvidia/nemotron-3-embed-1b vectors in its second stage: intent top-1 on the paraphrases written for Meterless's registry goes from 0.625 to 0.764 (the gate still fails); the Desk's own four-way routing goes from 96.3% to 96.8% right, which is not a difference this question set can show.
- H-MEM: the engine ranks with its own hash embedder and is left as it is; beside it, nvidia/nemotron-3-embed-1b's recorded vectors read each note against the question. On 24 test questions the notes recalled that were not about the question fall from 63.6% to 50.0% and the number of questions that find a note they are about stays at 15 of 16; on the development questions, which the thresholds were chosen on, it rises from 13 to 15 of 20.
- The three vendored engines pass their own conformance runners (world_model 8/8, markovian 8/8, hmem 13/13) against https://github.com/Meterless/Meterless commit 0aa7417.

| Measure | Value | Note |
|---|---|---|
| World Model on: status, sentences, and states the planted tool-version change on its day | answered, 13, yes |  |
| World Model off: status, sentences, and states the planted change | unknowable, 0, no |  |
| H-MEM on: the answer states the owner's definition of landed | yes |  |
| H-MEM off: the answer states the owner's definition of landed | no |  |
| H-MEM on and off: the owner's notes returned for "What did I tell you about landed work?" | 2, 0 | with the engine off the Desk says: Owner memory is off, so nothing you told the Desk before can be recalled. |
| H-MEM on: notes returned for a question no note is about | 0 |  |
| Markovian on: year-long answers matching the rows | 5 of 5 |  |
| Markovian off: year-long answers matching the rows | 2 of 5 |  |
| Markovian: largest state carried, against its budget (estimated tokens) | 173 of 800 |  |
| Markovian: tokens saved over carrying the whole history, on this ledger | 0 | the periods are smaller than the state that carries them, so nothing is saved at this size |
| Scout Intent: 218 test questions routed to the right kind, with Scout, with the older rules alone, with Scout off | 96.3%, 76.6%, 68.8% | the test split was written before tuning and is reported, not tuned on |
| Scout Intent: of 68 test requests to change spend or policy or to reveal something, the share that reach the planner as questions: with Scout, rules alone, Scout off | 2.9%, 61.8%, 100.0% |  |
| Scout Intent: of 150 plain test questions about the ledger, the share refused | 0.7%, 0.0% | with Scout, rules alone |
| Scout Intent: test requests caught, by kind (spend change, policy change, unsafe), with Scout | 82.4%, 100.0%, 94.7% |  |
| Scout Intent: of 19 test questions that carry instruction-like text, the share flagged; of the clean ones, the share flagged anyway | 100.0%, 0.0% |  |
| Scout Intent: the 278 development questions the router was tuned on, same three settings | 96.4%, 80.6%, 75.5% | tuned on, so higher than it would be on questions nobody has looked at |
| Scout Intent: the Meterless harness's gate on its 32-example regression set | pass | the examples are the registry's own prompts, so this shows the harness runs, not that routing generalises |
| Scout Intent: the Meterless harness's gate on 142 paraphrases written for its registry (intent top-1, top-3, tool precision) | fail: 0.625, 0.875, 0.583 | hard lines missed: 15; the specification asks for intent top-1 of 0.85 or more |
| Scout Intent with recorded nvidia/nemotron-3-embed-1b vectors: the harness's gate on the same 142 paraphrases (intent top-1, top-3, tool precision) | fail: 0.764, 0.944, 0.750 | hard lines missed: 9; the merge range was chosen on the development paraphrases |
| Scout Intent with recorded vectors: 218 test questions routed to the right kind, and requests to change something that reach the planner as questions | 96.8%, 5.9% | with the built-in comparison: 96.3%, 2.9%; the difference is 2 of 68 requests |
| Owner's notes with recorded nvidia/nemotron-3-embed-1b vectors and by words alone: test questions that find a note they are about, and notes recalled that were not about the question | 15 of 16, 50.0% | words alone: 15 of 16, 63.6%; 14 notes, 24 questions, 0 of 8 questions about nothing found a note (words: 1) |
| Owner's notes, development questions the thresholds were chosen on: questions that find a note they are about, and notes recalled that were not about the question, with vectors | 15 of 20, 34.8% | words alone: 13 of 20, 53.6% |
| world_model: the vendored engine's own conformance checks passed | 8 of 8 |  |
| markovian: the vendored engine's own conformance checks passed | 8 of 8 |  |
| hmem: the vendored engine's own conformance checks passed | 13 of 13 |  |

Reproduce: `npm run desk -- prove`; `npm run desk -- engines year`; `npm run desk -- ask "What changed before 2026-10-15?" --sample --ablate world_model`. Seed 20261030.

Inputs: `src/desk/sample/year.ts` sha256:1cbf763a70dd; `evals/scout/desk/dev/routes.jsonl` sha256:338611fc155d; `evals/scout/desk/test/routes.jsonl` sha256:1887a3f77bd7; `evals/scout/regression-set/v1/` sha256:e3b0c44298fc; `evals/scout/regression-set/v2/` sha256:e3b0c44298fc; `src/desk/scout/registry.ts` sha256:e9162d9427a2; `evals/memory/` sha256:e8072c0c4fa5; `docs/verification/embed/recall.json` sha256:0d038f7983c1; `data/sample/cassettes/` sha256:8eecacdc120e

What this does not show:

- Scout Intent is the Desk's own implementation of Meterless's specification (Meterless ships no reference code for it): with no embedder its second stage is a hashed character-trigram stand-in for the specification's embedding, with the weights changed to match; with the recorded vectors it uses the specification's weights. The question sets, for routing and for the owner's notes, were written by the people who built the router.
- The embedding vectors are recorded from one model (nvidia/nemotron-3-embed-1b) and replayed; nothing here shows how a different model or a live endpoint would score, and live use sends the text of questions and notes to the endpoint only when DESK_EMBED=on.
- The three vendored engines are the Meterless reference implementations vendored into this repository, with the Desk's own wrappers. The Markovian chunk generator is code, not a language model.
- Each comparison is a handful of questions on a constructed ledger. They show the engine changes the answer, not how often it would on a real one.
- The twelve-month ledger is generated from a seed; no real user's year has been read.

## What Zetaris changes

**Asks:** With the organisational silos behind Zetaris and without them, what can the Desk say about the bill?

- With Zetaris the Desk joins invoices, CI and the team roster: 100.0% of the ledger is covered by invoices, 3 teams have a spend-per-landed-pull-request figure, and 792 pull requests have CI facts. Without it the invoice share is 0.0% and the table is empty.

| Measure | Value | Note |
|---|---|---|
| Zetaris on: how the four statements were served | cassette/cassette/cassette/cassette |  |
| Zetaris off: how the four statements were served | fallback/fallback/fallback/fallback |  |
| Billed share of the ledger's list-price estimate, with Zetaris | 100.0% | $6,123.23 of invoice amounts |
| Billed share, without Zetaris | 0.0% | every figure is an estimate |
| Teams in the spend-per-landed-pull-request table, with and without Zetaris | 3, 0 |  |
| Pull requests with known CI facts, with and without Zetaris | 792, 0 |  |

Reproduce: `npm run desk -- silos --sample`; `npm run desk -- silos --sample --no-zetaris`.

Inputs: `data/sample/cassettes/` sha256:8eecacdc120e

What this does not show:

- The silos are three synthetic sources seeded from the sample ledger. The statements are replayed from recordings made against a local Zetaris instance; this page does not run Zetaris.
- A fallback is labelled and never partial rows: with Zetaris off the Desk says what it could not join.

## Do the citations hold the answer up

**Asks:** Does each cited claim matter to its sentence, and do the answer's figures come from the ledger and not from the model?

- Of 195 citations on 194 sentences in 50 answers, 195 were needed by the sentence that made them and 0 were decoration.
- Perturbation: 50 answers read the ledger as it should (moved with a call inside their dates, held with one outside), 0 did not, 0 had nothing to perturb (a recalled note, a refusal).

| Measure | Value | Note |
|---|---|---|
| Answers written from the recordings (the rest were refused or unknowable) | 50 of 60 |  |
| Sentences, and citations they carry | 194, 195 |  |
| Citations the sentence needs, and citations that are decoration | 195, 0 |  |
| Answers whose figures moved when a known call was added, held when it was added outside their dates, and could not be tested | 50, 0 failed, 0 |  |

Reproduce: `npm run desk -- scorecard`; `npm run desk -- ask <question> --sample`. Seed 20261028.

Inputs: `docs/verification/ablation/set-e/questions.json` sha256:cbe58fb0dd9c; `data/sample/bench-cassettes-e/` sha256:5a45c29422cd

What this does not show:

- Necessity is read by the code Auditor: it says whether the sentence still passes without a claim, not whether a reader would still believe it.
- The exact movement rule is held for spend steps only; for other steps a figure that moved shows the answer reads the ledger, not that it reads the right rows.
- Steps with no dates are not perturbed.

## Do policy attacks survive

**Asks:** Can an edited policy widen what is allowed without the check noticing, and can a drafted rule be stepped round?

- The restrict-only check agreed with an independent oracle on 3000 policy edits (2545 narrowing): 0 widening edits got through and 0 narrowing edits were refused. A checker that always says "narrows" is caught on 55 of 400 pairs, so the fuzzer can see an escape.
- A drafted policy was probed for ways round it: 2 closed by a rule change that still narrows the policy, 2 left standing and shown on the approval card.

| Measure | Value | Note |
|---|---|---|
| Policy edit pairs checked against an independent oracle, and pairs that narrow the policy | 3000, 2545 |  |
| Edits the restrict-only check let through that widen the policy, and edits it wrongly refused | 0, 0 |  |
| A checker that always says "narrows": pairs on which it is caught | 55 of 400 |  |
| Evasions of a drafted policy found by probing, closed, and left standing | 4, 2, 2 |  |
| Landed sessions the hardened policy would block in the held-out period | 5 of 492 |  |

Reproduce: `npm run desk -- prove`; `npm run desk -- propose --sample --no-model`. Seed 20261022.

Inputs: `policies/daily-cap.yaml` sha256:e048326d5e99; `src/desk/prove/fuzz.ts` sha256:543b6576d117

What this does not show:

- The fuzzer generates policies from the checker's own grammar; an edit outside that grammar is not tried.
- The probing is code, run with the rule brain. A model attacker reading the same draft was not run for this page.

## Does confidence mean what it says

**Asks:** When the Desk ties a session to a commit and calls the link high, medium or low, how often is it right?

- Linked at each level against the planted truth of the constructed sample: high 518 of 522, medium 209 of 212, unlinked 237 of 253. The levels are ordered as their names promise.

| Measure | Value | Note |
|---|---|---|
| high: links that are right | 518 of 522 | 99.2%, 95% interval 98.0% to 99.7% |
| medium: links that are right | 209 of 212 | 98.6%, 95% interval 95.9% to 99.5% |
| low: links that are right | 0 of 0 |  |
| unlinked: links that are right | 237 of 253 | 93.7%, 95% interval 90.0% to 96.1% |
| High is at least as reliable as medium, and medium as low | yes |  |
| Linked sessions whose landing state matches the planted fate | 682 of 734 |  |
| Expected calibration error | not applicable | the confidence levels are words, not probabilities; a reliability table is reported instead, and no error is computed from them |

Reproduce: `npm run desk -- calibrate --sample`.

Inputs: `src/desk/calibrate/attribution.ts` sha256:eb98b5d479ce

What this does not show:

- Planted truth exists only in the constructed sample. On a real ledger the same table needs landing to be known, and on this machine's ledger it is known for a small share of sessions.

## Cursor

**Asks:** Is there a written record of the product being built in Cursor?

- The usage log is empty. No claim about Cursor is made on this page.

| Measure | Value | Note |
|---|---|---|
| Cursor sessions written down in the usage log | NOT VERIFIED | the log holds no session; nothing here claims Cursor was used |

Reproduce: `read docs/sponsors/cursor-usage-log.md`.

Inputs: `docs/sponsors/cursor-usage-log.md` sha256:73da795a6506

What this does not show:

- Counts the sessions in the file. It does not show what was done in them.

## Not measured

- Which roles of the Desk change an outcome: Prediction 8: A6 and A7 use fewer model calls and fewer seconds per question than A2. NOT VERIFIED: calls per question: A2 1.8, A6 1.0, A7 0.8; the recorded seconds of arms that share a request with A2 are replay times and are not compared
- The model against the rule brain: Tool-calling success rate of the model through the provider. NOT VERIFIED: the rate is not published; the benchmark rows record answers, not tool-call attempts
- Does confidence mean what it says: Expected calibration error. Not applicable: the confidence levels are words, not probabilities; a reliability table is reported instead, and no error is computed from them
- Cursor: Cursor sessions written down in the usage log. NOT VERIFIED: the log holds no session; nothing here claims Cursor was used
