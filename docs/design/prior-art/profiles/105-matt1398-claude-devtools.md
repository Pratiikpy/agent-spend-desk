# Profile: matt1398/claude-devtools

Reader: agy (Gemini), 2026-10-20 for . Licence read first: MIT (`LICENSE:1-21`). Stars: 3,990; last push: 2026-09-26 07:43 UTC (commit `1486f20`); forks: 306 (`gh api repos/matt1398/claude-devtools`). TypeScript, Electron + standalone Fastify web server (`package.json:19,46-49,59`).

## 1. What it is
An open-source desktop and headless inspector for Claude Code sessions that parses local JSONL logs to visualize conversation chunks, subagent trees, tool executions, and compaction-aware context consumption (`README.md:11-13,71-86`).

## 2. Architecture map
- **Discovery**: `ProjectScanner.ts:62-85` discovers projects under `~/.claude/projects/`; `pathDecoder.ts:27-60` decodes hyphenated directory names back to filesystem paths with `extractCwd()` fallback (`pathDecoder.ts:11-14`).
- **Parsing**: `SessionParser.ts:68-139` and `jsonl.ts:52-82` stream session JSONL line-by-line; `toolExtraction.ts:10-62` extracts `tool_use` and `tool_result` blocks; `MessageClassifier.ts:32-65` classifies records into 5 categories (`user`, `system`, `compact`, `hardNoise`, `ai`).
- **Analysis**: `ChunkBuilder.ts:78-152` constructs independent visual chunks; `ToolExecutionBuilder.ts:15-82` links tool calls to results; `SubagentLocator.ts:42-60` and `SubagentResolver.ts:38-80` assemble subagent process hierarchies.
- **Context & Compaction**: `jsonl.ts:557-635` calculates phase-based context consumption; `contextTracker.ts:815-890` categorizes turn tokens into 6 buckets.
- **Entry Points**: Electron main process (`src/main/index.ts`), standalone HTTP server (`src/main/standalone.ts:1-48`), and React renderer (`package.json:64-72`).

## 3. Features and how each behaves
- **JSONL Streaming & Deduplication**: Reads session logs line-by-line (`jsonl.ts:68-80`). Drops entries without `uuid` (`jsonl.ts:106-107`). Deduplicates streaming assistant entries by keeping only the final message per `requestId` (`jsonl.ts:233-252`).
- **Tool Call Execution Matching**: Associates tool calls to results by checking `sourceToolUseID` first, falling back to matching on `toolResults` array (`ToolExecutionBuilder.ts:31-64`).
- **Compaction Phase Detection**: Identifies `isCompactSummary` events (`jsonl.ts:572-576`) and slices conversation into phases to measure token growth before and after context compaction (`jsonl.ts:583-635`).
- **Subagent Tree Resolution**: Locates subagent files in `{projectId}/{sessionId}/subagents/agent-{agentId}.jsonl` or legacy `{projectId}/agent-{agentId}.jsonl` (`SubagentLocator.ts:7-11,43-50`). Discards warmup agents (`SubagentResolver.ts:144-153`) and flags parallel execution on a 100ms overlap threshold (`SubagentResolver.ts:22,69`). Matches subagents via `toolUseResult.agentId`, team summary regex (`<teammate-message summary="...">`), or positional fallback (`SubagentResolver.ts:219-260`).
- **Memory Inspection**: Renders per-project memory from `~/.claude/projects/<id>/memory/MEMORY.md` and layer `.md` files with path containment checks (`MemoryReader.ts:4-15,54-57`).

## 4. How people use it
- **Install**: macOS Homebrew `brew install --cask claude-devtools` (`README.md:98-100`), direct binaries (`README.md:104-109`), or Docker container `docker compose up` on port 3456 (`README.md:110`, `Dockerfile:7-8`).
- **First-run**: Automatic discovery of local `~/.claude/` without API keys or proxy wrappers (`README.md:73,87`).
- **Tests**: Vitest suite with ~25 test files under `test/` (`package.json:42-45`). Real-world user issue evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
- **Compaction-Aware Context Consumption Formula**: Raw token sums double-count context across compactions, while final context ignores churn. `claude-devtools` computes phase-based consumption (`jsonl.ts:583-635`):
  - Phase 1: $\text{contribution}_1 = \text{pre}_1$ (`jsonl.ts:599-606`).
  - Phase $i > 1$: $\text{contribution}_i = \text{pre}_i - \text{post}_{i-1}$ (`jsonl.ts:608-617`).
  - Final phase: $\text{contribution}_{\text{final}} = \text{lastInputTokens} - \text{post}_{\text{last}}$ (`jsonl.ts:620-632`).
  - Total context consumed: $\sum \text{contribution}_k$ (`jsonl.ts:634`).
- **Streaming Request Deduplication**: Maps `requestId` to its last index to filter out intermediate streaming entries (`jsonl.ts:233-252`).
- **Noise Filter Matrix**: `isParsedHardNoiseMessage` (`messages.ts:298-352`) strips non-conversational types (`system`, `summary`, `file-history-snapshot`, `queue-operation`), synthetic placeholders (`model === '<synthetic>'`), and system tag wrappers (`<local-command-caveat>`, `<system-reminder>`, empty stdout/stderr).
- **Subagent Linking Protocol**: Tri-level resolution (`SubagentResolver.ts:219-260`): exact `toolUseResult.agentId` match, team description regex match, and positional fallback.
- **What it loses or gets wrong**:
  - Token counts are estimated using character length divided by 4: `Math.ceil(text.length / 4)` (`tokenizer.ts:25`, `tokenFormatting.ts:71`), not real BPE tokenization.
  - Cost tracking is hardcoded to zero: `const costUsd = 0;` (`jsonl.ts:274,307`), lacking any pricing catalog.
  - Mentioned file tokens are arbitrarily capped at 25,000 (`contextInjection.ts:17`).
- **What the Desk will do better**:
  - Ingest exact `usage` metadata from API records (`input_tokens`, `output_tokens`, `cache_read_input_tokens`, `cache_creation_input_tokens`) and real BPE tokenizer for file previews.
  - Implement full dollar costing across models with cache read/write discounts and wasted loop attribution.
  - Bind token consumption phases directly to delivered code artifacts and canary verification outcomes.

## 6. Agent patterns
- Recognizes task coordination tools (`SendMessage`, `TeamCreate`, `TeamDelete`, `TaskCreate`, `TaskUpdate`, `TaskList`, `TaskGet`) (`contextTracker.ts:64-72`).
- Detects agent shutdown handshakes via `SendMessage` with `type: 'shutdown_response'` and `approve: true` (`jsonl.ts:507-514`).
- Detects subagent parallelism when runtime intervals overlap within 100ms (`SubagentResolver.ts:22,69`).

## 7. Model and data layer
- Pure offline parser; does not invoke models itself.
- Reads `entry.message.model` from JSONL assistant entries (`jsonl.ts:157`). No model router, fallback layer, or live pricing catalog.
- Data sources: local `~/.claude/` files via `LocalFileSystemProvider` or remote servers via `SshFileSystemProvider` (`src/main/services/infrastructure/`).

## 8. Hackathon-care checks
- **Offline / Local**: Operates completely offline against local logs with zero external network dependencies (`README.md:87`).
- **Docker / Standalone**: Ready-to-run multi-stage Docker build with Fastify web interface (`Dockerfile:1-40`, `standalone.ts:1-48`).
- **Security**: Sanitizes XML tags on display (`contentSanitizer.ts`, `jsonl.ts:332`) and enforces directory containment against path traversal in memory file loading (`MemoryReader.ts:54-57`).

## 9. Traps seen
- Hardcoded `costUsd = 0` (`jsonl.ts:274,307`) renders cost fields permanently empty.
- Character division heuristic `Math.ceil(len / 4)` (`tokenizer.ts:25`) misestimates code indentation, JSON payloads, and non-ASCII characters.
- Project directory path encoding is lossy on hyphenated folder names (`pathDecoder.ts:11-14`).

## 10. Reuse
- MIT License (`LICENSE:1-21`).
- Reusable with attribution:
  - Compaction-aware phase contribution algorithm (`jsonl.ts:583-635`).
  - Streaming `requestId` deduplication logic (`jsonl.ts:233-252`).
  - Multi-phase subagent linking and warmup filter (`SubagentResolver.ts:144-260`).
  - Claude Code JSONL tag classification and noise filters (`messageTags.ts:12-46`, `messages.ts:298-352`).

## 11. Verdict: ADAPT
- **Three things to copy**:
  1. The phase-based context consumption algorithm ($\sum \text{pre}_i - \text{post}_{i-1}$) for accurate cumulative context measurement across compactions.
  2. The streaming deduplication pass by `requestId` to prevent double-counting incremental token updates.
  3. The tri-level subagent resolution pipeline (`agentId` in `toolUseResult` $\rightarrow$ `<teammate-message>` summary matching $\rightarrow$ positional fallback) with warmup filtering.
- **Three things to avoid**:
  1. Relying on `Math.ceil(text.length / 4)` character heuristics for token attribution instead of exact API usage and BPE counters.
  2. Leaving financial cost calculations as an unpopulated stub (`costUsd = 0`).
  3. Imposing arbitrary hard token caps (like 25k) on inspected file context.
