# Profile: open-telemetry/semantic-conventions (gen-ai area) and its successor repository

Reader: Claude Sonnet, 2026-10-20. Remote read through `gh api` and raw fetches, no clone. Licence read first: Apache 2.0 for both repositories (`LICENSE` of the first repo opens with the Apache text; `semantic-conventions-genai` reports SPDX Apache-2.0). Last commits read: `open-telemetry/semantic-conventions` 2026-10-20T10:22Z, latest release v1.44.0 published 2026-08-04; `open-telemetry/semantic-conventions-genai` 461 stars, 2026-10-19T20:03Z (checked 2026-10-20). Apache: the text and schemas may be reused with credit. Both are specifications, not code that runs.

## 1. What it is
The standard attribute, span, event and metric names for generative AI telemetry. **Finding that changes the brief: the GenAI area is no longer in the repository named in the task.** Its registry page now says GenAI attributes "have moved" to `open-telemetry/semantic-conventions-genai` (`docs/registry/attributes/gen-ai.md:10-12`), and the old names are marked deprecated there (for example line 64 for `gen_ai.usage.input_tokens`, line 62 for `gen_ai.usage.cache_creation.input_tokens`). The tree of the original repo contains `model/gen-ai/deprecated` only; the live definitions are in `semantic-conventions-genai/model/gen-ai/` (`registry.yaml`, `spans.yaml`, `events.yaml`, `metrics.yaml`, `token-metrics.yaml`, plus JSON schemas for messages). Our ingest must target the new repository, and read the old one only for legacy names.

## 2. Architecture map
Registry of attributes (`docs/registry/attributes/gen-ai.md` in the new repo, 514 lines), span definitions for client inference, agents, tools and MCP (`docs/gen-ai/gen-ai-agent-spans.md`, 1,676 lines), events, metrics, and a non-normative folder with a Python model and YAML test cases for the message schemas (`docs/gen-ai/non-normative/tests/cases/`). Every GenAI attribute listed has stability "Development", not stable (rows at lines 11, 15, 21 and 82 of `gen-ai.md` all carry the Development badge). Pin a version and expect renames.

## 3. Features and how each behaves
Operation names: `execute_tool`, `invoke_agent`, `invoke_workflow` among others (`gen-ai-agent-spans.md:142-146`). Agent invocation spans: name `invoke_agent {gen_ai.agent.name}`, kind CLIENT for remote agents (204-208), required `gen_ai.operation.name` and `gen_ai.provider.name` (218-219), conditionally required agent id, name, version, conversation id (221-225). Tool spans: `execute_tool {gen_ai.tool.name}` (1116-1118 for skill variants). Content is opt-in (`gen_ai.input.messages`, `gen_ai.output.messages`, `gen_ai.system_instructions`, `gen_ai.tool.definitions`, lines 254-257), so a run with content capture off still carries tokens and model.

## 4. How people use it
Instrumentations (OpenAI, Anthropic, Bedrock, LiteLLM, Vercel AI SDK) emit these names. Backends map them: Langfuse (`OtelIngestionProcessor.ts:3298-3420`), Opik (`OpenTelemetryMapper.java:208-221, 298-300`), Phoenix (`conversion.py:127-148`). Real-world coverage of cache and reasoning attributes: NOT VERIFIED.


## 5. Mechanism for the Desk (the schema our ingest speaks)
**Usage attributes** (new repo `docs/registry/attributes/gen-ai.md:74-87`): `gen_ai.usage.input_tokens`, `output_tokens`, `cache_read.input_tokens`, `cache_write.input_tokens`, `reasoning.output_tokens`, and per-modality variants (`audio.*`, `image.*`, `text.*`, including audio and image cache reads). Rules in footnote 47 (lines 379-392): input tokens include cached tokens; detailed attributes are subsets of the totals; when a provider reports billed and consumed counts, report the billed count. Our bucket arithmetic must therefore be: `uncached_input = input - cache_read - cache_write`, `plain_output = output - reasoning` (and modality subsets). Langfuse and Phoenix both apply this subtraction (`OtelIngestionProcessor.ts:3404-3416`, `conversion.py:137-146`); Opik prices OpenAI cached tokens as a subset of the prompt (`SpanCostCalculator.java:83-84`).

**Rename to handle**: the old registry names the cache write attribute `gen_ai.usage.cache_creation.input_tokens` (old repo `gen-ai.md:62`), the new one `gen_ai.usage.cache_write.input_tokens` (new repo `gen-ai.md:78`). Accept both. Older emitters still send `gen_ai.usage.prompt_tokens` and `completion_tokens` (old repo `gen-ai.md:299-300`) and `gen_ai.system` instead of `gen_ai.provider.name` (line 298).

**Model identity**: `gen_ai.request.model` is what was asked, `gen_ai.response.model` is what answered (registry rows 55 and 42). For billing use the response model when present; Langfuse's fallback order is in profile 69.

**Agents and sessions**: `gen_ai.agent.id/name/version`, `gen_ai.conversation.id`, `gen_ai.workflow.name`, and sub-agent attribution through `gen_ai.main_agent.*` (registry rows 23-25). An `invoke_agent` span can carry usage attributes of its own (agent spans table rows 240-252), while its children are the model calls; summing both double counts. Langfuse skips usage on `invoke_agent` and `agent_step` for that reason (`OtelIngestionProcessor.ts:2979-3002`). Rule for the Desk: cost is attributed on leaf inference spans only; an agent span's usage is a cross-check, never an addend.

**Evaluation as telemetry**: event `gen_ai.evaluation.result` with name, score value (double), score label, explanation, and a field that ties the result to the response it judged (`model/gen-ai/events.yaml:16-40`). This is the standard shape for a canary or judge score; our own stored score should be exportable in it.

**Metrics**: usage counters `gen_ai.client.inference.usage.*` are "a proxy for cost approximation"; per-operation distributions "should not be used for total usage or cost calculations" (`docs/gen-ai/gen-ai-token-metrics.md:30-41`).

**What the standard does not carry**: no cost or price attribute (a search for cost, price, billing and currency in the registry file returned nothing; other files in the repo not searched, so NOT VERIFIED repository-wide); no outcome, acceptance or "work landed" signal; no budget or cap concept; no retry or idle marker; no owner-defined task identity. The Desk therefore needs its own namespace for those (a proposal, not a standard: attributes under a `desk.` prefix such as outcome status, task id, retry-of span id). Langfuse and Opik invented their own cost carriers (`gen_ai.usage.cost`, `llm.cost.total`, `metadata.cost.total_cost`), which shows the gap is real (`OtelIngestionProcessor.ts:3452-3457`, `CostService.java:297-307`).

## 6. Agent patterns
The spec has `plan` and `invoke_agent` spans (`gen-ai-agent-spans.md:1010`); it standardises how an agent is seen, not how it behaves.


## 7. Model and data layer
Provider names are an open vocabulary (old repo `gen-ai.md:34`); model names are free strings, so price matching stays the consumer's job (profiles 69 to 71).


## 8. Hackathon-care checks
Using the standard is judge-visible. Risk: every attribute is Development stability. Ship a conformance test fed with the YAML cases and captured spans from at least two SDKs.


## 9. Traps seen
Reading the old repo and finding deprecated names; assuming input excludes cache (the spec says it includes it); double counting agent and child spans; treating per-operation histograms as billable totals.


## 10. Reuse
Apache 2.0: copy attribute names, JSON schemas and the test cases with credit.

## 11. Verdict: ADOPT as the wire format, ADAPT with a Desk extension namespace
Copy: (1) the `gen_ai.usage.*` family with the subset rule, plus the legacy aliases; (2) `invoke_agent` / `execute_tool` / `gen_ai.conversation.id` for trace structure; (3) `gen_ai.evaluation.result` for scores.
Avoid: (1) inventing cost attributes without saying they are ours; (2) pinning to the old repository; (3) summing usage on agent and leaf spans together.
