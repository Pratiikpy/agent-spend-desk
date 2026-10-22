# Profile: BloopAI/vibe-kanban

Reader: agy (Gemini), 2026-10-20. Prepared for .

## 1. What it is
A desktop and web agent-fleet orchestration Kanban board designed to accelerate planning, interactive review, and multi-agent execution across isolated Git worktrees (`README.md:11,27-36`).
- Licence: Apache License 2.0 (`LICENSE:1-3`), read first (GitHub API metadata reports `Apache-2.0`).
- Last commit date read: 2026-09-19T06:51:27Z (commit `d5cbb538`, pushed_at `2026-09-19T06:52:48Z`; 28,409 stars).

## 2. Architecture map
- **Frontend:** React 19 + Vite SPA in `packages/web-core` and `packages/local-web`, using TanStack Router (`packages/web-core/package.json:51`) and Tailwind CSS.
- **Backend:** Axum HTTP/WebSocket server in `crates/server` (`crates/server/Cargo.toml:38`), wrapping services in `crates/services`.
- **Worktree Engine:** `crates/workspace-manager` coordinates container directories across repositories, delegating Git branch and worktree lifecycle operations to `crates/worktree-manager` and `crates/git`.
- **Agent Execution Layer:** `crates/executors` abstracts 10+ agent CLIs via subprocess pipes, JSON-RPC, ACP (`agent_client_protocol`), and Claude Code control protocols.
- **Persistence:** SQLite via SQLx (`crates/server/Cargo.toml:44`) for structured state, streaming raw execution logs into session-partitioned `.jsonl` files (`crates/services/src/services/execution_process.rs:30-45,99-105`).

## 3. Features and how each behaves
- **Multi-Repo Git Worktrees:** Allocates isolated worktree directories per repo within a shared workspace container (`crates/workspace-manager/src/workspace_manager.rs:309-335`). If worktree creation fails for any repo, it rolls back all created worktrees and cleans up the container (`crates/workspace-manager/src/workspace_manager.rs:337-358`).
- **Concurrent Agent Fleet Sessions:** Spawns concurrent coding agents (`ClaudeCode`, `Codex`, `Amp`, `Gemini`, `Copilot`, `CursorAgent`, `Opencode`, `Droid`, `QwenCode`, `QaMock`) (`crates/executors/src/executors/mod.rs:109-124`).
- **Interactive Tool & Question Approvals:** Intercepts agent tool calls (`CanUseTool`) and question prompts (`AskUserQuestion`), streaming them to the UI; users approve, answer, or deny with feedback injected back into the agent context (`crates/executors/src/executors/claude/client.rs:60-142,203-230`).
- **Diff Review & Inline Comments:** Aggregates line-anchored review comments into structured `ReviewRequest` prompts dispatched to agents (`crates/executors/src/actions/review.rs:24-36,51-79`).
- **App Preview:** Embedded browser container with devtools, inspect mode, and device emulation (`README.md:34`, `packages/web-core/src/pages/workspaces/PreviewBrowserContainer.tsx:10-31`).
- **Failure behaviour:** Process failures record exit codes without corrupting workspace state; orphaned worktrees are pruned on lock recovery (`crates/worktree-manager/src/worktree_manager.rs:156-222`).

## 4. How people use it
- **Installation & Startup:** Launched via `npx vibe-kanban` or `pnpm run dev` for source development (`README.md:42-44,92-94`).
- **Shutdown & Sunset Context:** Bloop AI shut down on 2026-04-10 (`README.md:18-21`, `https://www.vibekanban.com/blog/shutdown`). Founder Louis Knight-Webb stated the shutdown occurred because "the vast majority are free users and we couldn't find a business model that we could get excited about". Hosted cloud features were retired with a 30-day export grace window (`packages/web-core/src/shared/components/CloudShutdownExportBanner.tsx:34-44`, `packages/web-core/src/pages/kanban/ProjectSunsetPage.tsx:28-56`), transitioning Vibe Kanban to community-maintained local operation.

## 5. Mechanism for the Desk
- **Data Model to Copy:**
  - `Workspace` (`crates/db/src/models/workspace.rs:41-54`): tracks `task_id`, `container_ref`, `branch`, and `worktree_deleted` flag.
  - `Task` (`crates/db/src/models/task.rs:8-33`): tracks lifecycle status (`Todo`, `InProgress`, `InReview`, `Done`, `Cancelled`) linked to `parent_workspace_id`.
  - `Session` (`crates/db/src/models/session.rs:22-31`): encapsulates active agent configuration and working directories within a workspace.
  - `ExecutionProcess` (`crates/db/src/models/execution_process.rs:39-78`): records discrete runs partitioned by `ExecutionProcessRunReason` (`SetupScript`, `CleanupScript`, `ArchiveScript`, `CodingAgent`, `DevServer`) and status (`Running`, `Completed`, `Failed`, `Killed`).
- **Concurrency & Worktree Isolation:** Global mutex table `WORKTREE_CREATION_LOCKS` (`crates/worktree-manager/src/worktree_manager.rs:16-17`) prevents concurrent worktree initialization races. Verifies metadata consistency by reading `.git/worktrees/*/gitdir` before reusing directories (`crates/worktree-manager/src/worktree_manager.rs:185-222`).
- **Log Streaming Optimization:** Offloads high-throughput streaming logs from SQLite to session-partitioned `.jsonl` files (`crates/services/src/services/execution_process.rs:87-105,170-172`), eliminating DB lock contention while streaming JSON patches to the frontend.
- **What they get wrong:** Worktree pruning lacks disk-quota thresholds; token usage and financial spend attribution per task/process are not tracked in core models.
- **What the Desk will do better:** Wire Plumbline's cryptographic receipt ledger and live token/dollar cost meters directly to each `ExecutionProcess` and worktree attempt.

## 6. Agent patterns
- Standardized runner traits (`Executable`, `StandardCodingAgentExecutor`) wrapping CLI/SDK protocols (`crates/executors/src/actions/mod.rs:74-95`).
- Adapts vendor control protocols: Claude Code bidirectional stdio protocol (`crates/executors/src/executors/claude/protocol.rs:22-47`), Codex JSON-RPC app server (`crates/executors/src/executors/codex/client.rs:11-25`), and ACP (`crates/executors/src/executors/acp/mod.rs:16-36`).
- Shared state is maintained through git worktrees and append-only patch streams rather than in-memory LLM state.

## 7. Model and data layer
- Adapters route commands to agent CLIs with configurable profiles (`crates/executors/src/profile.rs:21-29,62-65`).
- Local storage uses SQLite with SQLx migrations (`crates/db/migrations/`); external git hosts integrate via GitHub CLI and GraphQL APIs (`crates/server/src/routes/workspaces/pr.rs:25-29`).

## 8. Hackathon-care checks
- **Trace/Log format:** Process stdout/stderr persisted to `<session_id>/<execution_id>.jsonl` with structured `LogMsg` records (`crates/services/src/services/execution_process.rs:87-105,241-250`).
- **Offline / Sample Mode:** Feature flag `qa-mode` compiles `QaMockExecutor` for local headless testing without live LLM calls (`crates/executors/src/executors/mod.rs:17-18,122-124`).
- **Docker:** Root `Dockerfile:1-25` builds frontend and backend assets.
- **Security:** Worktree boundaries isolate agent file modifications from the main checkout branch (`crates/workspace-manager/src/workspace_manager.rs:309-335`).

## 9. Traps seen
- Cloud shutdown artifacts remain in tree (`packages/web-core/src/pages/kanban/ProjectSunsetPage.tsx:1-60`), forcing legacy cloud URLs to dead-end in export banners.
- Multi-repo git operations rely on blocking Tokio threads (`tokio::task::spawn_blocking`), creating thread pool pressure during massive repository checkouts (`crates/worktree-manager/src/worktree_manager.rs:72-81`).

## 10. Reuse
- Apache License 2.0 (`LICENSE:1-3`). Code and architecture patterns (worktree rollback, multi-agent process runners, JSONL log streaming) can be directly reused or adapted with credit.

## 11. Verdict: ADAPT for the Spend and Worth Desk
- **Adopt, Adapt, Reject:** ADAPT. The multi-repo worktree orchestration, JSONL log streaming architecture, and multi-agent protocol adapters provide an ideal foundation for agent task execution.
- **Three things to copy:**
  1. Atomic multi-repo worktree creation with rollback on partial failure (`crates/workspace-manager/src/workspace_manager.rs:309-358`).
  2. Offloading execution logs from SQLite to session-partitioned `.jsonl` files to preserve UI query responsiveness (`crates/services/src/services/execution_process.rs:30-45,87-105`).
  3. Interactive approval and question routing (`CanUseTool`, `AskUserQuestion`) directly bridged between agent CLI stdio and web UI (`crates/executors/src/executors/claude/client.rs:60-142,203-230`).
- **Three things to avoid:**
  1. Cloud-coupled entity models that required sunsetting and abandonment when commercial hosted services folded (`packages/web-core/src/shared/components/CloudShutdownExportBanner.tsx:34-44`).
  2. Absence of token/cost attribution on `ExecutionProcess` and `Session` records.
  3. Spawning unbounded blocking OS threads for git commands without a concurrency-limiting queue (`crates/worktree-manager/src/worktree_manager.rs:72-81`).

*Where we are already ahead:* The Desk tracks exact live spend, token consumption, and model drift canaries tied to Plumbline's verifiable decision core.
