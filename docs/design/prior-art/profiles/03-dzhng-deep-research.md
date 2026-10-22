# Profile: dzhng/deep-research

Reader: Haiku (low effort), 2026-10-16, about 70 seconds, 70k tokens. Local clone, commit 1f8f3e2. Paths relative to `src/` unless stated.

Spot-check (reviewer, against the code): prompt trimming to 25,000 tokens at `deep-research.ts:93` (confirmed); default context size 128,000 and the `o200k_base` encoder at `ai/providers.ts:62-67` (confirmed); CLI defaults breadth 4 and depth 2 at `run.ts:39-48` (confirmed); no tests directory (confirmed); breadth halving, state passed down, concurrency, timeouts and the swallowed error were confirmed in the earlier reading of the same file. Result: PASS on facts. Two judgment corrections by the reviewer, written into sections 9 and 11: (a) the Dockerfile builds on `node:18-alpine` while `package.json` requires Node 22.x, an inconsistency the reader listed without flagging; (b) the reader advised against halving breadth on recursion. That advice is wrong for us: halving is a deliberate cost bound and we adopt it.

## 1. What it is
An iterative research assistant: search, scrape, extract learnings, recurse with narrower breadth and lower depth. MIT licence. Small (about 560 lines under `src/`).

## 2. Architecture map
Entry points: a readline CLI (`run.ts`) and an Express API with `POST /api/research` and `POST /api/generate-report` (`api.ts`). Core loop `deepResearch()` at `deep-research.ts:176-294`: generate SERP queries, search through Firecrawl, extract learnings and follow-up questions, recurse. Support: `feedback.ts` asks clarifying questions before the run (called from `run.ts:61`, outside the loop); `prompt.ts` holds the system prompt; `ai/providers.ts` chooses the model and trims prompts.

## 3. Features and how each behaves
`deepResearch(query, breadth, depth, learnings, visitedUrls, onProgress)` returns `{learnings, visitedUrls}` (`deep-research.ts:24-27`). `generateSerpQueries` returns at most `breadth` queries with a research goal each (zod schema, lines 40-79). `processSerpResult` extracts up to three learnings and follow-up questions per result (lines 81-118). `writeFinalReport` and `writeFinalAnswer` synthesise the output (lines 120-174). Concurrency: `pLimit(2)` by default, set per recursion level (lines 30, 216). Errors in a branch return empty arrays (lines 275-284).

## 4. How people use it
`npm start` and answer prompts (query, breadth, depth, report or answer), or `docker compose up -d` then `docker exec -it deep-research npm run docker`. Needs a Firecrawl key and an OpenAI key, or a Fireworks key for DeepSeek R1, or a custom endpoint. No tests. Issues and user feedback: NOT VERIFIED.

## 5. Mechanism for our module (M4 research loop and evidence-gap re-planning)
Breadth halves each level (`Math.ceil(breadth / 2)`, line 230) and depth decrements (line 231); recursion stops when depth reaches zero (line 241). State passed down: the next query built from the research goal and follow-up questions (lines 251-254), the new breadth and depth, accumulated learnings and visited URLs. Learnings are deduplicated only at the final merge, by exact string (line 291). No gap detection, no confidence score, no check that learnings answer the original question.

## 6. Agent patterns
One recursive loop with parallel breadth; no critic, no evaluator, no confidence branching. Progress callback only.

## 7. Model and data layer
`getModel()` prefers a custom endpoint, then DeepSeek R1 through Fireworks, then o3-mini (`ai/providers.ts:48-56`); a custom OpenAI-compatible endpoint is supported. Firecrawl search with a 15 s timeout and five results (`deep-research.ts:222-226`); LLM calls have a 60 s abort (line 99). Context is trimmed to the model window by recursive splitting.

## 8. Hackathon-care checks
Logs are `console.log` only, no structured trace. No sample or offline mode. Docker and compose present. No evals. Secrets come from `.env.local`; a template is shown in the README. No hardcoded outputs. No bound on total run time.

## 9. Traps seen
Silent failure: any branch error or timeout returns empty learnings and the run continues, hiding a total failure (lines 275-284). A query-generation error is not caught and crashes the run (line 205). The system prompt tells the model "the source is irrelevant" and allows speculation (`prompt.ts:12-14`), the opposite of evidence-first. Duplicates travel down the tree until the final merge. No notice when a prompt is trimmed. Dockerfile on Node 18 against Node 22 in `package.json`.

## 10. Reuse
MIT: copy with credit. Standalone pieces: query generation, result processing, report writing, prompt trimming.

## 11. Verdict: ADAPT for M4
Copy: (1) the breadth-halving, depth-decrement recursion as a bounded research budget; (2) the state passed between levels (goal, learnings, visited URLs); (3) the structured-output schema for learnings plus follow-up questions, and per-level concurrency limits.
Avoid: (1) silent failure on errors: record each failed branch as an explicit evidence gap in the trace; (2) a prompt that discounts sources: every learning must carry its source and a quoted span; (3) dedup by exact string only and no stop condition tied to whether the question is answered.
Where we are already ahead: evidence-gap re-planning, verified citations and a trace of why each step ran; deep-research has none of these.
