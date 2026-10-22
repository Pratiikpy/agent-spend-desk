# Profile: cnighswonger/claude-code-cache-fix

Reader: agy (Gemini), 2026-10-20. Prepared for .

## 1. What it is
A local Node.js caching and stability proxy intercepting Claude Code traffic to eliminate prompt-cache invalidation, normalize request prefixes, and monitor API quota burn (`README.md:6-8,17-29`).
- Licence: MIT License (`LICENSE:1-3`), read first (GitHub API metadata reports "other").
- Last commit date read: 2026-09-05T19:15:00Z (commit `0e7aa80`, pushed_at `2026-09-05T19:15:05Z`; 444 stars).

## 2. Architecture map
Sits on `127.0.0.1:9801` (`README.md:17,174,377`) between Claude Code and `api.anthropic.com`. Entry points are `bin/claude-via-proxy.mjs`, `bin/ca-trust.mjs`, and `proxy/server.mjs`. Handles `GET /health`, `POST /v1/messages*`, and `/api/claude_cli/bootstrap`, blind-tunneling other traffic (`proxy/server.mjs:296-304`). A dynamic pipeline (`proxy/pipeline.mjs:102-158`) executes modular extensions via four hooks: `onRequest`, `onResponseStart`, `onStreamEvent`, and `onResponse`.

## 3. Features and how each behaves
Addresses prompt-cache miss causes and session failures:
1. **Unstable version fingerprints:** Strips CC's 3-char hash computed from salt, version, and `messages[0]` characters at indices [4, 7, 20], which drift on resumed sessions (`proxy/extensions/fingerprint-strip.mjs:6-10`, `docs/extension-impact-guide.md:9-19`).
2. **Non-deterministic ordering:** Alphabetically sorts tools and user-invocable skill / deferred-tool blocks (`proxy/extensions/sort-stabilization.mjs:7-20,60-62`).
3. **Fresh-session bypass:** Applies block sorting on turn 1 where CC's `normalizeResumeMessages` short-circuits on `length < 2` (`proxy/extensions/fresh-session-sort.mjs:1-25`, `docs/extension-impact-guide.md:38-48`).
4. **Agent vs SendMessage identity mismatch:** Normalizes `system[1]` identity strings (`proxy/extensions/identity-normalization.mjs:1-30`, `docs/extension-impact-guide.md:49-60`).
5. **Missing 4th cache breakpoint:** Injects `cache_control: { type: "ephemeral", ttl: "1h" }` at the boundary between auto-injected system reminders and user content (`proxy/extensions/messages-cache-breakpoint.mjs:1-60`, `docs/extension-impact-guide.md:167-177`).
6. **Thinking desync wedge:** Sanitizes thinking blocks to avoid permanent 400 errors (`proxy/extensions/thinking-block-sanitize.mjs:1-50`, `WORKAROUND_CATALOG.md:40-48`).
7. **Redundant file reads and image bloat:** Replaces duplicate `Read` results with pointer lines (`proxy/extensions/read-dedupe.mjs:268-270`); limits dimensions and payload bytes (`proxy/extensions/image-strip.mjs:125-139`).
Defaults pass through unmodified (`README.md:27-29`). Failures log `[pipeline] ... error` without breaking requests (`proxy/pipeline.mjs:112,127,141,155`).

## 4. How people use it
Installed via `npm install -g claude-code-cache-fix` or launched with `HTTPS_PROXY=http://127.0.0.1:9801` / `ANTHROPIC_BASE_URL=http://127.0.0.1:9801 claude` (`README.md:174,377`). Tested using Node's test runner across `test/*.test.mjs`. Integrates with shell functions, systemd services (`bin/install-service.mjs:1-50`), and status lines (`tools/quota-statusline.sh:1-40`). Issues and community analyses cited: anthropics/claude-code#38335, #34629, #47098, #63147 (`README.md:31,164`, `WORKAROUND_CATALOG.md:40-56`).

## 5. Mechanism for the Desk
**Data model and formulas to copy:**
- Hit-rate formula: `hitRate = (cacheRead / (cacheRead + cacheCreation)) * 100` (`proxy/extensions/cache-telemetry.mjs:353`).
- Measured TTL-tier detection from stream: extracts `ephemeral_1h_input_tokens` vs `ephemeral_5m_input_tokens`; sets `ttl = ephemeral1h >= ephemeral5m ? "1h" : "5m"`, falling back to `cr > 0 ? "1h" : (cc > 0 ? "5m" : "unknown")` (`proxy/extensions/cache-telemetry.mjs:336-368`).
- Quota metrics: extracts 5-hour and 7-day unified utilization, reset epochs, and overage status (`proxy/extensions/cache-telemetry.mjs:188-225`).

**Detecting cache invalidation from traffic:**
1. *Invariant session-keyed prefix diffing:* Keyed by `x-claude-code-session-id` rather than content hashes (avoiding self-defeating keys; `proxy/extensions/prefix-diff.mjs:51-54`). Diffs per-block text offsets, tool schema parameter hashes, top-level model/temperature parameters, and message-chain hashes, writing an append-only `<key>-events.jsonl` ledger (`proxy/extensions/prefix-diff.mjs:7-10,51-90`).
2. *Structural upstream drift fingerprinting:* Establishes baselines keyed by `sha16(model|sorted(beta_headers))` (`proxy/extensions/upstream-change-detection.mjs:190-193`). Detects structural changes across system section markers (`# Environment`, etc.), tool schemas, and cache-control positions without storing sensitive prompt text (`proxy/extensions/upstream-change-detection.mjs:16-18,236-288`).
3. *Sliding-window regression detector:* Evaluates whether recent turns consistently fall below a target ratio (`test/regressionDetector.test.mjs:14-27`).

**What they get wrong:** In-memory dedup states reset on restart (`docs/extension-impact-guide.md:117`); Phase 1 microcompact normalizes sentinels but discards original tool content (`docs/extension-impact-guide.md:219,260`); cost burn estimates use coarse static rate multipliers (`docs/extension-impact-guide.md:116`).
**What the Desk will do better:** Store state in Plumbline's append-only ledger across restarts, calculate exact tier pricing per model, and bind invalidation diffs to individual subagent tasks.

## 6. Agent patterns
Pipeline proxy without autonomous agent loops. Features deterministic state handling: single-writer per-session files (`proxy/extensions/cache-telemetry.mjs:12-15`), sticky model divergence latching after 3 consecutive divergent turns (`proxy/extensions/cache-telemetry.mjs:128-133`), and connection draining (`proxy/server.mjs:20-40`).

## 7. Model and data layer
Intercepts Anthropic `/v1/messages` JSON protocol (`proxy/server.mjs:297`). Classifies families via `proxy/model-families.mjs`. Stores session files, upstream baselines, and snapshot ledgers under `~/.claude/` using atomic rename writes (`proxy/extensions/cache-telemetry.mjs:228-232`).

## 8. Hackathon-care checks
- Trace/logs: JSONL event ledgers (`upstream-changes.jsonl`, `<key>-events.jsonl`, `overage-warnings.jsonl`).
- Offline tests: Suite runs offline via Node.js native test runner (`test/*.test.mjs`). `SAMPLE_MODE`: NOT VERIFIED.
- Docker: Root `Dockerfile:1-25`.
- Security: Redacts `Authorization`, `x-api-key`, and cookies from debug logs (`proxy/server.mjs:43-57`); enforces 0600 file permissions (`proxy/extensions/prefix-diff.mjs:18-20`); minimizes content by storing hashes over plain text (`proxy/extensions/prefix-diff.mjs:21-27`).

## 9. Traps seen
Node ESM caching races previously caused silent extension-load failures (Issue #196, `proxy/pipeline.mjs:51-63`); coarse burn rates hardcoded in `proxy/rates.mjs`; optional `sharp` peer dependency required for image Lanczos resizing (`docs/extension-impact-guide.md:144-146`).

## 10. Reuse
MIT License (`LICENSE:1-3`). Telemetry extraction, prefix-diffing algorithms, and AST-style structural fingerprinters may be reused directly with attribution.

## 11. Verdict: ADAPT for the Spend and Worth Desk
**Three things to copy:**
1. Invariant session-header indexing for cache-bust diffing rather than hashing mutable prompt text (`proxy/extensions/prefix-diff.mjs:51-54`).
2. Stream-level TTL tier detection (`ephemeral_1h` vs `ephemeral_5m`) and unified quota tracking (`proxy/extensions/cache-telemetry.mjs:188-225,350-368`).
3. Privacy-preserving structural fingerprinters that detect prompt and tool-schema drifts without persisting raw text (`proxy/extensions/upstream-change-detection.mjs:16-18,236-288`).

**Three things to avoid:**
1. In-process ESM dynamic module reloads that cause stale cache degradation (`proxy/pipeline.mjs:51-63`).
2. Volatile in-memory dedup states that wipe on process restart (`docs/extension-impact-guide.md:117`).
3. Hardcoded single-constant cost projections instead of exact pricing tables (`docs/extension-impact-guide.md:116`).

*Where we are already ahead:* Plumbline provides tamper-evident offline-verifiable receipts, exact multi-model cost attribution, and certified replay-verified rules.
