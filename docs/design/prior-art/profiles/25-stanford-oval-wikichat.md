# Profile: stanford-oval/WikiChat

Reader: Haiku (low effort), 2026-10-16, about 121 seconds, 92k tokens, 26 tool calls. Local clone. Paths relative to `pipelines/` unless stated.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); the query-search stage catches every exception, logs it and uses an empty result at `chatbot.py:44-56`, while the claim-search stage has no try block at `chatbot.py:77-89` (confirmed, the inconsistency the reader flagged is real); the retriever client logs an error on a non-200 reply and still parses the body at `retriever_api.py:71-76` (confirmed; a rate-limit reply raises); near-duplicate dialogue turns use a 0.8 similarity threshold at `dialogue_state.py:37-39` (confirmed). Version 2.1 and the 25-language count come from the README and were not rechecked. Result: PASS.

## 1. What it is
A fact-grounded chatbot that answers from Wikipedia (or your own documents) and checks its own claims before replying. Apache 2.0.

## 2. Architecture map
A LangGraph state graph with two parallel branches that merge: the user's query goes to search, and the model's own draft answer goes to claim extraction then claim search; then filter the evidence, draft with citations, refine, renumber citations. Entry points: a command-line chatbot and a Chainlit server. Retrieval through an HTTP retriever (Qdrant index, embedding server).

## 3. Features and how each behaves
Claim generation extracts self-contained factual claims from the model's own response. Each claim is searched. An evidence filter extracts the relevant snippet per passage. The draft stage writes the reply using only filtered evidence with numbered citations; the refine stage fixes flow while keeping citations; a final pass renumbers only the citations actually used.

## 4. How people use it
Install with pixi, set the model in a YAML file and keys in a git-ignored file, use the free hosted retriever or build a local index from a Wikipedia dump or your own JSONL, run the chatbot or the web server. Benchmark scripts exist. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M4 claim extraction and per-claim verification)
Two ways in to the evidence: from what the user asked, and from what the model itself would say. Claims are listed by a prompt that demands self-contained statements. The state per turn keeps the claims, the evidence per claim and the filtered snippets. Lost: there is no per-claim score; the draft is told to use the evidence, but nothing checks that each cited snippet really supports the sentence.

## 6. Agent patterns
One orchestrated pipeline with parallel branches; no critic loop and no confidence branching; the claim branch is skipped when no claims are found.

## 7. Model and data layer
Many models through LiteLLM, a configurable embedding model, Qdrant, optional LLM reranking, Redis for caching.

## 8. Hackathon-care checks
Every LLM call and prompt is logged to files; structured analysis of those logs is NOT VERIFIED. No offline sample mode; Docker Compose for the services only. Keys in a git-ignored file. No prompt-injection defence seen.

## 9. Traps seen
Inconsistent error handling between the two search stages (one swallows, one crashes); a non-200 retrieval reply is logged and then parsed; no per-claim support score; no cap on the number of claims or evidence blocks.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the claim-extraction prompt, the evidence-filter prompt, the citation renumbering.

## 11. Verdict: ADAPT for M4
Copy: (1) a claim extractor that demands self-contained statements; (2) a filter that keeps only the snippet of a passage that bears on the claim; (3) renumbering so only citations actually used appear, in order.
Avoid: (1) mixed error handling: every retrieval failure is recorded as a gap in the same way; (2) no check that a citation supports its sentence: ours requires a verbatim quote and a check; (3) parsing a reply after a logged error.
Where we are already ahead: evidence is gathered and verified before a decision, with a certificate; WikiChat's check ends at the filtered text.
