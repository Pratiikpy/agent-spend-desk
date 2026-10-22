# Profile: langchain-ai/open_deep_research

Reader: Haiku (low effort), 2026-10-16, about 98 seconds, 89k tokens, 28 tool calls. Local clone. Paths relative to `src/open_deep_research/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright LangChain (confirmed); defaults `max_concurrent_research_units` 5, `max_researcher_iterations` 6, `max_react_tool_calls` 10 at `configuration.py:65,95,108` (confirmed; the reader said the iteration default was unlisted, it is 6); the error string "Error synthesizing research report: Maximum retries exceeded" returned as research content at `deep_researcher.py:310,583` (confirmed); final-report retries truncate findings with `findings[:findings_token_limit]` at `deep_researcher.py:682` (confirmed). The benchmark numbers the reader quoted (for example 0.4344) were not rechecked: NOT VERIFIED. Result: PASS.

## 1. What it is
A LangGraph research agent: clarify the question, write a brief, run a supervisor that delegates to parallel researchers, compress findings, write a cited report. MIT.

## 2. Architecture map
Main graph: clarify with user, research brief, research supervisor, final report. The supervisor is a subgraph that calls a "conduct research" tool, which runs researcher subgraphs in parallel; each researcher searches, reflects, then compresses. Typed state with reducers.

## 3. Features and how each behaves
The supervisor plans with a "think" tool and delegates standalone instructions; researchers search (Tavily, native model search or MCP tools), reflect after each search with the think tool, and compress to a summary that keeps every source. The final report cites by number with a sources section. Overflow research calls are refused with an error message. On a token-limit error, findings are cut and retried, up to three times.

## 4. How people use it
Clone, `uv sync`, `.env`, start LangGraph Studio with the CLI, set models and search provider in the UI. An evaluation script runs the Deep Research Bench through LangSmith (cost stated in the README as $20 to $100). Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M4 research loop, evidence-gap re-planning)
Gap detection is a prompt: after each delegated result the supervisor asks "what is missing, delegate more?" via the think tool; the loop ends on a completion tool or the iteration cap. Citations: researchers keep raw tool output, compression assigns each URL a number, the report reuses them. Lost: when findings are truncated for the token limit, evidence is dropped by position with a log of nothing.

## 6. Agent patterns
Supervisor plus parallel researchers, a think tool for reflection, async gather with a concurrency cap, error messages as fallbacks. No separate critic or verifier of claims.

## 7. Model and data layer
`init_chat_model` for any provider, four model roles (summarise, research, compress, final), typed outputs, Tavily, MCP client.

## 8. Hackathon-care checks
No structured trace beyond LangSmith; no sample mode, so every run calls live models; Docker lines empty. Benchmark evaluation is included. No secrets in code.

## 9. Traps seen
A failed research unit returns an error string that the supervisor reads as content; truncation silently loses evidence; the "think tool never in parallel" rule is only in the prompt; the supervisor's sense of "enough" is a model judgment.

## 10. Reuse
MIT: copy with credit. Candidate parts: supervisor and researcher graph, the standalone-instruction delegation rule, compress-and-cite, the capped parallelism.

## 11. Verdict: ADAPT for M4
Copy: (1) delegation with fully standalone instructions per sub-task; (2) compression that keeps every source and numbers citations once; (3) a hard cap on parallel units and iterations.
Avoid: (1) error strings passed on as research content: record a failed unit as an evidence gap; (2) dropping findings by truncation without a trace entry; (3) prompt-only rules for tool ordering.
Where we are already ahead: a separate attacker for every finding, verbatim quote checks, and a trace of why each step ran.
