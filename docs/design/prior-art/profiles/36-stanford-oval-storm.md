# Profile: stanford-oval/storm

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 456 seconds, 977 words. Local clone. Paths relative to `knowledge_storm/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright Stanford Open Virtual Assistant Lab (confirmed); the answering prompt tells the expert to give "the most relevant answer based on the available information" when the gathered text is not directly related, and otherwise to say it cannot answer, at `storm_wiki/modules/knowledge_curation.py:165-171` (confirmed); a generation error is logged and replaced by the fixed reply "Sorry, I cannot answer this question..." and an empty search by "Sorry, I cannot find information..." with a code comment that the expert should not hallucinate, at lines 232-241 (confirmed; logged, so not fully silent, but the reply is a canned string in the dialogue); the expert uses only the first snippet of each search result at line 220 (confirmed); defaults `max_conv_turn` and `max_perspective` exist at `storm_wiki/engine.py:134,140` (the value 3 was not rechecked). No Dockerfile, no tests directory (confirmed by listing). Result: PASS.

## 1. What it is
Stanford's research-to-article system: discover perspectives on a topic, simulate question-and-answer conversations grounded in search, build an outline, write a cited article, polish it. Co-STORM adds a human in a moderated round table. MIT.

## 2. Architecture map
`storm_wiki/` modules for persona generation, knowledge curation (conversation simulator with a question asker and a topic expert), outline generation, article generation, polishing; `collaborative_storm/` with a moderator, simulated user and mind-map knowledge base; retrieval modules for several web engines and a vector store; DSPy and LiteLLM model wrappers; a Streamlit demo.

## 3. Features and how each behaves
Pipeline stages can be run separately, and a run can restart from the saved conversation log. Outputs: conversation log, raw search results, draft and refined outlines, URL-to-info map, article, polished article, run config and a call history file. Limits per default: a few conversation turns, a few perspectives, three search queries per turn.

## 4. How people use it
`pip install knowledge-storm` or clone, keys in a secrets file, run an example script with stage flags, or the Streamlit demo; a local vector store with a CSV works as a private corpus. Issues and feedback: NOT VERIFIED. No automated tests; benchmark scripts live on other branches.

## 5. Mechanism for our module (M4 multi-perspective question asking, outline, cited draft)
Personas are generated from the table of contents of related Wikipedia pages plus a basic fact writer. Each persona asks questions in a simulated conversation; the expert turns a question into search queries and answers from the retrieved snippets. The information table de-duplicates snippets by URL and embeds them; each section retrieves its snippets by cosine similarity. Two-stage outline: draft from the model's own knowledge, then revise against the conversations. Lost: prior citations inside a snippet are stripped, only one snippet per result reaches the expert, and the citation numbers in the article are placed by the model without an entailment check (`article_generation.py:167`, not rechecked).

## 6. Agent patterns
Writer and expert roles, a two-pass outline refinement, a polishing pass that removes repeats; no verifier of citations; sequential stages.

## 7. Model and data layer
Separate model settings per stage (conversation, questions, outline, article, polish), a disk cache for model calls, many web retrievers, optional Qdrant corpus.

## 8. Hackathon-care checks
Good artefacts per run (conversation log, search results, config, call history) and replay from a saved log; offline route through the local vector store. Plain-text keys in a secrets file; a persona step fetches pages by URL without validation. Version string differs between `setup.py` and `__init__.py` (reader's account).

## 9. Traps seen
A prompt that allows an answer from unrelated information; canned replies in the dialogue when search or generation fails; unverified inline citations; evidence cut to one snippet; no tests.

## 10. Reuse
MIT: copy with credit. Candidate parts: perspective generation, question decomposition into queries, the two-stage outline refinement, the information table with a URL map, per-stage model assignment.

## 11. Verdict: ADAPT for M4
Copy: (1) several stakeholder perspectives asking questions of the evidence before writing (for us: compliance, treasury, fraud, vendor-relations views of one release case); (2) an outline that is revised against what was found; (3) a model assignment per stage, cheap for simulation, strongest for the cited explanation.
Avoid: (1) answering from unrelated material: if the evidence does not bear on the question, the answer is a recorded gap; (2) canned replies inside the dialogue; (3) citations placed by the model with no quote check.
Where we are already ahead: each sentence maps to a verified quote through a claim ledger.
