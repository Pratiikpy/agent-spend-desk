# Profile: entireio/cli (agent sessions linked to git commits)

Reader: Claude Sonnet, 2026-10-20. Remote read only (`gh api` and raw files, no clone). Paths are relative to the repository root. Line numbers come from the raw files as fetched on 2026-10-20.

## 1. What it is
A Go CLI that records each AI coding session and, at commit time, condenses it into a permanent "checkpoint" linked to the code commit by an `Entire-Checkpoint` trailer (README.md:229; docs/architecture/sessions-and-checkpoints.md:35-37). Licence: MIT, "Copyright (c) 2026 Entire Inc." (LICENSE:1-3), read first. Stars 5193, pushed 2026-10-20 (`gh api`, 2026-10-20). Last commit read: 904b1e8, 2026-10-20 12:32Z.

## 2. Architecture map
Two tiers. Pending work lives in `.git/entire-sessions/<id>.json` plus `.entire/metadata/<id>/` (docs/architecture/sessions-and-checkpoints.md:57-60). After a commit, a checkpoint lands in `entire/checkpoints/v1` (branch backend) or one ref per checkpoint under `refs/entire/checkpoints/<shard>/<id>` (refs backend) (same file :132-136). `api/checkpoint/interfaces.go:44-98` defines a pluggable `PersistentStore` (reads for checkpoint, session, task) with one `Write(WriteRequest)` over a sealed union of four request types (:65-92). Hooks per agent (Claude Code, Codex, Cursor, others) feed the lifecycle; `cmd/entire/cli/strategy/` holds the single manual-commit strategy (docs/development/checkpoint-implementation.md:9).

## 3. Features and how each behaves
Turn end: `SaveStep` writes only session state, no git objects (checkpoint-implementation.md:15, :44). Commit: condensation writes metadata, a redacted transcript and a compact transcript (:53). `resume` restores session logs and checks out the branch, "logs only, never worktree files" (:26-28; cmd/entire/cli/checkpoint_resume.go:30-49), and is hidden (:32). Rewind was removed: "There is no restore path" (checkpoint-implementation.md:18-21).

## 4. How people use it
`entire enable`, work with an agent, commit; the trailer is added. Tests: simulated-hook integration and a free deterministic E2E canary (CLAUDE.md:46-64). Usage evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
Data model per checkpoint (api/checkpoint/metadata.go): checkpoint id, session id, branch, commit SHA, files touched, agent, **model** (:431-454), token usage (:488), session metrics (duration, turn count, context tokens, :638-643), an AI summary with intent/outcome/friction/open items (:645-651), and `LinkedCommits` (:673-680). Token usage has input, cache-creation, cache-read, output, API-call count and nested subagent tokens (sessions-and-checkpoints.md:103-110), scoped to the pending delta since the last condensation (checkpoint-implementation.md:58).

This is the join the Desk needs: **tokens by model by session, tied to a commit and its files**, so "dollars to work that landed" becomes tokens times a price table over commits that survived. What it loses:
- No dollar or price field anywhere (grep of metadata.go and the architecture doc for cost/usd/price found none, 2026-10-20). The Desk must hold its own versioned price table.
- Linking is by file name, not content: any commit touching a path in `FilesTouched` "contains the agent's work"; no hunk or blob comparison (checkpoint-implementation.md:45). A human edit to the same file is counted as agent work.
- "Landed" is not tracked after the commit. A later revert or deletion is invisible; amend and rebase are remapped by a `post-rewrite` hook (:55, :65) but survival is not scored.
- The `summary` is model-written, so it is a claim, not evidence.
Better for the Desk: join checkpoint to commit, then check survival (still in HEAD after N days, reverted, test status) as a measured outcome receipt, and keep the model's summary labelled as a claim.

## 6. Agent patterns
None; it observes. Commit-to-session linking is identity-first, by process-ancestry fingerprint, so a human commit in the same terminal does not match (checkpoint-implementation.md:60).

## 7. Model and data layer
Model-agnostic: per-agent transcript adapters and an external-agent protocol (CLAUDE.md:39-40). The summary provider is a trust boundary gated to local settings (checkpoint-implementation.md:76-98).

## 8. Hackathon-care checks
Offline and local: nothing is sent unless a remote push is configured. Redaction runs before any git object write, in a fixed order: sanitize, externalize images, redact (:49). Layers: entropy above 4.5, pattern engines, provider prefixes, credentialed URIs, DB strings, credential values (docs/security-and-privacy.md:28-37). Honest limits are stated: redaction is "best-effort" (README.md:677) and pasted images are stored unredacted for Claude Code (security-and-privacy.md:43-56).

## 9. Traps seen
Committed transcripts are readable by anyone with repo access (security-and-privacy.md:24). Redaction is ~99.7% of a transcript blob write (checkpoint-implementation.md:50). Retention behaviour: NOT VERIFIED.

## 10. Reuse
MIT: may reuse with credit. Reuse ideas and small pure pieces; the Go stack differs from ours (TypeScript).

## 11. Verdict: ADAPT
Copy: (1) the checkpoint record shape, including model and a four-part token breakdown plus subagent tokens, as the spend ledger row; (2) the trailer-style link from a work unit to a commit, with identity-first matching so human work is not charged to the agent; (3) redact before write, per line and stateless, with an append-only cache so cost stays proportional to new lines (checkpoint-implementation.md:50-52).
Avoid: (1) file-name linking as proof the agent's work landed; (2) storing raw transcripts where a wide audience can read them; (3) treating a model-written summary as an outcome.
