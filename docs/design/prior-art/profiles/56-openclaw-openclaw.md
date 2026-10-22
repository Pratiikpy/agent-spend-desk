# Profile: openclaw/openclaw

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 327 seconds, 773 words. Sparse shallow clone of `src/`, `docs/` and `security/` plus root files (28,000 files; deleted after the profile pass). The spec's section 21a-3 earlier rested on its README, vision and docs; this is the first read of the gateway, approvals and scheduler code and of the execution-approval and audit documentation. Paths relative to the repository root. Other directories (extensions, apps, skills) were not read.

Spot-check (reviewer, against the files): MIT licence, copyright OpenClaw Foundation 2026 (confirmed); the audit document says persistence is best effort and queue saturation, storage failure, shutdown timeout and crashes can lose evidence, logging only a bounded warning and never aborting the run, at `docs/gateway/audit.md:92-96` (confirmed); an approved run binds cwd, exact argv, environment binding and a pinned executable path, resolved executables are re-checked before launch, and for scripts one concrete file operand is bound and a changed file after approval denies the run, with the doc stating that file binding is best-effort and that approval is refused rather than pretended when exactly one file cannot be identified, at `docs/tools/exec-approvals.md:56-60` (confirmed); host execution mode defaults to `full` and the ask policy defaults to `off`, sandbox hosts default to `deny`, at lines 229-238 (confirmed); `consumeOperatorApprovalAllowOnce` exists and calls an `operatorApprovals.consume` operation at `src/gateway/operator-approval-store.ts:306-308` (confirmed; the atomicity of the consume operation is the reader's account and the implementation behind `execute` was not read); `SECURITY.md:11-13` says shared agents are a usability feature, not a security boundary (confirmed). Result: PASS.

## 1. What it is
A local-first gateway daemon that connects messaging channels, companion devices and coding agents, with a plugin SDK, a scheduler, execution approvals and an audit ledger. TypeScript. MIT.

## 2. Architecture map
A gateway control plane over a WebSocket on loopback (a handshake checks role, token and device signature), an embedded agent runner per session, an execution-approvals manager and an operator approval store in SQLite, a cron service, a plugin SDK with model providers and channels as extensions, and an audit module.

## 3. Features and how each behaves
Execution approvals take the command, argv, working directory, agent and session and answer allow once, allow always or deny; a missing prompt or timeout falls back to a configured fallback (deny). Modes: deny, allowlist, ask, auto, full. Auto-review can allow once, deny with a reason, or escalate to a person. The cron service coalesces missed ticks, staggers start-up and sends repair turns or failure alerts for failed jobs.

## 4. How people use it
One-line installer or `npm install -g`, `openclaw onboard --install-daemon`, `openclaw gateway status`, `openclaw dashboard`; remote access by Tailscale or an SSH tunnel; Vitest suites. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M5/M13 approval binding, M10 gateway, M7 scheduling)
The approval is bound to the exact execution context: argv, directory, environment hash, executable identity (real path for protected binaries, content hash for writable ones) and one concrete file operand where it can be identified; a change in the window denies the run, and where binding cannot be made honest the approval is refused. Redemption is a single-use consume operation. Lost by design: the audit ledger is metadata only (no prompts, outputs, arguments or URLs) and is best effort.

## 6. Agent patterns
One embedded runner per session with companion node roles; auto-review as a bounded critic; a single SQLite state database with single-writer worker threads.

## 7. Model and data layer
Providers as extensions behind SDK facades; SQLite through a query builder; a model catalogue loaded at start-up.

## 8. Hackathon-care checks
Structured subsystem loggers; a minimal test gateway; one-command dev run; benchmarks for agent concurrency; inbound text treated as untrusted; mandatory challenge signing and shared-secret authentication.

## 9. Traps seen
Audit evidence can be lost on crash or queue saturation; the default host mode is `full` with asks off, and a documented "full" mode skips host approval prompts; session ownership and presence are not a security boundary (shared agents); file binding is best effort and covers one operand; multiple tenants on one gateway are unsupported.

## 10. Reuse
MIT: copy with credit and notice. Candidate parts: the approval binding fields, single-use redemption, the rule to refuse rather than pretend when binding cannot be complete, scheduler coalescing and catch-up.

## 11. Verdict: ADAPT for M5, M13 and M10
Copy: (1) approval bound to argv, working directory, environment hash, executable identity and file operand, re-checked before launch, with the refuse-rather-than-pretend rule (our request digest already binds the release; extend the same idea to the coding pack and to any tool call that executes a file); (2) single-use redemption; (3) coalescing of missed ticks with a staggered start.
Avoid: (1) best-effort audit: a lost record must stop the action (P-7), and the ledger keeps what the decision used (hashes of inputs), not only metadata; (2) a permissive default (`full`, ask off): our defaults deny; (3) treating session presence as a boundary.
Where we are already ahead: a bound, signed, offline-verifiable decision record; a fail-closed default; restrict-only rule learning.
