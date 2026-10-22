# Profile: n8n-io/n8n

Reader: Haiku (low effort), 2026-10-16, about 102 seconds, 98k tokens, 43 tool calls. Shallow clone (depth 1) (deleted after the profile pass). Paths relative to `packages/` unless stated. **Read-only for mechanisms: most of the code is under the Sustainable Use License, so no code is copied.**

Spot-check (reviewer, against the files): `LICENSE.md` says branches other than the main one are not licensed, source files with `.ee.` in the name or `.ee` in a directory name need an enterprise licence, third-party parts keep their own licences, and everything else is under the Sustainable Use License (confirmed from lines 1-16; that licence limits use to internal business purposes and non-commercial redistribution, its text beyond line 16 was not re-read); `cli/src/wait-tracker.ts` and `cli/src/workflows/error-workflow-validation.service.ts` exist (confirmed). All other file and line claims are the reader's account. Result: PASS on licence and file existence; the rest unverified.

## 1. What it is
A workflow automation platform with 1,500 or more integrations and AI agent nodes, self-hosted or cloud. Fair-code, not open source.

## 2. Architecture map
A monorepo: a command-line and server package (REST, webhooks, forms, chat stream), a workflow core with the execution engine, a database package, a Vue front end, a LangChain nodes package and a background agent package. Executions are stored in the database, file system or object storage, indexed by workflow, status and id.

## 3. Features and how each behaves
Credentials are separate objects encrypted at rest, referenced from nodes by id and name, with OAuth refresh. Trigger, webhook and poll nodes start runs. Wait nodes pause an execution until an external call or deadline; a form submission resumes with data. An error workflow is validated at write time (must exist, be published and have an error trigger). Agent tools are built from node descriptions and run inline with a filtered credential map; a policy violation returns a structured refusal.

## 4. How people use it
An installer script or Docker, then the web UI at a local port to build and activate workflows. Integration tests are workflow JSON files. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M1 credentials and triggers, M13 wait and resume)
The useful design points are conceptual: credentials decoupled from nodes and passed as references; a wait state that survives until an external signal; validation of error handlers at save time so a stale link is caught before it fails; execution records with retry links and a storage location field. Lost: soft deletion of execution data and no immutable ledger; missed deadlines can leave an execution hanging unless someone resumes it.

## 6. Agent patterns
An orchestrator calling tools that run nodes ephemerally; a structured refusal on policy violation; the human-in-the-loop pattern is the wait node.

## 7. Model and data layer
Node type registry by name and version; execution persistence abstracted over storage locations.

## 8. Hackathon-care checks
Execution events and an SSE stream for the agent; encryption enforced for credentials; evaluation suites exist for the agent package. Sample mode: NOT VERIFIED.

## 9. Traps seen
An error workflow that points at a missing or unpublished target never fires and gives no warning after the link goes stale; a wait deadline that passes can hang; credentials passed as id and name without a stated permission check in multi-tenant use (reader's account); a partial index that only helps one database.

## 10. Reuse
Sustainable Use and enterprise licences: no copying. Re-implement ideas only.

## 11. Verdict: REFERENCE ONLY for M1 and M13
Copy (as ideas): (1) credential references, never values, in node definitions; (2) validation of every handler reference at save time, plus a periodic check that finds stale ones; (3) a wait state with a deadline whose expiry is a visible state with an owner, not a hang.
Avoid: (1) silent never-firing handlers; (2) soft-deleted execution data; (3) any code reuse.
Where we are already ahead: an immutable ledger with an offline verifier; approvals with segregation of duties; expiry is a named state.
