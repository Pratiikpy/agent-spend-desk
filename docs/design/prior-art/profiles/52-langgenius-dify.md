# Profile: langgenius/dify

Reader: Haiku (low effort), 2026-10-16, about 112 seconds, 97k tokens, 40 tool calls. Shallow clone (depth 1) (deleted after the profile pass). Paths relative to `api/core/` unless stated. **Read-only for mechanisms: the licence restricts use (below), so no code is copied.**

Spot-check (reviewer, against the files): the licence is a modified Apache 2.0: no operating a multi-tenant environment (one tenant is one workspace) without written permission, no removing the logo or copyright information in the frontend (the `web/` directory), and contributors agree the producer may change the licence and use contributions commercially (confirmed from `LICENSE` lines 1-16); the files `workflow/nodes/agent_v2/output_failure_orchestrator.py` and several human-input form controllers exist (confirmed by search). The node types, the variable pool, the retrieval settings and line numbers were not rechecked and are the reader's account. Result: PASS on licence and file existence; the rest unverified.

## 1. What it is
An LLM application platform with a visual workflow builder, retrieval pipeline, agent nodes, plugins and observability integrations. Python and PostgreSQL back end, React front end.

## 2. Architecture map
A workflow entry builds a graph engine; node types include start and triggers (webhook, schedule, plugin event), model, agent (two versions), tool, knowledge retrieval, knowledge index, human input, data source and code. State is a variable pool keyed by node and output name. A topology module validates the graph; spans are produced per node type; interrupted runs can be resumed from persistence.

## 3. Features and how each behaves
Knowledge retrieval offers a single mode (a model scores) or a multiple mode (top-k, score threshold, optional rerank), with metadata filters (off, automatic, manual) and child-chunk results. Human input renders a form (text, paragraph, select, file), pauses the run, times out per node or globally, and resumes on submission by email or web. Agent version 2 declares outputs with a failure strategy each (use default, stop, take a fail branch) and a retry budget.

## 4. How people use it
`docker compose up -d` after copying the environment file, then an install wizard in the browser. Unit tests per node type with mocks; integration tests exist. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M7/M10 workflow nodes, M13 approval)
The output failure orchestrator chooses retry, default value, fail node or fail branch from per-output strategies with fixed precedence. The human-input node is a clean model for approval: a form, a pause reason, a deadline, a callback, a rule that a late submission is invalid. Lost: a form edited in flight is not persisted; quota and rate errors surface as exceptions rather than branches.

## 6. Agent patterns
Agent nodes with tool bindings and typed output checks; no critic loop; credentials of an agent are de-scoped after the run.

## 7. Model and data layer
Model configs resolved per node; a plugin daemon discovers tools and providers; vector stores pluggable; external knowledge sources supported.

## 8. Hackathon-care checks
OpenTelemetry spans per node; partner observability integrations; Docker Compose; an SSRF proxy and file-access boundaries for retrieval. Form input is template-resolved without escaping (reader's account), which matters if it reaches a prompt.

## 9. Traps seen
Default rerank may run with no rerank model configured; a fallback that assigns a default value can hide a failed output; multi-tenant storage assumptions; branding and tenancy conditions in the licence.

## 10. Reuse
Modified Apache 2.0 with tenancy and branding conditions and a relicensing clause for contributors: treat as read-only reference. Re-implement ideas independently.

## 11. Verdict: REFERENCE ONLY for M7 and M13; ideas, not code
Copy (as ideas): (1) per-output failure strategies with explicit precedence and a retry budget, where "use default" is allowed only for non-decision outputs and always recorded; (2) an approval node with pause reason, deadline, invalid-after-deadline rule and delivery abstraction (email, web, chat); (3) a graph validator that checks topology before a run.
Avoid: (1) default-value fallbacks on a decision path; (2) unescaped form text reaching a prompt; (3) any code reuse.
Where we are already ahead: approvals bind a request digest and segregate duties; a failed output is a gap, not a default.
