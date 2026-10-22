# Profile: NousResearch/hermes-agent

Reader: agy (Gemini CLI, plan mode), 2026-10-16, 222 seconds, 874 words. Shallow clone (depth 1), deleted after the profile pass. Paths relative to the repository root. The spec's section 21a-4 and 11 already mention Hermes-style skill learning from earlier documentation reads; this is the first code-level read.

Spot-check (reviewer, against the code): MIT licence (confirmed); the write-approval switch is read from configuration and "any unset or invalid value means gate off", with `except Exception: return False`, at `tools/write_approval.py:45-52` (confirmed, so the approval gate is off by default and fails open); staging a pending write catches a disk failure, logs it and still returns the in-memory record at lines 80-89 (confirmed); the memory tool's gate helper returns None (proceed) if the gate module cannot be imported, the docstring itself saying "Fails open if the gate module can't load", at `tools/memory_tool.py:84-90` (confirmed); entry pinning records the full matched entry at staging so approval applies only to what the reviewer saw and refuses if it changed, at `memory_tool.py:62-82` (confirmed); the scheduler advances the next-run time before dispatch for at-most-once execution and restores a missed slot once, at `cron/AGENTS.md:24-30` (confirmed). Result: PASS.

## 1. What it is
An open-source autonomous agent runtime: messaging gateway for many platforms, curated persistent memory, self-improving skills with a background curator, a scheduler, remote sandboxes. MIT.

## 2. Architecture map
A conversation loop with tool dispatch; a tool registry with discovery and a short availability cache; SQLite in write-ahead mode with full-text search for sessions; a skills store with usage telemetry and a curator; a cron scheduler; gateway adapters with a canonical routing identity per message; a JSON-RPC server for the terminal and desktop interfaces.

## 3. Features and how each behaves
Memory tool actions add, patch, remove and batch, into two small files (notes and user profile, about 2,200 and 1,375 characters), entries separated by a marker; the file is shown to the model as a frozen snapshot so the prompt cache stays valid. A skill curator runs after idle time and archives unused skills (stale after 14 days, archive after 30, pinned skills exempt). Write approval, when enabled, stages memory and skill writes as pending records and lets a human approve them; headless runs always stage. Scheduler ticks every 60 seconds with an idle watchdog.

## 4. How people use it
A one-line installer for POSIX or PowerShell, then `hermes`; messaging gateways; container and remote sandboxes (Docker, SSH, Modal, Daytona). Tests run each file in an isolated subprocess. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M6 skills and memory, M13 approvals, M10 scheduler)
The strongest ideas are about approval time-of-check versus time-of-use: pin the exact entry at staging; refuse at approval if it has changed. For the scheduler, advance the next-run time first, mark a pending slot, and restore a missed slot exactly once after a crash, with a ledger that blocks a second fire. Memory content passes a regular-expression scan for injection and command-and-control patterns before being written; webhooks that are untrusted are restricted to read-only tools. Lost: unpinned skills are archived by age, writes past the size limits fail.

## 6. Agent patterns
Leaf and orchestrator subagents, an auxiliary model for curation, a model failover chain, tool availability cached for 30 seconds with a 60-second grace period before a failing tool is de-listed.

## 7. Model and data layer
Provider plugins with context-length resolution; an auxiliary client for side tasks; SQLite for sessions; file tools for workspace access.

## 8. Hackathon-care checks
Sessions in SQLite, batch trajectories as JSONL; tests offline with isolated directories; Docker only as a sandbox target. Published benchmarks and any offline model mode: NOT VERIFIED.

## 9. Traps seen
Approval gate defaults off and fails open on any configuration or import error; a failed disk write while staging still returns a success-looking record; failed availability probes are hidden by the grace cache and counted as available; missing lock modules silently reduce cross-process locking to in-process.

## 10. Reuse
MIT: copy with credit. Candidate parts: entry pinning at staging, at-most-once scheduling with a pending slot and a ledger, frozen memory snapshots for cache stability, threat-pattern rules, a probe cache with an explicit window.

## 11. Verdict: ADAPT for M13 and M6; its gate design is the negative example for M5
Copy: (1) pin the exact object a human reviewed and refuse to apply an approval if it changed (our request digest already does this; add the same rule for rule and memory proposals); (2) scheduling with advance-then-dispatch and one restore of a missed slot, proven by a crash test; (3) a frozen snapshot of memory for the duration of a decision, with changes visible only to the next decision.
Avoid: (1) approval gates that default to off and fail open: ours fails closed on every error, and its absence is a refusal; (2) success-looking records after a failed persist; (3) hiding probe failures behind a grace window for tools in a decision path.
Where we are already ahead: gates are restrict-only and fail closed; approvals bind a request digest; a rule change needs replay and a symbolic check.
