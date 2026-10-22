# Profile: dagger/container-use (per-agent container plus git branch)

Reader: Claude Sonnet, 2026-10-20. Remote read only (raw files via curl, no clone). Paths are relative to the repository root; line numbers are from the files as fetched on 2026-10-20.

## 1. What it is
An MCP server and CLI (`container-use`, alias `cu`) that gives each coding agent its own Dagger container and its own git branch, so many agents work in parallel and a human reviews, merges or discards (README.md:19, :27-31). Licence: Apache-2.0 (LICENSE:2-3; `gh api` spdx), read first. Stars 4073, pushed 2026-09-21 (`gh api`, 2026-10-20). Last commit read: 2e43e62, 2026-08-12. Self-described "stability: experimental" (README.md:6).

## 2. Architecture map
An environment is branch plus worktree plus container (environment/README.md:3-11, :73). Creating one pushes the current branch to a `container-use/` remote held in a bare repo under `~/.config/container-use/repos/`, with a worktree mounted at `/workdir` (:26-31, :54-63). After every tool call, `Repository.Update` exports the container filesystem to the worktree and commits it (repository/git.go:265-283, :567-585), saves container state as a git note under `container-use-state` (:475-500), fetches into the user's repo (:300-306) and appends the operation log as a note under `container-use` (:312-313, :522-535). Process-level `flock` locks, three kinds (user repo, fork repo, notes), stop concurrent instances corrupting git (repository/flock.go:15-27).

## 3. Features and how each behaves
Tools exposed over MCP: `environment_create`, `_open`, `_run_cmd`, `_file_read/_write/_edit/_delete/_list`, `_checkpoint`, `_add_service`, `_log`, `_diff`, `_config`, `_update_metadata` (mcpserver/tools.go:301-1034). `run_cmd` starts "a NEW container within the environment" per command and must use `background` for servers (:576-589). Human commands: `merge` (keeps the agent's commit history), `apply` (stages changes for the human to commit), `diff`, `log`, `checkout`, `delete` (environment/README.md:67-69; cmd/container-use/merge.go:20-24, :50).

## 4. How people use it
`claude mcp add container-use -- container-use stdio`, plus `rules/agent.md` in CLAUDE.md (README.md:57-66); `git log --notes=container-use` inspects any environment (environment/README.md:19-21). Usage evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
State per step: a git commit (file changes) plus two notes. The state note is JSON: `created_at`, `updated_at`, config, `container` (a Dagger container identifier string), `title`, `submodule_paths` (environment/state.go:9-17). The log note is free text built from commands: `$ cmd`, exit code, stdout, stderr (environment/note.go:21-34). The commit message is the agent-supplied `explanation` (repository/git.go:582, tools.go:610).

What to copy for the Desk: the **per-step ledger with the human-readable claim and the evidence side by side**. The agent says why in `explanation`; the note stores what actually ran and its exit code. A reviewer can compare claim to effect without trusting the agent.

What it loses or gets wrong:
- No cost, token or model fields anywhere (grep of tools.go, environment.go, git.go for token/cost/usage/budget found nothing, 2026-10-20). It measures work, not spend.
- The commit skips binaries, archives, `node_modules`, `build`, `dist`, `.env`, `*.log` (repository/git.go:715-751), so the branch is not a faithful snapshot of the container; reconstructing the container from state is the real replay surface.
- Commit messages are the agent's own words, so they are claims, not outcomes.
- Isolation is of the filesystem and processes, not of spend: nothing stops a looping agent burning tokens inside its sandbox.
Better for the Desk: attach tokens, model, dollars and wall-clock to each step note, close each environment with a landed/discarded outcome (merged, applied, deleted, or abandoned), and compute cost per landed environment.

## 6. Agent patterns
Any MCP client; parallelism is one environment per agent; a human can drop into the container terminal (README.md:29). `merge` auto-selects environments descended from HEAD (repository/repository.go:453).

## 7. Model and data layer
Never calls a model. Image, setup commands, env vars and secrets are committed configuration (environment/README.md:11; environment/config.go:123-144). Secret handling inside containers: NOT VERIFIED.

## 8. Hackathon-care checks
Needs a Docker or Dagger engine, heavy for a judge's machine. Go integration tests exist (environment/integration/). Host exposure of agent commands: NOT VERIFIED.

## 9. Traps seen
Self-labelled experimental; part of its own file-skipping logic is marked "AI slop below" (repository/git.go:587). Skipped paths such as `.env` are absent from the branch by design. Long commands must be backgrounded by the agent (tools.go:587-589).

## 10. Reuse
Apache-2.0: may reuse with credit and notice. The git-notes ledger idea is small enough to rebuild in a few lines; the Dagger dependency is not worth adopting for a spend desk.

## 11. Verdict: ADAPT (the ledger idea), REJECT (the container runtime for our scope)
Copy: (1) per-step claim plus evidence stored as git notes beside the commit, so the audit trail travels with the repo; (2) merge/apply/discard as the explicit human close of a unit of agent work, which is exactly the "landed or not" signal the Desk needs; (3) separate lock classes so concurrent writers cannot corrupt shared refs.
Avoid: (1) no spend or token data in the ledger; (2) agent-written commit messages treated as truth; (3) a heavy container engine as a prerequisite for a demo a judge must run.
