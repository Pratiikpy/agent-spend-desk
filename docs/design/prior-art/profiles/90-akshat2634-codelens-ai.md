# Profile: Akshat2634/Codelens-AI (chosen for slot 90, "AI usage ROI" tool)

Reader: Claude Sonnet, 2026-10-20. Remote reads, no clone. Paths relative to the repository root; line numbers are those of the raw file. Licence read first: MIT. Stars 11; last commit (pushed_at) 2026-10-16; version 0.10.3 (`package.json`). Stars are not evidence of quality; the choice rests on the code read below.

## Search record (GitHub, `gh search repos`, 2026-10-20)
Queries: "ai code attribution git"; "git-ai"; "claude code cost per pull request"; "ai coding roi"; "ai-generated code survival"; "agent cost merged pr"; "agentic coding productivity metrics"; "ai code retention blame"; "claude code transcripts git commits outcome"; "token cost per commit git"; "copilot roi accepted lines merged". No steipete tool turned up. Candidates seen: mesa-dot-dev/agentblame (102 stars, line-level AI blame), codeprakhar25/agentdiff (47, signed per-line provenance), gitintel-ai/GitIntelAI (4, Rust blame plus cost per commit), anujgawde/agent-trail (0, joins transcripts to commits and PR outcomes, 81 KB, only a few small files), mooracle/claude-budget (5, cost trailers on commits), Akshat2634/Codelens-AI (11), RyanCoreAI/token-studio-roi (7), microsoft/CopilotAnalyticsLabs (9, a Viva Insights hub, not read). Chosen: Codelens-AI, because it is the only one found that joins spend to commits, deduplicates squash and rebase copies, scores code survival and computes dollars that never reached a commit. Not read in depth: agentblame, agentdiff, GitIntelAI, agent-trail.

## 1. What it is
Local-first ROI analytics for Claude Code, Codex and Copilot. It reads agent session logs, joins them to `git log`, and reports cost per commit, code survival, AI code share and a value-leak figure (`README.md:113-117`).

## 2. Architecture map
`claude-parser.js`, `codex-parser.js`, `copilot-parser.js` (sessions, cost); `git-analyzer.js` (commits); `correlator.js` (session-to-commit); `metrics.js` (grades, survival, leak); `pricing.js`; `mcp.js` (a scorecard tool for agents); `server.js` and a dashboard.

## 3. Features and how each behaves
Commit list is `git log --no-merges --all` with the Co-authored-by trailer (`src/git-analyzer.js:414`). Rebase and cherry-pick copies are collapsed, and a GitHub squash-merge twin is dropped only when author, identical per-file diffstat, subject (minus the "(#123)" suffix), one copy on main and author date within 10 minutes all agree (`git-analyzer.js:447-486`).

## 4. How people use it
`codelens-ai` CLI, optional `--plan max20` for subscription mode (`README.md:141-149`). Tests are Playwright e2e plus fixtures for every agent. Usage evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
**Attribution rules** (`src/correlator.js:79-138`): a session may claim a commit only if the commit falls in `[sessionStart, sessionEnd + 2h]` AND the commit touches a file the session wrote. A chat-only session may claim by time alone only with 5 or more messages (`correlator.js:1-6,104-111`). When several sessions qualify the winner is chosen by this order: file overlap beats time-only; a session whose agent matches the commit's Co-authored-by trailer beats others; then the closest in time; ties go to the later start (`correlator.js:122-132`). The trailer matcher uses vendor email domains first and refuses bare human first names such as "Claude Martin" (`git-analyzer.js:206-246`). Copy this ordering as the Desk's written attribution policy.

**Confidence per attribution** (`correlator.js:178-218`): high if at least half the matched commits carry this agent's trailer; low for time-only matches; with file evidence, overlap of 50% or more of added lines is high (medium if under half the commits fall inside the session window), under 20% is low, otherwise medium. Copy: show the confidence beside every dollar.

**Landed means a commit, and onMain is a flag.** Spend per commit is `session.cost / matched commits` (`correlator.js:232`). A session with more than 10 messages and no matched commit is "orphaned" (`correlator.js:176`). **Value leak** is the cost of every repository session with zero commits, shown as dollars and a share of repository spend (`src/metrics.js:1274-1284`). Sessions outside a git repository are not graded at all, because an F would imply failed delivery (`metrics.js:597-601`). Copy the not-applicable state.

**Survival.** For AI-correlated commits only, per repo-and-path, a last-in-first-out stack of live added lines is walked in time order; a deletion counts as churn only if it hits an addition within 24 hours (`metrics.js:15,385-406`). Lines younger than the window are excluded from the rate (right-censoring), the rate is `null` when nothing is old enough, and it is rounded to the nearest 5% (`metrics.js:408-421`). A grade with no survival evidence is graded on cost alone, and the score gives half marks, not full (`metrics.js:547,571`).

**Subscription mode** reports effective dollars per commit and plan utilisation, explicitly "an estimate of value extracted, not realized savings" (`README.md:249`).

## 6. Agent patterns
None. It exposes an MCP scorecard so an agent can read its own ROI (`src/mcp.js:31`).

## 7. Model and data layer
Reads local logs and the local git history; no network. Prices come from a table, with "estimated-pricing share flagged" in the report (`README.md:211`).

## 8. Hackathon-care checks
Offline, fixtures for every source (`tests/fixtures/`), CI and CodeQL workflows present. Single-maintainer, young repository.

## 9. Traps seen (these answer the question "what can a log not tell you")
1. **No revert detection.** `git-analyzer.js` contains no "revert" (search returned zero matches); a reverted commit still counts as shipped, and survival uses a 24-hour window only, so "kept after N days" is not measured beyond one day.
2. **No pull-request or review data.** `--no-merges` is used and merge status is only `onMain`; a PR that was closed unmerged is invisible, and a commit on an unmerged branch counts as shipped.
3. **No CI result.** A commit is credited whether or not tests passed; the verification evidence in the transcript is not used. Cost per commit also rewards many tiny commits.
4. **Time proximity is a guess.** The 2-hour post-session buffer can hand a human commit to an agent session; the code flags this with the confidence grade instead of hiding it (`correlator.js:190-193`).
5. **Grade bands** ($2, $5, $15, $40 per commit; `metrics.js:548-552`) are fixed numbers with no source.

## 10. Reuse
MIT: correlation order, confidence rule, squash-twin collapse and the censored survival method may be reused with credit.

## 11. Verdict: ADAPT (best found for spend-to-commit joining; incomplete for "landed")
Copy: (1) the written attribution order with trailer, file overlap and time, and a confidence label per match; (2) value leak as dollars and share, with a not-applicable state; (3) right-censored survival that returns `null` rather than 100%.
Avoid: (1) crediting a commit with no CI, PR or revert check; (2) a one-day survival window sold as quality; (3) fixed dollar bands for grades.
The Desk's answer to the red-team point "dollar figures are estimates": every dollar carries `reported|estimated`, an attribution confidence, and a landing state from the lattice `unlinked < committed < merged < checks green < kept N days < reverted/rewritten`; the share in `unlinked` is printed as unknowable, never folded into waste.
