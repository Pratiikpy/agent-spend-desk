# Profile: joonspk-research/generative_agents

Reader: Haiku (low effort), 2026-10-16, about 104 seconds, 90k tokens, 26 tool calls. Local clone. Paths relative to `reverie/backend_server/persona/cognitive_modules/` unless stated.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); recency is `decay ** i` over the position in the list, not elapsed time, at `retrieve.py:145-146` (confirmed); final score `recency_w * recency * 0.5 + relevance_w * relevance * 3 + importance_w * importance * 2` with a comment that the weights should be learned, at `retrieve.py:244-249` (confirmed); a bare `except` returning `{"this is blank": "node_1"}` at `reflect.py:48-55` (confirmed); reflection thoughts expire after 30 days at `reflect.py:124` (confirmed). Corrections by the reviewer: the reader called the API key "hardcoded"; the README has users paste their own key into a settings file, so no key ships in the repository (the search found none in `utils.py`). Result: PASS.

## 1. What it is
Code for "Generative Agents" (Park et al., 2023): simulated people with a memory stream, planning and reflection in a small town. Apache 2.0.

## 2. Architecture map
A persona loops through perceive, retrieve, plan, reflect, execute over three memories: spatial, associative (the memory stream) and scratch (short-term state). A Django front end replays saved simulations; a separate backend runs them.

## 3. Features and how each behaves
The memory stream holds three node types (event, thought, chat) with subject-predicate-object triples, a description, a poignancy score, keywords and an expiry. Retrieval scores each candidate on recency, importance and relevance (embedding similarity). Reflection fires when accumulated importance passes a threshold: pick focal questions from recent memories, retrieve context, ask the model for insights with evidence pointers, store them as thought nodes.

## 4. How people use it
Python 3.9, install requirements, put an OpenAI key in a settings file, run the Django server and the backend, open the demo page. Base simulations are included. Tests: NOT VERIFIED. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M6 memory stream, retrieval scoring, reflection)
Node store keyed by id, three ordered lists, keyword indexes, an embedding dictionary, saved as JSON files. The score is a weighted sum of three values each normalised to 0 to 1 (weights 0.5, 3, 2 times per-persona weights). Reflection nodes carry evidence ids, which is the useful part: an insight points back at the memories that support it. Lost: recency by list position ignores real elapsed time; nothing is updated or invalidated, memories only expire.

## 6. Agent patterns
Single persona loop; no critic; reflection is a model summarising its own memories. A failed insight parse returns a fabricated placeholder node with no log.

## 7. Model and data layer
Hardcoded OpenAI chat and embedding calls; JSON files on disk; no abstraction for swapping models.

## 8. Hackathon-care checks
Only prints for debugging; no structured trace. No sample mode other than replaying saved simulations; no Docker; no evaluation code in the repository.

## 9. Traps seen
The silent placeholder on any error; scoring weights fixed by hand; position-based recency; no rate-limit handling; memories are never corrected, only aged out.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the three-signal retrieval, thought nodes with evidence pointers, the importance-triggered reflection.

## 11. Verdict: ADAPT for M6
Copy: (1) retrieval as a weighted sum of recency, importance and relevance, with weights we calibrate on our cases; (2) reflections stored as nodes that point to their evidence; (3) a reflection trigger based on accumulated importance.
Avoid: (1) a placeholder result on error: fail visibly and record a gap; (2) recency by position: use real time and a validity window; (3) memories that can never be superseded: ours carry valid-from and valid-to.
Where we are already ahead: a learned rule must pass replay and a confirmation step before it enters memory; here a reflection is stored as soon as the model writes it.
