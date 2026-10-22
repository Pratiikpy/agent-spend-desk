# Vertical agents and open-source research agents: what to copy, what to beat

Date: 2026-10-18. Method: public web search (standard mode, one pass per product), REA analysis of public home pages, and direct reading of shallow clones in `research/agents/` (gitignored). Anything not read directly is marked **NOT VERIFIED**. Licence rule applies (CLAUDE.md): MIT and Apache are copied with credit; anything else is ideas only.

## 1. What REA could and could not tell us

REA 6.5.0 (`rea-agents`, MIT) was run through `analyze-web-bundle` on a headless Chrome (debug port, throwaway profile) against the public home pages of Elicit, Consensus and Perplexity.

- Elicit: 8 scripts, no framework fingerprint. Consensus: 15 scripts, Next.js (high confidence), one 4.5 MB app chunk. Perplexity: 3 scripts, a Cloudflare challenge script, session and visitor keys.
- It exposed the tech stack and nothing about agent logic. The agents run behind logins, and we do not create accounts or sign in (browser rules), so their decision screens were not observed.
- Method note for next time: REA earns its keep on a product that exposes its logic in the client or a documented API, or on a local binary. For hosted agents, public papers, documentation and release notes are the better evidence.
- Node 22.17 is below the `rea-agents` engine range (`^22.19`); the CLI still ran with warnings. Fix by upgrading Node before relying on it.

## 2. Closed and vertical products (public sources only)

| Product | What the public sources say | What we take | Where we beat it |
|---|---|---|---|
| Elicit | Every extraction is backed by quotes or tables from the paper; click a number to see the supporting quotes. A study (Cambridge / EcoEvoRxiv, life and environmental sciences) found 90% agreement on repeated extracted values, but only 46% on supporting quotes and 30% on reasoning; its authors conclude it complements, not replaces, human extractors | Click-through from a claim to its quote | A mechanical quote check makes the quote deterministic and verifiable; we publish our own repeat-run agreement on values, quotes and criterion ids |
| Consensus | Retrieval in stages (semantic and keyword, re-rank on relevance and quality signals, final model rank); Pro and Deep modes use a planning, search and reading agent on GPT-5 (one secondary source, **NOT VERIFIED** against Consensus itself); the Consensus Meter shows support, oppose and mixed counts only for yes/no questions | The support / oppose / mixed meter | We apply it per policy criterion over precedent, with the exact excerpt behind each count, and for every case type, not only yes/no |
| Perplexity Deep Research | Decomposes the query into sub-queries, searches in parallel, reads sources, updates its research plan, iterates to a synthesis threshold; exports a report | A visible plan-refine loop | Our loop is bounded in code, traced per step, and ends in a signed, verifiable record |
| Harvey | Plan preview, scope adjustment and approval before the agent runs; claim-level citations; its own materials still say citations need human verification | Approve the plan before the run | The approver shapes the plan and we then verify each citation mechanically instead of asking a person to |
| Cohere Health, Sixfold, Anterior, Federato, Torq, Dropzone | Earlier market pass: see `2026-10-17-market-and-demand-evidence.md` | Not re-read in this pass | **NOT VERIFIED** this session |

Glean, Microsoft Copilot, AlphaSense, Bloomberg and Compliance.ai were named by a pasted Grok answer and were not checked here. The role names in that answer ("Evidence weaver" and others) are not product facts.

## 3. Open-source repos read directly

All cloned shallow on 2026-10-18. Stars and licences from the GitHub API the same day.

| Repo | Licence | What it does that matters | Weakness we can use |
|---|---|---|---|
| `langchain-ai/open_deep_research` (12.7k stars) | MIT | Graph: clarify, write brief, supervisor, parallel researchers (capped by `max_concurrent_research_units`), compress, final report. The supervisor stops on an iteration cap, no tool calls, or an explicit `ResearchComplete`. A `think_tool` records a reflection between steps | In `supervisor_tools` the error handler ends with `or True`, so every exception, not only token limits, silently ends research and returns what it has. We make failure loud and traced |
| `assafelovic/gpt-researcher` (30.2k) | Apache-2.0 | Multi-agent: editor, researcher, reviewer, reviser, writer, human, fact checker, with revision counters. A human-review node exists | The reviewer and the fact checker are LLM calls reading the draft, accepting by returning "None"; no mechanical check of a claim against its source span |
| `stanford-oval/storm` (31.7k) | MIT | Perspective-guided question asking: personas ask different questions, then outline, then a cited article | Citation correctness is not verified; last push 2025-09 |
| `dzhng/deep-research` (19.8k) | MIT | Breadth and depth parameters: each level halves breadth and decrements depth, carrying learnings forward | A fixed recursion budget, no critique of the learnings |
| `run-llama/llama_index` (52.5k) | MIT | `CitationQueryEngine`: sources numbered in the prompt, the model cites by number, "answer solely on the provided sources" | The citation is a number the model chose; nothing checks the sentence is in the chunk |
| `crewAIInc/crewAI` (59.8k) | MIT | Agent `guardrail` (function or description) with `guardrail_max_retries`; event tracing; flows | Guardrails are model- or function-defined per agent, not a proof |
| `openai/openai-agents-python` (30.1k) | MIT | Input and output guardrails with a tripwire that halts execution; tracing with span data; handoffs; run state | Guardrails check content, not that an effect is idempotent or bound to one request |
| `langchain-ai/langgraph` (43.4k) | MIT | Checkpointers (SQLite, Postgres) and a `checkpoint-conformance` package: a published suite every checkpointer must pass | We already chose this pattern (D-031); copy its shape for our runtime adapters |
| `microsoft/autogen` (61.5k) | code MIT (`LICENSE-CODE`), docs CC-BY-4.0 | Group chat with critics | Not read in depth; **NOT VERIFIED** |

## 4. The pattern across all of them

None of the nine checks a claim against its source text with code. Critics are language-model calls that accept or send back; citations are model-chosen numbers or names. That is the gap the Critic's mechanical quote check, the entailment judge, the published false-accept rate and the signed record fill. It also matches the one measured weakness in the closed products (Elicit's 46% quote agreement).

## 5. Changes made to the plan (PRD v2.0)

1. **F-S17 Plan preview and approve** (Harvey): before a run, the approver sees the typed plan and can narrow it; the approved plan is part of the signed record.
2. **F-S18 Precedent meter per criterion** (Consensus): support, oppose and mixed counts with the excerpts behind them; shown for every case type.
3. **F-K21 Stability report** (Elicit study): the same case run repeatedly; we publish agreement on values, quote spans and criterion ids, with intervals.
4. **F-K22 Loud failure** (`open_deep_research`): no catch-all that ends a run quietly; every error ends in a traced, typed outcome, and a test injects one.
5. **F-K23 Visible plan-refine trace** (Perplexity): each re-plan shows what changed and why, in the trace viewer.
6. F-K20 gains an explicit requirement that the adapter suite is published in the LangGraph `checkpoint-conformance` shape.

Licence handling: patterns only; no code copied in this pass.

## 6. Not done, and next

- Cohere, Sixfold, Anterior, Glean, AlphaSense were not re-read.
- AutoGen group-chat critics were not read.
- The Node upgrade for REA is open.
