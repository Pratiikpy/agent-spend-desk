# Profile: composable-models/llm_multiagent_debate

Reader: Haiku (low effort), 2026-10-16, about 80 seconds, 84k tokens, 16 tool calls. Local clone. Paths relative to the repository root.

Spot-check (reviewer, against the files): no LICENSE file in the clone (confirmed by listing, so reuse rights are NOT VERIFIED and the code is treated as read-only reference); four task folders `math`, `gsm`, `biography`, `mmlu` and no shared debate engine (confirmed); a leftover `pdb.set_trace()` at `gsm/eval_gsm.py:142-143` (confirmed; the reader named the wrong files for it); a biography check on bullet count at `biography/gen_conversation.py:103` (confirmed). The retry-after-20-seconds loop and the 400-character early exit were not rechecked. Result: PASS on structure, two file references corrected.

## 1. What it is
Research code for multi-agent debate (Du et al., 2023): several model instances answer, read each other's answers, and revise over rounds.

## 2. Architecture map
One generation script and one evaluation script per task; each reimplements the loop. Output is a JSON of agent conversations per question.

## 3. Features and how each behaves
Typically three agents and two rounds on gpt-3.5-turbo. Round one is independent. Later rounds put the other agents' latest answers into the prompt and ask for an updated answer. Evaluation parses final answers and reports accuracy.

## 4. How people use it
Install four packages, set an OpenAI key, run a generation script then its evaluation script. Hardcoded dataset and file paths. No tests. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M5 critic loops and consensus)
Each agent keeps its own message history; a message built from the others' latest answers is appended each round; the final answer is the most frequent parsed answer. All agents are the same kind: no proposer, critic or evaluator roles. Rounds are fixed, with no convergence test.

## 6. Agent patterns
Homogeneous peers, shared view of full reasoning text, fixed rounds, most-frequent vote. No confidence branching.

## 7. Model and data layer
One hardcoded OpenAI model; public benchmark files; regex answer extraction.

## 8. Hackathon-care checks
Conversation JSON is a usable trace. No sample mode, no Docker, no tests, hardcoded paths, a debugger breakpoint left in an evaluation script.

## 9. Traps seen
Unbounded retries on API errors; fragile regex answer parsing that can return nothing; no check that debate beats a single answer inside the repo; no licence.

## 10. Reuse
No licence found: do not copy code. The idea (peer answers in the next prompt, majority vote) is a published method and can be implemented independently.

## 11. Verdict: REFERENCE ONLY for M5; implement the idea ourselves
Copy (as ideas): (1) peers' latest answers fed into the next round; (2) separate message histories per agent; (3) a majority vote over parsed answers.
Avoid: (1) identical agents with no roles; our critic is a separate attacker with its own evidence query; (2) fixed rounds with no convergence or budget rule; (3) code with no licence.
Where we are already ahead: roles, a bounded loop, verified evidence and a trace.
