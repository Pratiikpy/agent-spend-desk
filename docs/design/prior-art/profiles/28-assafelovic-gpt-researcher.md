# Profile: assafelovic/gpt-researcher

Reader: Haiku (low effort), 2026-10-16, about 110 seconds, 96k tokens, 25 tool calls. Local clone. Paths relative to `gpt_researcher/` unless stated.

Spot-check (reviewer, against the code): Apache 2.0 (confirmed); the report writer refuses to write a report when no source material was gathered and says so, with a code comment explaining that a confident sourced-looking report must not be fabricated from nothing, at `actions/writer.py:78-88` (confirmed); the source curator guards against a non-list reply from a JSON repairer and falls back to the uncurated sources, with an error log at `skills/curator.py:84-106` (confirmed; the reader's "silent" is corrected, it logs); a `context/jev_filter.py` file exists (confirmed, its internals, thresholds and the quoted 73% against 46% were not rechecked: NOT VERIFIED). Result: PASS with one wording fix.

## 1. What it is
A research agent that plans questions, searches many sources, filters and curates context, and writes a cited report. Optional LangGraph multi-agent mode. Apache 2.0.

## 2. Architecture map
Planner (choose an agent role, outline sub-questions), executor (retrievers for web, local files, MCP and more, scraping, context filtering, source curation), publisher (report sections, references). A multi-agent orchestrator chains researcher, planner, writer, fact checker, visualiser and publisher. FastAPI backend, Next.js front end, Docker files, an `evals/` folder.

## 3. Features and how each behaves
Report types research, detailed and deep (a tree search over depth and breadth). Context filtering by a hosted relevance scorer (Jev) or a keyword ranking fallback. A curator model ranks sources by relevance and credibility. Empty context produces an explicit refusal instead of a report. References are the visited URLs, sorted for stable output.

## 4. How people use it
`pip install gpt-researcher`, set a model key and a search key, then `GPTResearcher(query=...)`, `conduct_research()`, `write_report()`; or the web UI; or Docker Compose. CI runs tests. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M4 planner, executor, publisher)
Plan by outline from first search results; retrieve in parallel; chunk (1,000 characters by default per the reader, not rechecked); filter chunks by a usefulness score; curate sources; write sections from curated context; append deduplicated, sorted references. Lost: a reference is a URL, not a quoted span, so a sentence cannot be traced to the text that supports it.

## 6. Agent patterns
One chosen role per research run in the single-agent mode; a multi-agent graph with a fact-checker step; fallbacks are uncurated sources and keyword filtering. No confidence branching.

## 7. Model and data layer
OpenAI-compatible and other providers behind a config; about 25 retrievers; embeddings default per the reader (not rechecked); optional vector store. State in memory and JSON logs.

## 8. Hackathon-care checks
JSON event logging with costs; Dockerfiles and compose present; no sample mode found; an evaluation folder for the filter; the quoted benchmark numbers are NOT VERIFIED. Keys in `.env`.

## 9. Traps seen
Curation falls back to uncurated sources on a bad reply; no timeout guards were seen on model or scraping calls (not exhaustively checked); a hosted scorer is an outside dependency; references are page-level only.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the refuse-when-empty rule, the curation step, deterministic reference ordering, the filter fallback chain.

## 11. Verdict: ADAPT for M4
Copy: (1) refuse to write a report when no evidence was gathered, with the reason shown; (2) a source-curation pass before writing; (3) a filter fallback chain, scorer then keywords then none, with the active level recorded.
Avoid: (1) page-level references: ours carry a verified quote; (2) fallback to uncurated sources without a flag in the output; (3) an outside scoring service in the critical path.
Where we are already ahead: the fact checker here is another prompt; ours is deterministic quote matching plus an attacker with its own query.
