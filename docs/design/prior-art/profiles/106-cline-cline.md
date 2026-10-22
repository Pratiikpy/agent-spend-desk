# Profile: cline/cline (shadow git checkpoints and cost/usage tracking)

Reader: agy (Gemini), 2026-10-20. Remote read only (`gh api` and raw files, no clone). Prepared for . Citations refer to repository paths and line numbers as fetched on 2026-10-20.

## 1. What it is
An autonomous coding agent supporting VSCode, CLI, and SDK workflows. This review focuses strictly on the checkpoint system (shadow git storage, restoration, and diffing) and token/cost accounting. Licence: Apache 2.0 (`LICENSE:1-3`), read first. Stars: 70,847; pushed `2026-10-20T18:18:01Z` (`gh api repos/cline/cline`). Last commit read: `0870796e9e0c640408bb87d9503514a83f57d470`, 2026-10-20 12:01:16Z.

## 2. Architecture map
Checkpoints and cost tracking bridge five core modules:
- **Hook Lifecycle**: `sdk/packages/core/src/hooks/checkpoint-hooks.ts:651-709` triggers snapshots on the `beforeModel` hook before LLM execution.
- **Shadow Git Engine**: `checkpoint-hooks.ts:249-429` synthesizes 3-parent commits without touching the user's working index and registers them under `refs/cline/checkpoints/<sessionId>/<runCount>` (:630).
- **Workspace Transaction & Restore**: `sdk/packages/core/src/session/checkpoint-restore.ts:50-154` wraps destructive restores in rollbackable transactions; `sdk/packages/core/src/session/session-versioning-service.ts:141-365` orchestrates session state, messages, and ref retention (:322-326).
- **Diff Computation**: `sdk/packages/core/src/session/checkpoint-diff.ts:100-179` and `apps/vscode/src/sdk/SdkController.ts:2040-2172` compute content deltas and feed the IDE's multi-file diff viewer.
- **Cost & Token Accounting**: `sdk/packages/llms/src/providers/stream.ts:68-84` and `sdk/packages/llms/src/providers/ai-sdk.ts:1156-1374` normalize token streams and compute USD costs; `sdk/packages/core/src/services/usage.ts:4-67` maintains accumulated session totals.

## 3. Features and how each behaves
- **Shadow Git Snapshot**: Triggered on `iteration === 1` when a new user run is detected (`checkpoint-hooks.ts:658-691`). In git workspaces, it creates a commit capturing tracked and untracked changes, saved to private ref `refs/cline/checkpoints/<sessionId>/<runCount>` (:630). If the working tree is clean, it falls back to a HEAD commit entry (:570-584, :614-622).
- **Three-Parent Untracked Stashing**: Untracked workspace files are indexed into an isolated scratch index (`GIT_INDEX_FILE` in `~/.cline/checkpoint-scratch/<hash>`, :43-49, :262-278) and committed as a 3rd parent commit (:331-337, :370-385).
- **Three-Way Restore**: Offers Restore Files (`workspace`), Restore Task Only (`task`), or Restore Files & Task (`taskAndWorkspace`) (`docs/core-workflows/checkpoints.mdx:50-57`; `SdkController.ts:1942-1944`).
- **Diffing**: "Compare" lists modified tracked files, workspace untracked files, and checkpoint untracked files (`checkpoint-diff.ts:100-119`), extracting blob contents via `git show <ref>:<path>` or `<ref>^3:<path>` (:53-71).
- **Cost Normalization**: Calculates USD cost per 1M tokens with prompt cache discounts (`ai-sdk.ts:1156-1186`), separates reasoning tokens from output (:1357-1370), and tracks BYOK gateway costs (:1244-1263).

## 4. How people use it
Checkpoints are enabled by default (`docs/core-workflows/checkpoints.mdx:11-12, :28-35`). Users run Cline autonomously with auto-approve enabled (:77-90); if an edit fails, users click "Compare" to inspect diffs or "Restore" to rewind files or conversation (:40-57). Production failure rates and performance on huge workspaces: NOT VERIFIED.

## 5. Mechanism for the Desk
Shadow git and cost patterns to absorb:
- **Data Model**: `CheckpointEntry { ref, createdAt, runCount, kind: "stash" | "commit" }` (`checkpoint-hooks.ts:80-85`) stored in `SessionHistoryMetadata.checkpoint` (`sdk/packages/core/src/types/sessions.ts:33-44`). `SessionAccumulatedUsage` tracks `inputTokens`, `outputTokens`, `cacheReadTokens`, `cacheWriteTokens`, and `totalCost` (`services/usage.ts:4-33`). Multi-agent sub-sessions roll into `aggregatedAgentsCost` and `aggregateUsage` (`sessions.ts:29-32`).
- **Formulas & Rules**:
  - Cost formula: `totalCost = (billableInput/1e6)*P_in + (output/1e6)*P_out + (cacheRead/1e6)*P_read + (cacheWrite/1e6)*P_write`, where `billableInput = max(0, input - cacheRead - cacheWrite)` and `P_write` defaults to `P_in * 1.25` (`ai-sdk.ts:1172-1185`). Free/included tiers force `totalCost = 0` (:1337-1348).
  - Reasoning demuxing: `outputTokens = max(0, reportedOutput - reasoningTokens)` (:1366-1369) so reasoning is not double-counted in token totals while still billed at the output rate (:1363-1365).
  - Pre-request token estimate: 3 chars/token (`CHARS_PER_TOKEN = 3`) and flat 1,600 tokens/image (`tokens.ts:8-21`).
  - Stash preservation: `git stash apply` expects stash shape; untracked files live on `^3` (`checkpoint-diff.ts:61-70`, `checkpoint-hooks.ts:370-385`).
- **What it loses or gets wrong**:
  - No commit survival verification: once restored or finished, checkpoints are decoupled from eventual git commits that merge to upstream.
  - No budget cap enforcement: tracks spend and accumulates totals, but has no hard kill-switch or pre-turn spend limit.
  - Cost relies on runtime reported metrics: fallback pricing requires static pricing tables (`pricingValue`).
- **What we do better**: Bind shadow checkpoints to policy release gates and budget hard-caps before execution, and record signed verifier dossiers on every checkpoint transition.

## 6. Agent patterns
Checkpoints run passively inside `beforeModel` agent hooks (`checkpoint-hooks.ts:658-709`). It gates snapshots to root runs (`snapshot.parentAgentId == null`, :653-655, :659) and deduplicates against durable session history (`alreadyCheckpointed`, :687-691). Multi-agent subagents aggregate costs up to parent sessions (`sessions.ts:30-32`).

## 7. Model and data layer
Abstracted via `@cline/llms` unified `ApiStreamUsageChunk` (`stream.ts:68-84`). Normalizes OpenAI, Anthropic, Gemini, SAP AI Core, and OpenRouter BYOK responses into uniform token and cost fields (`ai-sdk.ts:1264-1374`). Checkpoint metadata is serialized into file-based JSON session manifests (`session-versioning-service.ts:327-335`).

## 8. Hackathon-care checks
- **Local & Offline**: Shadow git operates entirely via local `git` CLI child processes (`execFile`, `checkpoint-hooks.ts:10, :160-162`); zero remote network dependency.
- **Safety & Rollback**: `beginWorktreeRestoreTransaction` takes a pre-restore stash transaction into `refs/cline/restore-transactions/<uuid>` (:67-82), rolling back if git operations fail (`checkpoint-restore.ts:87-117, :133-153`).
- **Race/Branch Guards**: Compares `currentHead === restoreBaseSha` and uses atomic CAS `git update-ref HEAD <restoreBaseSha> <currentHead>` (:409-456) to prevent wiping uncheckpointed git commits.
- **Path Sanitization**: `resolveGitPath` forbids directory traversal (`relativePath escapes workspace`, `checkpoint-diff.ts:44-51`).

## 9. Traps seen
- Scratch index leak: untracked files copied to private index could consume workspace disk space, mitigated only by an opportunistic 14-day reaper (`checkpoint-hooks.ts:19, :57-78`).
- Large repositories: `ls-files` has a 64MB buffer limit (`LS_FILES_MAX_BUFFER`, :12); massive repositories can fail snapshotting and degrade silently to HEAD commits (:603-613).
- Checkpoint refs retained on restore can accumulate dangling objects in `.git/` unless pruned via `deleteCheckpointRefs` (:437-463).

## 10. Reuse
Apache 2.0 (`LICENSE:1-3`): permissible for direct reuse with attribution. Specifically reusable: the 3-parent untracked stash commit algorithm (`checkpoint-hooks.ts:249-429`), the worktree restore transaction guard (`checkpoint-restore.ts:50-154`), and the unified token/cost calculation formulas (`ai-sdk.ts:1156-1186`).

## 11. Verdict: ADAPT
- **Copy**:
  1. The 3-parent stash snapshot pattern storing untracked workspace files on commit parent 3 without modifying working directory state (`checkpoint-hooks.ts:340-385`).
  2. The two-phase restore transaction (`beginWorktreeRestoreTransaction`) with atomic CAS `git update-ref` and rollback safety (`checkpoint-restore.ts:50-154, :439-457`).
  3. The reasoning-token deduplication logic in output cost accounting (`ai-sdk.ts:1357-1370`).
- **Avoid**:
  1. Silent HEAD degradation when untracked indexing fails (`checkpoint-hooks.ts:603-613`).
  2. Storing untracked scratch indexes in user-global directories without explicit size quotas (`checkpoint-hooks.ts:25-49`).
  3. Passive spend accumulation without pre-flight budget enforcement or runaway loop circuit breakers.
- **Where we are already ahead**: Plumbline enforces pre-action cryptographic decision receipts and budget kill-switches, whereas Cline only measures cost post-hoc without gating execution.
