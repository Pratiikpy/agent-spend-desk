# Profile: loop-eng/loopguard

Reader: Claude Sonnet, 2026-10-20. Remote read (no clone). Paths relative to repo root. Licence read first: MIT (LICENSE). Last commit read: 2026-10-05. Stars 0 (2026-10-20). Spot-check: internal/analyzer/spin.go:139-143, 232-242, 311-324; budget.go:43-101; enforcer/sentinel.go:11-16 re-read; matched. Tests were not run (NOT VERIFIED).

## 1. What it is
A Go daemon that tails the JSONL session logs of Claude Code, Codex and Gemini CLI, prices them, and pauses the agent process (SIGSTOP) or writes a sentinel file when a budget or "spin" rule trips (README.md:7-31).

## 2. Architecture map
discovery -> watcher (fsnotify + 5 s poll) -> parser -> `Analyzer.Process` (cost, budget, spin) -> alert channel -> `Daemon.executeAlert` -> `Enforcer` + notifier + history + LTF trace (README.md:64-88; analyzer.go:121-198; daemon.go:411-464). Control over a local HTTP/socket API (`internal/api`).

## 3. Features and behaviour
Budgets per session, rolling hour, calendar day, warn at 80% once per limit (budget.go:43-101, 131-158; analyzer.go:151-168). Five spin heuristics (spin.go:103-169). Actions: warn, pause, kill (enforcer.go:45-61). Pause: SIGSTOP the process group unless it is the daemon's own group (process.go:24-34), else write `.loopguard-stop` (sentinel.go:11-16). Hot-reload of config and pricing (daemon.go:466-530). LTF JSONL intervention trace (README.md:199-205).

## 4. How people use it
`brew install` or `go install`, run `loopguard`, zero config (README.md:33-62). Tests: spin 10, analyzer integration 10, cost 8, daemon 6 functions; parser fuzz tests; `demo/test_e2e.sh` (FINDINGS.md:76-77 claims 26/26 passing, not run by me).

## 5. Mechanism for the Desk
Data model: `ParsedEvent{session, model, tokens{input, output, cacheRead, cacheWrite}, contentType tool_use|tool_result|text, toolName, toolInput, isError, errorMsg}`. Cost = four token classes x per-MTok price (cost.go:77-86), better than AgentBudget because cache read/write are priced. Unknown model -> Sonnet-tier fallback with a warning (cost.go:102-103; pricing.go:33). Dedupe by `requestId`; an entry with no requestId contributes zero tokens (parser/claude.go:79-97), so cost is a floor.
Loop rules (spin.go):
- Repeated call: sha256(tool|input)[:8] in a 50-slot ring; spin when any fingerprint appears `>= 3` times in the ring (:180-200, 326-329). It is a count over the window, not consecutive, so three legitimate `git status` calls over an hour trip it.
- Error echo: first 200 chars of an error, lower-cased, 3 times (:211-230, 331-337).
- Cost velocity: cumulative session cost delta over the last 5 min divided by minutes, needs 1 min of data, trips at $2/min (:244-280).
- Context bloat: `input_tokens` of this turn against a model window; unknown model uses 200,000 (pricing.go:39), 85% trips a pause (:287-324, 158-165).
- Stall (idle): no file-modifying tool for 10 min "despite activity" (:232-242). It is only a warning appended to reasons; `IsSpinning` is not set (:139-143), and it cannot fire at all if the session has never edited a file (:233). Only `Edit`, `Write`, `NotebookEdit` count as progress (parser/claude.go:195-200), so Bash edits do not. I found no test mentioning stall in spin_test.go, integration_test.go or daemon_test.go.
Enforcement is after the fact: log lines arrive after the model call is paid for. The author's own E2E shows "$5.25/$5.00 (105%)" (FINDINGS.md:22). After resume the limit is still exceeded and re-trips at once (FINDINGS.md:68); no "extend the cap" flow.
What the Desk should take: the idea that a spin rule is a set of independent, cheap, explainable heuristics each with a named reason that goes into the trace; the cost-velocity window; the cache-aware price formula. What to fix: windowed counts need a "no progress between repeats" condition (same tool and args AND unchanged result or no file diff), stall must be a first-class state with an owner-chosen action, and "progress" must come from an outcome signal (tests passed, PR merged, file diff kept) rather than tool names.

## 6. Agent patterns
No agent. A rules engine over a trace, with human-in-the-loop resume (`loopguard resume <id>`, README.md:155).

## 7. Model and data layer
Price table and context windows hard-coded (pricing.go:10-65) with YAML overrides (cost.go:25-34). Window sizes for Sonnet 4.5/4.6 are listed as 1,048,576 (pricing.go:50-51): NOT VERIFIED against vendor docs.

## 8. Hackathon-care checks
Runs offline on local files, no keys. Config and trace are plain YAML/JSONL. Linux/macOS signals only (syscall SIGSTOP); Windows is not handled (process.go uses `syscall.Kill`): NOT VERIFIED for Windows build.

## 9. Traps seen
FINDINGS.md says 40 of 40 bugs fixed but its method is "4 parallel audit agents + manual code review" (FINDINGS.md:1-14), so it is self-attested. The README incident table (README.md:13-17) cites no source, and both claims in README.md:19 link to one issue URL: NOT VERIFIED. "Preserves agent state perfectly" (README.md:30): SIGSTOP freezes the process, but open network streams may time out; NOT VERIFIED. The sentinel file stops nothing unless the agent reads it: NOT VERIFIED that any agent does.

## 10. Reuse
MIT: copy with credit. Candidate parts: spin reasons as typed codes, the cost-velocity window, pricing resolution by longest prefix (cost.go:88-104), LTF event shape.

## 11. Verdict: ADAPT
Copy: (1) heuristics as independent named detectors, each emitting a reason string into the trace; (2) cache-aware pricing with longest-prefix model match; (3) pause with preview and one-command resume.
Avoid: (1) count-in-window repeats with no progress check; (2) a stall detector that can never fire and is untested; (3) treating log-tail enforcement as a hard cap.
