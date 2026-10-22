# Profile: Alibaba-NLP/DeepResearch (Tongyi DeepResearch, WebAgent)

Reader: Haiku (low effort), 2026-10-16, about 69 seconds, 87k tokens, 19 tool calls. Local clone. Paths relative to `WebAgent/WebResummer/src/` unless stated.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); `MAX_LLM_CALL_PER_RUN` defaults to 60 and `MAX_CONTEXT` to 32 (thousand tokens) at `react_agent.py:16,20` (confirmed); the summary trigger `(RESUM and token_count >= max_tokens * 0.9) or round % summary_iteration == 0` at `react_agent.py:131-135` (confirmed); the summary client returns an empty string after all retries fail, with only a printed message, at `summary_utils.py:38-48` (confirmed). Not rechecked: the 30.5B and 3.3B model sizes, the 150-minute timeout, the 100-call limit in `inference/react_agent.py`, and the benchmark claims (NOT VERIFIED). Result: PASS.

## 1. What it is
Alibaba's open research-agent family for long-horizon web search: WebWalker, WebSailor, WebResearcher, WebResummer (ReSum) and WebWatcher, plus inference and evaluation code and published models. Apache 2.0.

## 2. Architecture map
Under `WebAgent/` one folder per agent; the context-management work is in WebResummer (ReSum) and WebResearcher. Shared tools: batched search (Serper), page visit (Jina reader with an extraction prompt), academic search, a Python interpreter. `inference/` runs many workers against vLLM servers; `evaluate.py` and a judge prompt score answers with a large model as judge.

## 3. Features and how each behaves
ReSum: when the context nears its token budget, or every N rounds, a summary tool compresses the history into a restartable state and the conversation restarts from system prompt, question and summary. WebResearcher: each round writes a private thought, a carried-forward report and an action, so history does not grow without bound. On context overflow the agent is forced to answer. Tool errors come back as text and the agent re-plans.

## 4. How people use it
Install requirements, copy `.env.example` and fill search, reader and file-parsing keys and the model path, prepare JSONL questions, launch the vLLM servers and workers with the provided script. Output is JSONL with the full message history and a termination reason. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M4 long-horizon context)
Token count is checked every round; at 90% of budget the recent messages go to a summary model with the question and the previous summary; the message list is rebuilt from the summary; the full trajectory is kept separately. Lost: details not in the summary are gone from the working context, replay from the summary alone is not faithful.

## 6. Agent patterns
ReAct loop with periodic state compression; no critic, no verifier, no confidence branching; a trajectory log kept apart from the working context.

## 7. Model and data layer
Any OpenAI-compatible server (vLLM in the examples); Serper, Jina and Dashscope keys; the open models are on public model hubs.

## 8. Hackathon-care checks
The JSONL trajectory is a real trace. No sample mode, no Dockerfile in the repository, heavy GPU setup for the full path. Benchmarks supported (BrowseComp, GAIA, WebWalkerQA); the numbers were not checked.

## 9. Traps seen
A failed summary returns an empty string and the run continues without it; two different token counters in different files (reader's account); no check that the summary kept the evidence needed for the answer.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the summarise-at-budget loop, the think, report, action round structure, the separate full-trajectory log.

## 11. Verdict: ADAPT for M4
Copy: (1) restart from a summary at a token budget while keeping the full trajectory on disk; (2) a carried-forward report each round in place of raw history; (3) a hard cap on model calls per run.
Avoid: (1) continuing after a failed summary: record the gap and stop or retry; (2) a summary that may drop evidence: our summary must keep every source id and quote handle so the trace can be rebuilt; (3) two token counters.
Where we are already ahead: evidence handles survive compression, so a verified quote can always be re-opened.
