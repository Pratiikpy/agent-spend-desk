# Profile: coder/boundary (the agent firewall) and the AI Gateway budget in coder/coder

Repository search: `coder/agent-firewall` does not exist (404, 2026-10-20). The agent firewall is `coder/boundary` (MIT, `LICENSE:1`, 25 stars, last commit 2026-08-12T11:51Z, README: "Network isolation tool for monitoring and restricting HTTP/HTTPS requests from processes"). The spend side lives in `coder/coder` (AGPL-3.0, `LICENSE:1`, 17,113 stars, last commit 2026-10-20T11:23Z): mechanism only, rebuild from the idea. Reader: Claude Sonnet, 2026-10-20. Read through the GitHub API and raw files, no clone. In coder/coder, only `coderd/aibridge/budget/*`, `coderd/aibridgedserver/cost.go`, `notifications.go`, `coderd/aibridged/http.go` and the aibridge README were read.

## 1. What it is
boundary: a Linux process jail with a transparent HTTP(S) proxy and a default-deny allow list. AI Gateway (`aibridge` in coder/coder): a handler that sits between agent clients (Claude Code, Cursor) and Anthropic or OpenAI, records tokens, prompts and tool calls per user, prices them, and refuses requests once a user's budget is spent.

## 2. Architecture map
boundary: `rulesengine/` (parse and match), `proxy/`, `nsjail_manager/` and `landjail/` (two jail backends), `audit/` (log, multi, socket auditors). coder/coder: `aibridge/` (bridge, interceptors per wire format, circuit breaker), `coderd/aibridge/budget/` (limit resolution), `coderd/aibridge/prices/` (embedded price book), `coderd/aibridgedserver/` (usage recording, cost, notifications).

## 3. Features and how each behaves
boundary rule text: `--allow "method=GET,HEAD domain=github.com path=/api/issues/*"` (README). Evaluate returns `{Allowed, Rule}`; the first matching allow rule wins; no match is deny (`rulesengine/engine.go:30-46`). Host matching is label-wise and exact: `github.com` does not match subdomains; `*.github.com` does not match the base (`engine.go:78-106`). Each request becomes an audit record `{Method, URL, Host, Allowed, Rule, SequenceNumber}` (`audit/request.go:8-18`); the matched rule is stored only for allowed requests (`socket_auditor.go:77-81`).

## 4. How people use it
`boundary --allow "domain=github.com" -- npm install`; needs Linux and, for the default backend, sudo (README). Usage evidence: NOT VERIFIED.

## 5. Mechanism for the Desk
Budget resolution (`budget.go:43-86`): a per-user override always wins; else a deployment policy ("highest") picks the largest group budget the user belongs to; with none, the user falls to the Everyone group with no limit (`:88-111`). Limit is `SpendLimitMicros int64` (1 unit = 1,000,000) plus a source tag (user override or group) (`:36-41`). Period: calendar month in UTC, window `[start, start+1 month)` (`period.go:21-31`); only month exists.
Cost (`cost.go:79-197`): on every interception the price row for provider and model is looked up, falling back to the provider-reported model; the four per-million-token prices (input, output, cache read, cache write) are copied onto the usage record with the cost, so later price changes cannot rewrite history (`:153-157`); cost is a sum of four terms in decimal arithmetic (`:187-191`). An unpriced model, an unresolved provider or an out-of-range cost is stored as NULL meaning unknown, never zero, and counted in a metric (`:122-123, 145-147, 163-177`). Token counts outside [0, 10^12] are rejected (`:19-22, 44-62`). Prices come from a build-time snapshot of models.dev (`prices/data/README.md`).
Enforcement (`aibridged/http.go:164-178`): before forwarding, `IsBudgetExceeded`; error means HTTP 500 (fail closed); exceeded means HTTP 403 with the limit in the message. Notifications fire at 85 and 100 percent to the user and an admin, and one request can cross both (`notifications.go:20-51`). Note the order: the check is before the call and the cost is added after it, so the crossing request is allowed and the next is refused (derived from the two files; not tested).
What is missing for the Desk: no outcome side at all (nothing says whether the work landed); no loop, retry or idle detection (spend is per request); no forecast; a single monthly period; no save-before-stop (the response is a flat refusal); the stored decision is not signed; one hard cap, no approval step. boundary controls network destinations, not money, and its audit queue drops records when full (`socket_auditor.go:90-95`), so its trail is lossy.

## 6. Agent patterns
Neither is an agent system. Both are gates in the data path, which is the right place for enforcement: the agent cannot skip them.

## 7. Model and data layer
The gateway speaks the three provider wire formats, so any agent client works by changing a base URL. That is the cheapest route to metering an owner's real agents without touching their code.

## 8. Hackathon-care checks
Both need Linux or a Go server with a database; neither is a one-command demo for a judge. Audit has sequence numbers, which makes gaps detectable.

## 9. Traps seen
Cost NULL treated carefully but the budget total over NULL costs is not shown in what was read (NOT VERIFIED). Prices are a snapshot, so a new model is unpriced until rebuilt. The crossing request overshoots the cap.

## 10. Reuse
boundary: MIT, may copy with credit. coder/coder: AGPL, mechanism only.

## 11. Verdict: ADAPT (mechanism from coder/coder; rule grammar from boundary)
Copy: (1) price snapshot stored on each usage record, with NULL for unknown cost and a counter of unpriced records; (2) override-beats-group limit resolution with a source tag and a calendar-month window in UTC; (3) check-before-call, fail closed on a checker error, warn at 85 and stop at 100 percent.
Avoid: (1) a lossy audit queue for anything that must be provable; (2) a flat refusal with no save-point; (3) overshoot by one call when a pre-call estimate is available.
Already better in our plan: outcome receipts joined to each dollar, loop and idle classification, forecast, and a signed dossier.
