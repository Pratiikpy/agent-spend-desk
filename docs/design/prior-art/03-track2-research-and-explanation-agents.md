# Prior art 03: research and explanation agents (Track 2)

Teardown of six open-source research/answering agents, read for one question: how does each one tie a conclusion to evidence, and does anything check that tie mechanically? Our target is an agent that explains why: every conclusion carries evidence spans that are mechanically verified, a counterfactual ("remove this evidence and the verdict changes to X"), and stated gaps and limits.

## Method and limits

- Date of reading: 2026-10-13. Repos are read-only shallow clones under `research/track-2-agent-that-can-explain-why/`. Commit ids below come from `git log -1` in each clone.
- **Static reading only.** Nothing was installed, imported or executed, and no network was used. Every statement about behaviour is inferred from source text and shipped result files. Where a statement depends on runtime behaviour it is marked NOT VERIFIED.
- Citations are `path:line` relative to each repo root. Benchmark numbers are quoted from files shipped in the repo and are labelled as the repo's own report unless a raw result file was also read.
- "Mechanically verified" means a deterministic check (substring or offset match of the quoted span in the stored fetched text, or an id that resolves in a stored bank). A second LLM reading the answer is not mechanical verification.
- Licences allow study; our rule is to rebuild ideas in our own code and not copy files. The licence is recorded so the rule can be applied.

| Repo | Upstream | Commit | Licence |
|---|---|---|---|
| `gpt-researcher` | assafelovic/gpt-researcher | 3582a68 (2026-10-10) | Apache-2.0 |
| `open_deep_research` | langchain-ai/open_deep_research | 1b7d2e8 (2026-08-10) | MIT |
| `deep-research` | dzhng/deep-research | 1f8f3e2 (2026-04-11) | MIT |
| `DeepResearch` | Alibaba-NLP/DeepResearch | f72f75d (2026-02-27) | Apache-2.0 at root; `WebAgent/` carries its own MIT licence file |
| `deep-searcher` | zilliztech/deep-searcher | ddc36db (2026-09-22) | Apache-2.0 |
| `WikiChat` | stanford-oval/WikiChat | 803683b (2026-01-30) | Apache-2.0 |

---

## 1. gpt-researcher

### 1. What it is
A planner/executor research system with several entry modes: a single-pass research report (`gpt_researcher/agent.py`), a recursive "deep research" mode (`gpt_researcher/skills/deep_research.py`), a LangGraph multi-agent pipeline (`multi_agents/`), and a "deep agent" harness used for benchmarking (`deep_agents/`). By far the largest of the six, with the most shipped evaluation material.

### 2. Architecture and loop
- **Base flow is single pass, not a loop.** `GPTResearcher.conduct_research` (`gpt_researcher/agent.py:343`) picks a role prompt (`choose_agent`), generates sub-queries once, runs `_process_sub_query` for each in parallel (`gpt_researcher/skills/researcher.py:520`), compresses scraped pages per sub-query, and returns one big context string. `MAX_ITERATIONS` (default 3, `gpt_researcher/config/variables/default.py:26`) is the number of sub-queries generated (`gpt_researcher/actions/query_processing.py:113`, `gpt_researcher/prompts.py:246`), not a refinement loop.
- **Context filtering.** Pages are chunked (1000 chars) and kept by embedding similarity (`gpt_researcher/context/compression.py`), or by Jev scoring (`gpt_researcher/context/jev_filter.py`), or by a BM25 "keyword" fallback described in `evals/context_filter/README.md`. Optional LLM source curation (`gpt_researcher/skills/curator.py`).
- **Writer.** One LLM call writes the report from the context string (`gpt_researcher/skills/writer.py:49`, `gpt_researcher/actions/report_generation.py:209`).
- **Deep research mode** is a close port of the dzhng recursion (section 3), with an added `sourceUrl` per learning: breadth 3, depth 2, concurrency 4 by default (`default.py:40-42`), breadth halved per level (`deep_research.py:540`), terminates early when a level yields nothing (`deep_research.py:511`).
- **Multi-agent mode** (`multi_agents/agents/orchestrator.py:65-105`): browser (initial research) -> planner -> optional human plan review -> parallel section researchers -> writer -> fact_checker -> (loop back to writer) -> publisher. Roles: `editor.py`, `researcher.py`, `writer.py`, `reviewer.py`/`reviser.py` (draft review against user guidelines, off by default: `multi_agents/task.json:11` `follow_guidelines: false`), `fact_checker.py`, `publisher.py`.

### 3. How claims are tied to sources
- **Format.** Prompts demand inline markdown hyperlinks, `([in-text citation](url))`, plus a references list (`gpt_researcher/prompts.py:309-312`), including "Every substantive claim, figure or quote MUST carry an in-text citation ... Do NOT cite sources that do not appear in the provided information" (`prompts.py:310`).
- **Mechanism.** The context handed to the writer is `Source: <url> / Title: / Content: <chunk>` blocks (`prompts.py:555-561`). The writer LLM chooses which URL to attach to which sentence. Nothing in the runtime checks that the URL belongs to the context, that the cited chunk contains the claim, or that a quoted figure appears in it. **Asserted, not verified.**
- **Deep mode.** (A close port of the dzhng recursion; see section 3.) Learnings carry an LLM-supplied `sourceUrl` (`deep_research.py:367-384`, parsed at `:158-170`). The URL is not checked against the visited set. Learnings are keyed by their own text in a dict (`citations[learning] = citation`, `:170`, `:203`), so two sources giving the same learning text collapse to one URL. Final learnings are de-duplicated with `list(set(...))` (`:579`), so ordering and per-source multiplicity are lost.
- **Fact-checker agent does not see sources.** `multi_agents/agents/fact_checker.py:12-30` builds the prompt from the introduction, `research_data` (the already-written section drafts) and the conclusion. No scraped text is included, although the system prompt says it reviews "based on the provided research context". This is an LLM re-reading its own draft, not a fact check. A README-level description of a fact-checking agent is therefore not backed by a check against evidence. The revision limit is enforced by raising `MaxFactCheckRevisionsExceededError` (`multi_agents/agents/fact_review.py:17`), i.e. at the limit the run errors instead of returning the best draft with a stated limit.
- **Offline structural metric.** `evals/quality_eval/metrics.py:68` `citation_faithfulness` only checks that sources listed under References are cited in the body (a decorative-reference detector). Its own README states the semantic version is "on the roadmap" (`evals/quality_eval/README.md`).
- **Claim support metric.** `unsupported_claim` (`metrics.py:471`) extracts 3-10 claims and has an LLM label each supported/inferred/unsupported, but feeds it `context_text[:4000]` (`metrics.py:457`), so a claim supported by anything past the first 4000 characters can be scored unsupported. A failed verification call scores 0.0 "unsupported" (`metrics.py:466`), which is the safe direction.

### 4. Contradictions, weak evidence, failures, bounds
- **Contradictions.** No code path compares sources for disagreement. `grep` for "contradict", "conflict", "majority", "consensus", "most frequent" over `gpt_researcher/` (excluding `mcp/` and `retrievers/`) returns nothing. The README (`README.md:357`) says reliability comes from "choosing the most frequent information"; no code does this, and `evals/context_filter/README.md` states that cross-source recurrence "isn't a signal available at this step" (URLs are deduplicated before scraping, "0 of 300 pages recurred"). **README claim not backed by code, and contradicted by the project's own eval README.**
- **Weak evidence.** Source quality is a prompt-level instruction ("prioritize new articles ... if the source can be trusted", `prompts.py:307`) plus an eval-only domain-authority heuristic (`.gov`=1.0 ... `.com`=0.5, `evals/quality_eval/README.md`). Not used at runtime.
- **Failed fetches.** Good hygiene in the scraper: SSRF/local-file rejection (`gpt_researcher/scraper/scraper.py:203`), content under 100 chars rejected (`:232`), anti-bot challenge-page detection (`:242`), raw-PDF-bytes detection and word-list detection (module header). Failures return `raw_content: None` and are filtered out (`scraper.py` `run()`), with a log line only. The user-visible report does not say which sources failed.
- **Silent degradation.** `_get_context_by_web_search` returns `[]` on any exception (`researcher.py:405-408`). `generate_report` retries once, then prints the error and returns an empty string (`report_generation.py:324`). Against this, the writer has an explicit abstain guard: with no context it returns "I could not gather any source material ... I am not able to produce a reliable, sourced report" (`writer.py:79-88`). That guard is the best behaviour in the six repos on this axis and we should keep the idea. It covers only the all-empty case.
- **Bounds.** Sub-query count, deep breadth/depth/concurrency, fact-check revision cap, per-request timeouts (10 s in `scraper/beautiful_soup/beautiful_soup.py:70`, 100 s on Tavily `retrievers/tavily/tavily_search.py:99`), cost tracking. No global wall-clock or token budget for a run.

### 5. Evaluation shipped
- `evals/simple_evals/` (SimpleQA grader). `evals/hallucination_eval/` (LLM judge from the `judges` package, `evaluate.py:8`; shipped result file `results/aggregate_results.json` has 2 queries, 1 flagged hallucinated, rate 0.5).
- `evals/quality_eval/` with six metrics and `perturbation.py`, which degrades a report (remove citations, swap sources to low-authority, flip polarity of claims) and checks that metrics move monotonically. This validates the metrics' sensitivity, not whether a conclusion depends on a piece of evidence; it perturbs the report, not the evidence.
- `evals/context_filter/`: the strongest methodological asset. `collect.py` records the exact `(sub_query, pages)` pairs from 28 real tasks; `replay.py` rebuilds contexts with each filter strategy from those frozen pages and rewrites the report with the same model; `judge.py` does blind pairwise comparison in both orders and counts a win only if it wins in both. Results are shipped in `evals/context_filter/results/`. Caveats stated by the authors: 28 questions, one judge model family, which also writes the reports. The benchmark was contributed alongside a vendor's product (Jev), which is a conflict of interest to remember when reading the headline numbers.
- `deep_agents/`: runs 10 stratified DeepResearch Bench tasks. Raw result files are shipped: `deep_agents/benchmark_results/drb/gptr-deepagent_fact_result.txt` gives 62.9 total citations, 35.2 valid, valid rate 0.5596; the Tavily baseline gives 34.5 / 18.6 / 0.5391. **Even the best configuration has about 44% of its citations not supported by the cited page** under the benchmark's FACT check (fetch the cited URL, judge whether it supports the claim). `deep_agents/BENCHMARK.md` does report the precision in its results table (53.9% to 56.0%), but its prose headline is the count ("~2x the verified evidence"). Meanwhile `README.md:27` describes the output as "detailed, factual, and unbiased research reports with citations"; the shipped numbers do not support "factual" as an unqualified description. 10 tasks, one run per agent, judge models self-reported (NOT VERIFIED beyond the shipped result files).

### 6. Reproducibility / offline
Needs an LLM and a search backend. A local-document mode (`report_source=local`, `DOC_PATH`) and local LLMs via providers are supported, so a network-free run is plausible but no recorded-response mode exists for LLM or search calls. The only replay is the context-filter replay of frozen scraped pages (LLM calls still live). `JSONResearchHandler` (`gpt_researcher/utils/logging_config.py:7`) writes a JSON event log (query, sub-queries, content found, costs, final context).

### 7. Licence and commit
Apache-2.0. 3582a6841fe7dc801e2a34e34ee408641aea9bce, 2026-10-10.

### 8. ADOPT / BEAT
- ADOPT (as ideas, rebuilt): abstain-when-empty guard; scraper rejection rules (challenge page, raw PDF, tiny content, SSRF check); collect-then-replay evaluation with frozen inputs and both-order pairwise judging; relative-threshold relevance filtering (the finding that the threshold, not top-k, does the work); the idea of perturbation testing; FACT-style "re-fetch the cited page and judge" as the outside check on our own citations.
- BEAT: citation is an unverified URL; the "fact checker" has no evidence; contradiction handling is a README sentence; no stated gaps (failed sources vanish); the revision cap raises instead of degrading honestly.

### 9. NOT VERIFIED
Whether any run produces cited URLs outside the context (never executed). Whether the multi-agent `research_data` really lacks source text at runtime (read from `fact_checker.py:16` and the orchestrator edges; the editor's section structure was not traced end to end). The quality of the Jev/BM25 numbers (author-reported, single judge family). Live upstream state.

---

## 2. open_deep_research (LangChain)

### 1. What it is
A LangGraph deep-research agent: clarify -> brief -> supervisor with parallel sub-researchers -> single report. README places it #6 on the Deep Research Bench leaderboard (RACE 0.4344, August 2025); the research clone README notes the upstream is archived (not re-checked live). Legacy workflow and multi-agent versions live in `src/legacy/`.

### 2. Architecture and loop
`src/open_deep_research/deep_researcher.py`:
- `clarify_with_user` (`:60`) optional, structured output `ClarifyWithUser`.
- `write_research_brief` (`:118`) turns the conversation into a research brief and seeds the supervisor.
- **Supervisor** (`:178`, tools `ConductResearch`, `ResearchComplete`, `think_tool`) and `supervisor_tools` (`:225`) which fans out up to `max_concurrent_research_units` (default 5) sub-researchers in parallel with `asyncio.gather` (`:295-305`). Ends when iterations exceed `max_researcher_iterations` (default 6), no tool calls, or `ResearchComplete` (`:247-262`).
- **Researcher** (`:365`) is a ReAct loop with search + `think_tool` (+ MCP tools), capped by `max_react_tool_calls` (default 10, `researcher_tools` `:493-503`). The prompt tells it to stop after 5 searches (`prompts.py:168`); the code cap is 10.
- **compress_research** (`:511`) rewrites the researcher's whole transcript into a cleaned summary with inline `[n]` citations and a Sources list, 3 attempts (`:542`). `raw_notes` keep the uncompressed text in state.
- **final_report_generation** (`:607`): one writer call over concatenated compressed notes, with up to 3 retries that truncate findings by characters on token overflow (`:682`).
- The only reviewer-like role is the supervisor's `think_tool`, whose reflection is just echoed back ("Reflection recorded", `utils.py` `think_tool`). There is no critic of claims.

### 3. Claims to sources
- Search tool (`utils.py:42-120`): Tavily results are deduplicated by URL, each page's `raw_content` is cut to `max_content_length` (default 50,000 chars, `utils.py:104`) and **summarized by an LLM** into `summary` + `key_excerpts` (`Summary` model, `state.py`). The model sees "SOURCE n: title / URL / SUMMARY" blocks.
- Researcher output is then compressed again (`compress_research_system_prompt`: "repeat key information verbatim", `prompts.py:190-226`), and the writer cites with numbered `[n]` plus Sources (`prompts.py:298-307`).
- **Asserted, doubly lossy.** The writer works from a summary of a summary. `key_excerpts` are model-produced "quotes" and are never checked against `raw_content`. No id, offset or hash links a sentence to a page. Citation numbering is assigned by the LLM and renumbered by prompt instruction only ("Number sources sequentially without gaps", `prompts.py:215`), not by code.
- If summarization fails or times out (60 s), the code falls back to the raw page text (`utils.py:195-213`), which silently changes what the researcher is reading.

### 4. Contradictions, weak evidence, failures, bounds
- Contradictions: none in code. The compression prompt only folds duplicates ("if three sources all say X, you could say these three sources all stated X", `prompts.py:192`).
- Weak evidence: none beyond the supervisor prompt asking for "3+ relevant examples/sources" as a stop signal (`prompts.py:172`).
- Failures: tool errors are returned as the string `Error executing tool: ...` and fed back as an observation (`execute_tool_safely`, `deep_researcher.py:427`). In `supervisor_tools` any exception from the research fan-out ends research quietly, because the guard is `if is_token_limit_exceeded(...) or True:` (`:334`), so a non-token error is treated identically to a token overflow and the report is written from whatever notes exist, with no stated failure. If compression fails 3 times the note is the literal string "Error synthesizing research report: Maximum retries exceeded", which flows into the report writer as if it were findings (`:310`, `:583`). Overflow research calls get an error tool message, not silent dropping (`:316-321`), which is good.
- Bounds: iteration, tool-call and concurrency caps, 60 s summarization timeout, retry caps (`max_structured_output_retries` 3). No wall-clock budget, no token budget across the run, cost visible only via LangSmith.

### 5. Evaluation shipped
`tests/run_evaluate.py` runs the agent on Deep Research Bench via LangSmith; `tests/evaluators.py` defines LLM-judge scores (overall quality in six sub-scores, relevance, structure, correctness vs reference, completeness) and `eval_groundedness` (`:134`), which extracts claims from the report and asks GPT-4.1 whether each is grounded in `str(outputs["raw_notes"])`. Result tables are in the README (GPT-5 0.4943, defaults 0.4309, Sonnet 4 0.4401, bench submission 0.4344; cost $46-$187) and JSONL outputs in `tests/expt_results/`. RACE scores measure report quality against reference reports, not citation truth. The groundedness evaluator is the only claim-level check and it is an LLM judge over a flattened string, not a mechanical match. The README does not publish a groundedness number (NOT VERIFIED whether one was ever computed).

### 6. Reproducibility / offline
No offline path. Needs LLM keys and Tavily (or native provider search, DuckDuckGo, Exa, MCP). No record/replay. Tracing is LangSmith (an external service), not a local file.

### 7. Licence and commit
MIT. 1b7d2e80db9faa586165c60e09096dbbfd483a64, 2026-08-10.

### 8. ADOPT / BEAT
- ADOPT: the supervisor/researcher split with hard, configurable caps; keeping `raw_notes` separate from the compressed notes (it is what makes a post-hoc mechanical check possible, though the repo never does one); explicit error observations to the model; overflow handling as an error message rather than silent drop.
- BEAT: two stacked LLM summarizations before the writer; unchecked `key_excerpts`; `or True`; the error string passed downstream as a finding; numbered citations with no code-level resolution; the `think_tool` as a trace artefact that is not machine-usable.

### 9. NOT VERIFIED
Actual citation accuracy of produced reports (no shipped FACT or equivalent run); whether upstream is archived today; model behaviour under the 50,000-char cut; that `or True` was introduced deliberately (the comment trail was not read; git history is shallow).

---

## 3. deep-research (dzhng)

### 1. What it is
A minimal reference loop for iterative deep research (gpt-researcher's deep mode follows the same structure and vocabulary): `src/deep-research.ts` (294 lines) plus a CLI (`src/run.ts`), an Express API (`src/api.ts`) and a Firecrawl search call. The README says the goal is under 500 lines.

### 2. Architecture and loop
- `generateSerpQueries` (`:40`): LLM returns up to `breadth` queries, each with a `researchGoal`.
- For each query (concurrency 2 by default, `p-limit`): Firecrawl `search(..., timeout: 15000, limit: 5, scrapeOptions markdown)` (`:221-226`), then `processSerpResult` (`:81`): up to 3 "learnings" (strings) and follow-up questions from the concatenated page markdown, each page trimmed to 25,000 tokens (`:93`), with a 60 s abort (`:99`).
- Recursion: next query is "previous research goal + follow-up directions"; breadth is halved (`Math.ceil(breadth/2)`, `:230`) and depth decremented (`:231`); stops at depth 0. Total work is therefore bounded by construction (geometric in depth).
- Final: `writeFinalReport` (`:120`) or `writeFinalAnswer` (`:149`) over **all learnings only**.
- Roles are prompts, not agents: query planner, learning extractor, report writer. The "feedback" step (`src/feedback.ts`) asks the user clarifying questions up front.

### 3. Claims to sources
- A learning is a bare string. It carries no URL, no quote, no offset (`ResearchResult = { learnings: string[]; visitedUrls: string[] }`, `:20`).
- The report ends with `## Sources` listing every URL returned by every search (`:145-146`). These are the URLs searched, not the URLs that support each statement, and fetch failures are not excluded (`newUrls` is taken from `result.data` before processing, `:227`). The shipped `report.md` demonstrates the format: a prose report followed by a flat URL list (`report.md:173`).
- **No tie exists between a claim and its source**, mechanical or asserted. This is the weakest provenance of the six.
- Worse, the system prompt tells the model: "assume the user is right when presented with news", "Value good arguments over authorities, the source is irrelevant", "You may use high levels of speculation or prediction, just flag it" (`src/prompt.ts:4,12,14`). Provenance is explicitly demoted.

### 4. Contradictions, weak evidence, failures, bounds
- Contradictions: none. Learnings are de-duplicated by exact string through `new Set` (`:291`).
- Weak evidence: none.
- Failures: the whole per-query branch is in a `try/catch` that logs and returns `{ learnings: [], visitedUrls: [] }` (`:275-284`). A failed search, a timeout and a parse error all look like "this query found nothing", and the report is still written, with no note about what was lost.
- API bug: `/api/generate-report` computes the report then does `return report` instead of `res.json(...)` (`src/api.ts:84`), so the HTTP request never gets a response body. `/api/research` is fine (`:46`). A sign that the HTTP surface is untested; there are no tests besides `text-splitter.test.ts`.
- Bounds: depth x breadth recursion, 15 s search timeout, 60 s extraction abort, 25k-token page trim. No budget on LLM calls beyond that.

### 5. Evaluation shipped
None (`package.json` test script is `echo "Error: no test specified"`; the only test file covers the text splitter). The README references no benchmark or evaluation (grep for "eval", "benchmark", "test" in `README.md` finds nothing). `writeFinalAnswer` ("exact answer" mode) looks designed for external benchmarking, but no results are shipped. Which benchmark it targets is NOT VERIFIED.

### 6. Reproducibility / offline
Needs an LLM (o3-mini default, DeepSeek R1 via Fireworks, or custom model) and Firecrawl, which can be self-hosted through `FIRECRAWL_BASE_URL`. No cache, no recording, no seed.

### 7. Licence and commit
MIT. 1f8f3e2 (full id `1f8f3e285bbc23e80b98a66a64effab9069f3ad4`), 2026-04-11.

### 8. ADOPT / BEAT
- ADOPT: the recursion shape (learnings + follow-up questions + research goal, breadth halving) as the cheapest bounded exploration loop; structured-output schemas for planner and extractor.
- BEAT: everything on provenance. A learning must become an evidence record with verbatim span and source id; the "Sources" list must be derived from what supports claims; errors must be counted and reported; the "source is irrelevant" instruction is the opposite of our product.

### 9. NOT VERIFIED
Output quality (no run). Whether `/api/generate-report` hangs in practice (Express would leave the request open; read from code, not run). Behaviour of Firecrawl when a page fails to scrape (library behaviour).

---

## 4. DeepResearch (Alibaba Tongyi)

### 1. What it is
A trained agentic model family (Tongyi DeepResearch 30B-A3B) plus an inference harness and a large `WebAgent/` research collection (WebSailor, WebWeaver, WebWalker, WebResummer, ParallelMuse, AgentFold, NestBrowse, WebShaper and others). The reusable parts here are the harness and the WebWeaver design; the model-training material was skipped as instructed.

### 2. Architecture and loop
- **Inference loop** `inference/react_agent.py` (`MultiTurnReactAgent._run`, `:120` on): a single ReAct policy emits `<think>`, `<tool_call>` and finally `<answer>`; tools are `search` (Serper), `visit` (Jina reader + LLM extractor), `google_scholar`, `parse_file`, `PythonInterpreter` (`inference/prompt.py`, tool files `tool_*.py`). One agent, no planner/reviewer split; the intelligence is in the model weights.
- **Bounds, three independent:** 100 LLM calls (`:29`), 150 minutes wall clock (`:140`), 110k tokens of context (`:186`). At the token cap it forces a final-answer turn (`:188-200`). Each run ends with a named `termination` label (`answer`, `exceed available llm calls`, `answer not found`, `generate an answer as token limit reached`, `format error ...`, `No answer found after 2h30mins`), which `evaluation/evaluate_deepsearch_official.py:154-310` aggregates into termination frequencies.
- **WebWeaver** (`WebAgent/WebWeaver/`): a planner (`react_agent_search_id.py`, 40 calls, `:25`) that searches and writes an outline while accumulating a **memory bank** (`page_info`, `url2id`: each fetched page gets an integer id, `save_url2id` `:128-136`), and a writer (`react_agent_outline_write.py`, 40 calls) that writes section by section, calling a `retrieve` tool by `id_n` to re-read only the pages that section needs (`tool/tool_retrieve.py`). This is the only design among the six in which claims point at a closed set of stored, id-addressed evidence records.
- The README's second inference mode ("Heavy") is not released: `FAQ.md:12-14` says it is "not fully open-sourced yet".

### 3. Claims to sources
- **Core harness: no citations at all.** The answer is whatever sits between `<answer>` tags (`react_agent.py:180`). Provenance exists only inside the transcript (`messages` stored per rollout). The product is built to answer benchmark questions correctly, not to show its work.
- `visit` extractor (`EXTRACTOR_PROMPT`, `inference/prompt.py`): returns JSON `rational`, `evidence` ("the full original context of the content as far as possible") and `summary`; the agent sees `evidence` and `summary` prefixed with the URL (`tool_visit.py` `readpage_jina`, success branch after `:233`). "Evidence" is an LLM-extracted passage, never compared with the page.
- **WebWeaver writer** must wrap every non-common-knowledge statement as `<qwen:cite id="id_x,id_y">statement</qwen:cite>` (`prompt/write_prompt_multi_hop_2.py:90-116`), which is a span-level claim-to-evidence format with ids. The code then resolves ids to URLs by string replacement and appends a "References" list (`react_agent_outline_write.py:141-145`). It does not check that cited ids exist, that the wrapped statement appears in, or is entailed by, the page summary, or that the page text contains it. **Better format than any other repo, still asserted.**

### 4. Contradictions, weak evidence, failures, bounds
- Contradictions: only a prompt line in the eval-era prompt ("cross-check and validate the information", `evaluation/prompt.py` `SYSTEM_PROMPT_MULTI`). The shipped `SYSTEM_PROMPT` asks for "credible, diverse sources" and an "objective" answer with no mechanism. No stance modelling.
- Failures are surfaced to the model as text observations, which is the right instinct: `visit` returns "The provided webpage content could not be accessed" for a failed fetch or unparseable summary (`tool_visit.py:86, 236, 252`), `Error: Tool call is not a valid JSON` for malformed calls (`react_agent.py` `_run`). Fetch retries are bounded (3 x 50 s Jina, up to 8 outer attempts, `tool_visit.py:143-170`). A dead model server returns the literal string `vllm server error!!!` (`react_agent.py:110`) as an assistant turn, so the loop continues on an error string until the call budget is exhausted.
- `WEBCONTENT_MAXLENGTH` is defined (`tool_visit.py:18`) and never used; the actual cap is a 95,000-token truncation (`:197`). Small, but a config knob that does nothing.

### 5. Evaluation shipped
`evaluation/evaluate_deepsearch_official.py` (584 lines): LLM-judge correctness per benchmark (GAIA, xbench-DeepSearch, BrowseComp variants, HLE) with pass@k and best-pass@1 over three rollouts (`:405-447`), plus termination-reason statistics. `inference/run_multi_react.py` runs `roll_out_count` (default 3) rollouts and resumes from per-rollout JSONL (`:22`, `:87-108`). Benchmark results are shown only as an image (`assets/benchmark.png`) in the README; the repo does not ship result files, model outputs or the model weights, so **headline scores are not reproducible from the repo** (they need the 30B model, Serper, Jina and a judge API). The WebWeaver README reports "effective citations" and "citation accuracy" from the DeepResearch Bench FACT pipeline as an image table; the scoring code is not in this repo.

### 6. Reproducibility / offline
Not offline: vLLM-served 30B model, Serper, Jina, optional sandbox for Python. No recorded tool responses. Reproducibility is at the level of resumable rollout files, not replayable tool calls. The per-run full transcript with a termination label is, however, a genuine trace.

### 7. Licence and commit
Apache-2.0 at the root, MIT in `WebAgent/LICENSE`. f72f75d (full id `f72f75d8c3eb842f2bbbab096a12206ff66e270f`), 2026-02-27.

### 8. ADOPT / BEAT
- ADOPT: the termination taxonomy and a triple budget (calls, wall clock, context) with an explicit forced-answer step; failures as first-class observations; per-run transcript with a named stop reason; WebWeaver's id-addressed evidence bank and per-section retrieval; the `<cite id=...>statement</cite>` span format as the surface syntax our verifier parses.
- BEAT: nothing checks the ids, the spans, or the extractor's "evidence"; the headline core harness emits no provenance at all; benchmark claims live in images.

### 9. NOT VERIFIED
All benchmark numbers (image only). That the released weights behave as the README describes. WebWeaver end-to-end behaviour (needs an API-served summary model and GPUs; only the code was read). The other WebAgent subprojects were not read in depth.

---

## 5. deep-searcher (Zilliz)

### 1. What it is
Private-data deep search over a vector database (Milvus default). Two agents: `DeepSearch` (decompose, retrieve, reflect, summarise) and `ChainOfRAG` (hop by hop). Also a naive-RAG baseline and a router that picks an agent.

### 2. Architecture and loop
- **DeepSearch** (`deepsearcher/agent/deep_search.py`): `_generate_sub_queries` (up to 4); per iteration, search each sub-query in routed collections, ask the LLM YES/NO per retrieved chunk "is it helpful" (`RERANK_PROMPT`, `:25`, the check is `"YES" in r and "NO" not in r`, `:159`, a substring test that also rejects "KNOWN" or "NOTE"), de-duplicate by text, then `REFLECT_PROMPT` to produce up to 3 gap queries. Stops at `max_iter` (default 3, `:84`), when no gap queries return, or at no sub-queries. The reflect prompt biases toward continuing for report tasks ("you prefer to generate some further queries", `:44`). Final: one summary call (`SUMMARY_PROMPT`).
- **ChainOfRAG** (`chain_of_rag.py`): for each hop, generate a follow-up question from prior Q/A pairs, retrieve, answer from documents only ("DO NOT hallucinate ... Respond 'No relevant information found'", `:22`), then ask the LLM which retrieved documents support that Q/A pair (`GET_SUPPORTED_DOCS_PROMPT`, `_get_supported_docs` `:172`). `max_iter` 4, `early_stopping` off by default (`:93-94`), with an optional "do I have enough information, Yes/No" check (`:261`). Final answer prompt warns that "intermediate answers are generated by an LLM and may not always be accurate" (`:33`).
- Roles are prompts: decomposer, relevance grader, reflector, summariser, collection router.

### 3. Claims to sources
- The final answer text has **no citations**. The `query()` return value is `(answer, retrieved_results, tokens)` (`deep_search.py:290-303`); the `RetrievalResult` list carries a `reference` (file path / URL) and metadata (`deepsearcher/vector_db/base.py:14-44`) alongside the answer, not inside it. The summary prompt does not ask for citations.
- ChainOfRAG's supporting-document step is the nearest thing to hop-level provenance: each intermediate answer is linked to document indices, but chosen by an LLM and parsed with `literal_eval` (`:193`), with no check that the answer text appears in the chosen documents.
- **Asserted at best; absent in the final answer.**
- README says "When necessary, it can integrate online content for more accurate answers" (`README.md:20`). In code, the online branch is a placeholder: `search_res_from_internet = []  # TODO` (`deep_search.py:231`). Web crawling is an ingest-time loader only. **README claim not backed by code in the agent.**

### 4. Contradictions, weak evidence, failures, bounds
- Contradictions: none. Chunks are deduplicated by exact text.
- Weak evidence: when the relevance filter accepts nothing, the answer path returns the fixed string `No relevant information found for query '...'` (`deep_search.py:290`), which is an honest abstention, but ChainOfRAG has no equivalent: an all-"No relevant information found" chain still goes to a final-answer call.
- Failures: unparseable LLM list output raises `ValueError` (`deepsearcher/llm/base.py` `literal_eval`, fallback regex requires exactly one list match), which propagates and aborts the run. No per-call retry, and `grep timeout` over `deepsearcher/llm/*.py` and `deepsearcher/agent/*.py` finds no explicit timeout (provider SDK defaults apply; NOT VERIFIED what they are).
- Bounds: iteration caps, and token usage is returned per call and per run (`total_tokens` in every return tuple), a cost-visibility feature the other repos lack.

### 5. Evaluation shipped
- `evaluation/evaluate.py` + `evaluation/README.md`: Recall@K of supporting documents on the first 50 samples of 2WikiMultiHopQA, against naive RAG across `max_iter`. Retrieval recall, not answer correctness or citation support. Small sample, authors' own caveat.
- **`evaluation/jev_stopping/`: the best reproducibility design in the six.** A frozen sample (seed `20260922`, stratified by question type) with a manifest of ids and hashes; every request and response cached and audited against the raw cache; a pinned corpus with SHA-256 manifest (`artifact_manifest.json`); `replay_results.py` recomputes all published metrics offline from downloaded artefacts "without API calls"; unit tests for parsing, retries and rate limiting; resumable runner. The result is a 100-query comparison of stopping policies (Recall@5 93.25% for both, 7-round oracle 97.0%, 8 of 100 queries lose evidence by stopping early). Caveats: it compares a vendor model (Jev) with the default stopper, it is contributed by that vendor, the artefacts are hosted on a contributor fork (`README.md` says so), and the experiment is not wired into the agent.

### 6. Reproducibility / offline
The agent needs an LLM, embedding model and vector DB; fully local operation is possible with Ollama/local embeddings and Milvus Lite, but no recorded-response mode exists in the agent. The evaluation harness is the replayable part (see above).

### 7. Licence and commit
Apache-2.0. ddc36db317836bd42302b36f03166bec5324708d, 2026-09-22.

### 8. ADOPT / BEAT
- ADOPT: the record-everything, recompute-offline, hash-pinned evaluation design (our SAMPLE_MODE and judge-reproducibility story should look like this); ChainOfRAG's per-hop record of (sub-question, answer, supporting evidence) as the skeleton of a reasoning chain; token accounting on every return.
- BEAT: support selection by LLM index list; answers without inline provenance; a "continue" bias in the reflector; substring YES/NO parsing; hard crash on malformed list output; no gap statement when evidence is thin in ChainOfRAG.

### 9. NOT VERIFIED
Answer quality (no run). Per-call timeouts (provider defaults not inspected). Whether the Jev stopping result generalises (single dataset, vendor-contributed). The artefacts behind `jev_stopping` are downloaded at replay time and were not fetched here.

---

## 6. WikiChat (Stanford OVAL)

### 1. What it is
A grounded conversational agent over Wikipedia (and custom corpora via Qdrant), from the 2023 paper "Stopping the Hallucination of LLM chatbots by few-shot grounding on Wikipedia". Version 2.1 (April 2025) is a LangGraph pipeline with inline citations.

### 2. Architecture and loop
`pipelines/chatbot.py` (`create_chain`, `:171`) builds a fixed DAG, no loops:
1. `query_stage` (`:18`): LLM decides whether to search and writes queries (`query.prompt`).
2. `search_stage` (`:41`): retrieval (reranked), wrapped in try/except that logs and returns an empty result on any error (`:54`).
3. In parallel from START: `generate_stage` (`:61`) has the LLM state what it would say as split claims, and `llm_claim_search_stage` (`:77`) retrieves evidence for each claim. This is the "check my own claims against retrieval" idea.
4. `filter_information_stage` (`:93`): per retrieved block, an LLM extracts the relevant bullets (`filter_irrelevant_info.prompt`).
5. `draft_stage` (`:121`): drafts from documents only, with `[n]` citations (`draft_w_citation.prompt`).
6. `refine_stage` (`:158`): optional rewrite for relevance, flow, temporal correctness, keeping citations "exactly the same".
7. `shift_references` (`:130`): code renumbers cited references and keeps only those cited.

### 3. Claims to sources
- Citations are `[n]` markers keyed to numbered documents in the prompt; the draft prompt says "using only the information found in the provided documents" and instructs an abstention ("state that you don't have enough information", `draft_w_citation.prompt:10,16`).
- `shift_references` is mechanical but narrow: a regex over `[\d+]`, drop uncited references, renumber (`chatbot.py:134-150`). An out-of-range marker is skipped by the range check and left in the text unchanged (`:140`), i.e. a dangling citation survives. It checks existence of the number, not support.
- Provenance quality of the evidence store is the best here: each block has `document_title`, `section_title`, `content`, `last_edit_date`, `url` (`preprocessing/block.py:75-90`) and the retrieval result adds similarity and probability scores (`retrieval/search_result_block.py`). Time is represented (the drafter and refiner are told today's date and to use past tense).
- **README claim versus code.** The README says WikiChat "uses ... the following 7-stage pipeline to make sure its responses are factual" (`README.md:71`). The paper's pipeline included a fact-checking stage (inferred from the leftover verification helpers and labels below and from the paper's published design; the paper was not re-read here, NOT VERIFIED). The shipped 2.1 graph has no verification node. `is_everything_verified` (`pipelines/utils.py:67`) has no caller; `refine_w_feedback.prompt` is referenced only by the distillation scoring script; the label logic for SUPPORTS/REFUTES/NOT ENOUGH INFO survives only in `benchmark/scripts/evaluate_distillation.py:67-78`. `grep` for verification terms over `pipelines/`, `retrieval/` and the prompts finds nothing else. The pipeline diagram `public/img/pipeline.svg` contains no extractable text, so what it depicts is NOT VERIFIED. **The pipeline grounds drafting in retrieval, but nothing in the current code verifies the draft against the evidence.** The 2023 paper's factuality results describe an earlier pipeline and should not be attributed to this code.

### 4. Contradictions, weak evidence, failures, bounds
- Contradictions: none. Evidence is de-duplicated by token-set Jaccard above 0.8 (`pipelines/dialogue_state.py:25-45`) and the LLM reranker orders it. Nothing detects two blocks disagreeing.
- Weak evidence: the `draft` prompt abstains when documents lack relevant information, a prompt-level guard only; if the filter returns nothing for every block, the drafter simply gets an empty document list.
- Failures: `search_stage` swallows exceptions and proceeds (`:54-58`); `llm_claim_search_stage` does not (`:77-90`), so the two parallel branches fail differently. `retrieval/retriever_api.py:52` calls `requests.post` with **no timeout**, so a hung retriever blocks the turn indefinitely; non-200 other than 429 is logged and the code still parses the body and asserts on lengths (`:71-80`). The reranker (10 s, `retrieval/llm_reranker.py:157`) and Qdrant (20 s, `retrieval/qdrant_index.py:41`) do have timeouts.
- Bounds: fixed DAG so no runaway loop; per-stage `max_tokens` (200-2000). No overall turn budget.

### 5. Evaluation shipped
`benchmark/user_simulator.py` and `tasks/benchmark.py` simulate users over head/tail/recent Wikipedia topic sets (`benchmark/topics/`) to produce dialogues. The factuality scoring prompts exist (`benchmark/prompts/split_claim_for_eval.prompt`, `scale_factuality.prompt`) but no code in the repo references them (verified by grep), so **the paper's factual-accuracy evaluation cannot be reproduced from this repo**. `tests/test_pipelines.py` and retrieval/index tests are functional tests, not quality evaluation. No result files are shipped.

### 6. Reproducibility / offline
The most offline-capable of the six in principle: custom corpus indexing with a local embedding model and Qdrant, local LLM via an OpenAI-compatible endpoint (`llm_config.yaml`, README "Local LLM"). No recorded-response mode. `llm_config.yaml:19` enables prompt logging to `data/prompt_logs.jsonl`, a per-LLM-call input/output log (the nearest thing to a trace in the repo), and `DialogueTurn` (`pipelines/dialogue_state.py:50`) keeps every intermediate (queries, results, claims, filtered evidence, draft, final) as typed state.

### 7. Licence and commit
Apache-2.0. 803683b1139117d374801688af1d9d968e04a07b, 2026-01-30.

### 8. ADOPT / BEAT
- ADOPT: the evidence block schema with title/section/date/url carried all the way to the citation; generating the answer's claims first and retrieving evidence for each claim (the right input to a verifier); drafting from filtered evidence only, with an explicit abstain instruction; mechanical post-processing of citations; typed per-turn state holding all intermediates; prompt log JSONL.
- BEAT: add the missing verification stage and make it mechanical; resolve dangling citations as errors, not leftovers; set timeouts on every call; ship the factuality evaluation that its README implies.

### 9. NOT VERIFIED
Whether WikiChat 2.1 factuality matches the paper (no evaluation shipped). Whether removal of the fact-check stage is documented anywhere outside the files read. The content of the pipeline SVG. Runtime behaviour of the reranker and retriever under failure.

---

## Synthesis

### Comparison across the six

Scale: **None** = nothing; **Asserted** = LLM-produced link, unchecked; **Structural** = deterministic check of form only; **Mechanical** = deterministic check of content against stored text. No repo reaches Mechanical at runtime.

| Repo | Citation verification strength | Contradiction handling | Bounded loop | Offline replay | Trace / explanation artefact |
|---|---|---|---|---|---|
| gpt-researcher | Asserted (URL links by writer; deep mode LLM `sourceUrl`; fact-checker agent never sees sources). Structural check exists only offline in `quality_eval`. Best external check: FACT in `deep_agents` (re-fetches cited pages): 56% of citations valid. | None in code; README "most frequent information" claim unbacked | Strong on counts (sub-queries, breadth/depth/concurrency, revision cap, request timeouts). No wall-clock or token budget; cap breach raises. | Partial: frozen-page replay for the filter benchmark (`evals/context_filter`), local-doc mode. No LLM/search replay. | JSON event log (queries, context, costs). No per-claim "why". |
| open_deep_research | Asserted, doubly lossy (summary of summary, unchecked `key_excerpts`); `raw_notes` retained but unused for checking | None | Good caps (iterations 6, tool calls 10, concurrency 5, retries 3); undermined by `or True`, error string passed on as a finding | None; LangSmith only | LangSmith (external); `think_tool` text; no local artefact |
| deep-research | None (learnings carry no source; Sources = all searched URLs); prompt says "the source is irrelevant" | None | Bounded by construction (depth x halving breadth), timeouts 15 s and 60 s; errors swallowed | None | Console logs and `report.md` |
| DeepResearch | Core harness: no citations. WebWeaver: id-tagged cite spans, ids resolved by string replace, unchecked | None (a prompt line only) | Strongest: calls, wall clock and context caps with a named termination label for every run | Resumable rollouts; no tool-call replay; needs 30B model | Full transcript per rollout with termination label |
| deep-searcher | Absent in final answer; ChainOfRAG hop-level LLM-picked support indices | None | Iteration caps; early stop off by default; no explicit timeouts found | Agent: no. Evaluation: yes, the best design (cached calls, SHA-256 pinned artefacts, offline metric recompute) | Console logs; intermediate Q/A and sub-queries returned; token counts |
| WikiChat | Structural only: numbered `[n]` regex, renumber, drop uncited; dangling numbers survive; no verification stage in 2.1 | None | Fixed DAG, no loops; retriever call has no timeout | Local LLM + local index possible; no recorded replay | `prompt_logs.jsonl` per LLM call; typed `DialogueTurn` state |

### The eight design decisions we should take

1. **Evidence records are captured at fetch time and are immutable.** Each record: source id, canonical URL, fetch time, content hash, full normalised text stored locally, and verbatim span (start/end offsets). Claims reference record ids and offsets, never bare URLs. (From WebWeaver's id bank and WikiChat's block schema; beats all six, none stores offsets.)
2. **Two separate verification gates, reported separately.** Gate A is mechanical: the quoted span must occur in the stored text after a fixed normalisation (whitespace, unicode, case rule declared). Gate B is judged: given only the span and the claim, does the span support, contradict, or say nothing about the claim. A claim that fails A is rejected before B runs. The output states which gate each claim passed. (No repo has A; FACT and `unsupported_claim` are B-only and run offline.)
3. **Claims are a typed ledger, not prose.** Each claim has a type (number, date, entity relation, causal), a normalised value, support/contradict/neutral evidence lists with stance per span, and a status. Prose is rendered from the ledger, so every sentence maps back. (WebWeaver's `<cite>` span syntax becomes the render format; deep-searcher's hop records and WikiChat's split claims become the input.)
4. **The verdict is a deterministic function of the ledger, and counterfactuals are recomputed, not asked.** Remove an evidence record, recompute, report the new verdict and which claims flip. Report load-bearing evidence (removal flips) separately from redundant evidence (removal does not). An optional second counterfactual re-runs the writer without that record to check the prose really depended on it. (No repo does this; `perturbation.py` perturbs the report, not the evidence.)
5. **Contradiction is a first-class output.** For each claim key, evidence with opposing stance produces verdict `contested` with both sides, their dates and source types, never a majority vote or a silent pick. Conflicting numbers are kept as two values. (gpt-researcher's majority claim is absent from its code; the others do not mention it.)
6. **Bounds are enforced in code, with a named stop reason and fail-closed behaviour.** Call count, wall clock, token and per-call timeout budgets on every external call; every run ends with a termination label (DeepResearch's taxonomy); on any budget breach or fetch failure the run degrades to an answer with stated gaps, never to `[]`, an error string treated as a finding, or an exception that discards the work (counterexamples: `or True`, empty-string report, `MaxFactCheckRevisionsExceededError`). Keep gpt-researcher's abstain guard and generalise it: abstain per claim, not only when the whole context is empty.
7. **Record and replay at the call boundary.** Every search, fetch and LLM call is stored content-addressed (request hash to response), so `SAMPLE_MODE` is a replay of a real recorded run and the full evaluation recomputes offline from hash-pinned artefacts (deep-searcher `jev_stopping` pattern, gpt-researcher `context_filter` collect/replay pattern). Live and replayed runs share the same code path.
8. **Evaluate the claim we make, with attacks.** Ship a verification suite: (a) FACT-style re-fetch and judge of our own citations; (b) evidence-corruption tests (swap a span, flip a number, delete a source, inject a contradicting source) that must change the ledger and the verdict as predicted; (c) unsupported-claim injection (a fabricated sentence with a real URL) that Gate A or B must catch; (d) worst-of-three reporting on LLM-judged parts, judges from a different model family than the writer, both-order pairwise comparison. Do not use an LLM groundedness score over a flattened or truncated context as the headline (`eval_groundedness`, `unsupported_claim` with `[:4000]`).

### Five failure modes these systems share that we can beat

1. **A citation is a pointer, not a proof.** In all six the link between a sentence and a source is written by the model after the fact and never checked for presence of the claim in the page; in the best-instrumented system, 44% of citations fail an external check (gpt-researcher `deep_agents`, valid rate 0.5596). Beat: Gate A/B plus offsets (decisions 1-3); the artefact shows the verified span next to each claim.
2. **Evidence is summarised before it is cited.** open_deep_research summarises pages then compresses the summaries; DeepResearch and dzhng pass LLM extractions ("evidence", "learnings") as if they were quotes; the writer never sees the original. Fallbacks to raw text on failure silently change the data type. Beat: carry verbatim spans through every stage; summaries are derived views that point back to spans; failure of a summary never replaces evidence with something else without a flag.
3. **Silent degradation reads as confidence.** Failed searches, timeouts, parse errors and exhausted retries collapse to `[]`, `""`, `learnings: []`, an error string, or an uncaught exception, and the report is still written in the same confident voice (dzhng `catch`, ODR `or True`, gpt-researcher empty report, deep-searcher `ValueError`, WikiChat search swallow, retriever without timeout). Beat: a gap ledger in the output (which sub-questions were unanswered, which sources failed and why, which budgets were hit) and a coverage figure that caps the confidence of the verdict (decision 6).
4. **No model of disagreement or source weight.** None of the six detects two sources disagreeing; consensus and "objective" are claimed in READMEs and prompts (and one prompt says the source is irrelevant) with no mechanism; deduplication is by exact string or Jaccard, which erases the difference between "two sources agree" and "one source copied". Beat: stance-typed evidence, `contested` verdicts, provenance independence (same-origin duplicates count once), date and source-type recorded (decision 5).
5. **Un-auditable and un-replayable "why".** The explanation artefact is a console log, an external tracing service, a cost log, or nothing, and the evaluations are LLM judges of plausibility, often by the same model family that wrote the report, over truncated or flattened context. Runs cannot be replayed with recorded responses (deep-searcher's evaluation harness is the lone exception, and is not the agent). Beat: a per-decision trace of why (each planner choice, each accept/reject at Gates A and B, each stop reason) in a machine-readable JSONL, replayable from recorded calls, with metrics recomputed from artefacts (decisions 4, 7, 8).

### What this teardown does not cover

Dynamic behaviour of any repo (nothing was run). The other Track 2 clones in `research/track-2-agent-that-can-explain-why/` (ALCE, FActScore, long-form-factuality, llm_multiagent_debate, ragas, self-rag) are outside this file and likely hold the best published methods for the mechanical-verification and attribution-metric pieces of decisions 2 and 8; they should be read before those components are specified. Live upstream status, leaderboard ranks and issue trackers were not checked. Costs and latency were taken from repo documents only.
