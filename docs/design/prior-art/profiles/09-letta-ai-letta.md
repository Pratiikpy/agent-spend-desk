# Profile: letta-ai/letta

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 244 seconds, 714 words. Local clone, `main` at 5bcdd17. Paths relative to the repository root.

Spot-check (reviewer, against the files): the clone holds only README, AGENTS, SECURITY, LICENSE and policy files, no source (confirmed by listing); AGENTS.md lines 1-26 say `main` is a landing page, the retired V1 server is on an `archive` branch, and copying an old implementation into another project, benchmarking it or comparing with other systems is prohibited (confirmed); SECURITY.md lines 5-16 say the retired server gets no fixes (confirmed); README install and run commands for `letta-ai/letta-code` (confirmed); only a `main` branch exists locally, so the `archive` branch was not available to read (confirmed). Result: PASS. The reader refused to guess where there was no code and marked it NOT VERIFIED, which is the right behaviour.

## 1. What it is
A landing page. Letta (formerly MemGPT) builds stateful agents with memory. The working implementation moved to `letta-ai/letta-code`. Apache 2.0.

## 2. Architecture map
No source in this repository. Documented only: a terminal UI (`letta`), an App Server (`letta server`), channels (Slack, Telegram, Discord), a TypeScript Agent SDK, and Letta Cloud for memory across machines. All of that lives in `letta-code`.

## 3. Features and how each behaves
NOT VERIFIED. Memory tiers (core, archival, recall) are not documented in this repository.

## 4. How people use it
`npm install -g @letta-ai/letta-code`, then `letta` or `letta server`. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M6 memory, M10 agent registry)
NOT VERIFIED. There is nothing to read here.

## 6. Agent patterns
NOT VERIFIED.

## 7. Model and data layer
NOT VERIFIED.

## 8. Hackathon-care checks
Nothing runnable. The retired Docker image `letta/letta` is prohibited by the repository's own rules. Security: the retired server gets no patches.

## 9. Traps seen
A high star count on a repository with no code. Old documentation, tags and the Docker image look current and are not. AGENTS.md forbids using the archive for benchmarks, comparisons or copying.

## 10. Reuse
Apache 2.0, but the maintainers' own policy forbids copying the archived implementation. Treat as nothing to copy. The current implementation (`letta-code`) has not been read.

## 11. Verdict: REJECT this repository; re-profile `letta-ai/letta-code` before using Letta as a source
Copy: (1) nothing from code; (2) the idea of core versus archival memory, only as a concept to check against `letta-code`; (3) the way the project states plainly which code is retired.
Avoid: (1) citing this repository as evidence of how Letta works; (2) any use of the archive branch; (3) a cloud-only memory with no local verifiable record of irreversible actions.
Follow-up: `letta-code` goes on the GitHub-only list (partial clone, delete after).
