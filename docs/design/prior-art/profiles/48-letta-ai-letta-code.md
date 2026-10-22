# Profile: letta-ai/letta-code

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 387 seconds, 939 words. Shallow clone (depth 1), deleted after the profile pass. Paths relative to the repository root. This is the follow-up to profile 09: the old `letta` repository is a landing page, and the current Letta implementation is here.

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); the memory-confinement launcher wraps a process in a fail-closed filesystem policy and throws when no kernel sandbox is available instead of running with a weaker policy, at `src/memory-confinement.ts:10-22` (confirmed); the memory constraints config has a version, maximum depth, maximum file characters, core-memory limit, per-file limits and read-only glob patterns at `src/memory-constraints.ts:11-19` (confirmed); the recall subagent forks the parent conversation and its own system prompt body is not used at runtime, as the file itself says, at `src/agent/subagents/builtin/recall.md:8-12` (confirmed; this is documented, so the reader's "silently ignored" is softened); automatic client-side dreaming is off by default on native Windows, stated in the README (confirmed; documented, not silent, and relevant because the build machine is Windows). Several features need a Letta sign-in (remote computers, secrets). Result: PASS.

## 1. What it is
An agent harness and command line for stateful agents with persistent memory, identity and skills, using a Git-backed memory file system. Terminal UI, App Server, channels, skills. Apache 2.0. The runtime can use Letta Cloud or an experimental local backend.

## 2. Architecture map
Runtime entry, a Git-backed memory file system (MemFS), a tool engine, a subagent manager (general-purpose, fork, memory, recall, reflection), an App Server with two WebSocket channels (control and stream), a channels gateway (Telegram, Slack, Signal) with a routing table from chat ids to agent and conversation ids, and a skills subsystem with three discovery tiers (global, project, agent memory).

## 3. Features and how each behaves
Memory lives as Markdown files with required `name` and `description` front matter; subdirectories are indexed by marker files; a memory tool discovers content progressively. Recall is a forked subagent plus a message search. A background memory subagent stages Git commits and resolves merge conflicts; uncommitted subagent memory updates are discarded on failure. Skills can be installed from Git, registries or URLs. Defaults: Letta Cloud backend, two starter blocks (persona, human).

## 4. How people use it
`npm install -g @letta-ai/letta-code`, run `letta`, connect model keys with `/connect`, switch backend with a command, run `letta server --listen` for headless use. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M6 memory, M10 registry and App Server)
Core memory is small, always-in-context files; archival memory is a tree reached on demand; recall is the transcript. Constraints are validated before a commit: depth, size, required front matter, protected paths; an invalid tree aborts with a list of errors. History is Git, so every memory change is a reviewable commit. Lost: the older agent interchange file format was removed without a fallback loader.

## 6. Agent patterns
Main agent with named subagents; a reflection subagent reviews transcripts; a memory subagent writes in an isolated worktree under confinement; scheduled heartbeats and crons.

## 7. Model and data layer
Provider routing for OpenAI, Anthropic, OAuth-based and custom OpenAI-compatible endpoints; MCP client; local Git directories; chat-channel webhooks.

## 8. Hackathon-care checks
Payload-free JSONL lifecycle events and task transcript headers; an offline tutorial personality and an experimental local backend; kernel-level sandbox for unattended memory writers; secrets obfuscated from context (sign-in required). Dockerfile: NOT VERIFIED.

## 9. Traps seen
Features that differ by operating system (auto dreaming off on native Windows, with an environment override); prompt files that exist but are not used at runtime; hard removal of an interchange format; tight coupling to the vendor's cloud for several features.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the memory constraint validator, the front-matter parser, the confinement launcher pattern, the two-channel App Server protocol.

## 11. Verdict: ADAPT for M6 and M10
Copy: (1) memory as versioned files with validated constraints (depth, size, protected paths) so every change is a diff someone can review, and a validator that rejects instead of repairing; (2) a fail-closed confinement launcher for any unattended writer, refusing to run on a weaker policy; (3) an App Server with a control channel and a stream channel and scoped tokens.
Avoid: (1) behaviour that differs by operating system without an explicit status line in the doctor output; (2) memory writers that discard work on failure without a record; (3) dependence on a vendor cloud for secrets or remote machines.
Where we are already ahead: memory changes are certified proposals with replay; here a subagent commits what it decides.
