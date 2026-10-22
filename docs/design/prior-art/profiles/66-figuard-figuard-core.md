# Profile: figuard/figuard-core

Reader: Claude Sonnet, 2026-10-20. Remote read (no clone). Paths relative to repo root. Licence read first: LICENSE is Apache 2.0 text and README.md:315-317 says Apache 2.0; the GitHub API reports "NOASSERTION" (no SPDX match), so treat as Apache-2.0 with that caveat. Last commit read: 2026-06-17 (API `pushed_at` 2026-09-11). Stars 2. Spot-check: AuthorizationService.java:76-77, 593-612; PaymentLifecycleService.java:68-71, 107-110; crewai.py:144, 186-195 re-read; matched. The 380 JUnit methods were counted by grep, not run (NOT VERIFIED that they pass).

## 1. What it is
An authorize / confirm / void / fail ledger for agent spend: a Java 21 Spring Boot and Postgres server, plus a Python SDK with an embedded SQLite engine (`sdk/python/figuard/_embedded/engine.py`), TS SDK, MCP server, React dashboard. Spend units can be money or any label such as tokens (AgentBudget.java:67-76).

## 2. Architecture map
`AuthorizationService.authorize` (one `@Transactional` method, AuthorizationService.java:76-357) -> `PaymentLifecycleService` confirm/fail/void (:60-250) -> `LedgerIntegrityService` (every 5 min), `ReplayService`, `WebhookDispatcher`, sweep jobs. Delegation tokens split a parent budget across sub-agents (DelegationService, V15 migration).

## 3. Features and behaviour
Check order inside authorize: token and lock (:91-119), idempotency replay (:160-176), entity dedup (:182-199), tenant (:203), status (:213), expiry with 60 s grace (:223), entitlement (:233), velocity (:248-253), currency (:257), per-transaction cap (:272), anomaly (:286), subtree cap (:302-320), category allocation or flat funds check (:335-341). `trust_mode=SHADOW` runs every check and always returns AUTHORIZED plus `wouldHaveBeen` (:147-150, 343-354): a ready-made dry run. Default is fail closed when the server is down; fail open is opt-in and yields `fallback_` ids with no ledger row (FAILURE_BEHAVIOR.md:7-9, 70-75).

## 4. How people use it
`pip install figuard` runs embedded, no server (README.md:71-101). Tests: 57 Java files, 380 `@Test`/`@ParameterizedTest` (grep count), Python SDK tests, `lite/conformance` scenarios, `bench/stress.py` (not run). The "620 passing" badge is a static image (README.md:8): NOT VERIFIED.

## 5. Mechanism for the Desk
Reserve-before-call, exact: the budget row carries `quantitySpent` (confirmed only) and `quantityReserved` (authorized, unconfirmed) (AgentBudget.java:78-82); `available = totalLimit - spent - reserved` (:187-189). authorize takes a `PESSIMISTIC_WRITE` row lock on the budget by token hash (AgentBudgetRepository.java:24-33), then adds to reserved and saves (AuthorizationService.java:593-612). confirm moves reserved to spent by the actual amount (PaymentLifecycleService.java:80-85); fail/void release the reservation (:147-154, 244-249). Unique `(budget, idempotency_key)` makes retries safe (README claim, BENCHMARKS.md:36-48; the key is checked at :160-176). The embedded engine does the same with `BEGIN IMMEDIATE` and an RLock (engine.py:62-70, 197) and `Decimal` money, never float (lite/README.md:22).
Stale reservations: `authorizationExpirySeconds` hides old AUTHORIZED rows from the capacity sum without a sweep (:364-371); a confirmation timeout of 300 s auto-voids (:573, ConfirmationTimeoutSweepService).
Loop and idle rules: velocity counts ALL attempts, denials included, per minute and per day, and sums requested amount per hour (:855-885; engine.py:278-301). A first violation writes one event and later ones in the window return it silently (:922-928), so a spinning agent cannot flood the ledger. Anomaly: deny when one request exceeds `mean x 3.0` of confirmed spend after 5 samples, then auto-pause (:713-724, 756-761): size-only, not rate or repetition. There is no idle detection.
What they lose or get wrong (all read in code):
- confirm accepts any amount `>= 0`, not capped at the reservation (ConfirmEventRequest.java:12-14), so real spend can pass the limit and is only caught by the 5-minute integrity check (LedgerIntegrityService.java:61-62, 83-89).
- A confirm after the 300 s timeout is rejected `AUTHORIZATION_EXPIRED` (PaymentLifecycleService.java:68-71): a slow call that really spent money cannot be recorded this way. `RecordExternalEvent` (V24) exists for after-the-fact spend.
- README says every transition is a separate row (README.md:149) but confirm overwrites the same event row's `decision` (PaymentLifecycleService.java:107-110): history of transitions is lost.
- Counterfactual replay (ReplayService.java:189-264) reports the same `totalSpent` for the "actual" and hypothetical summaries (:254, 259) and hard-codes `deniedCount(0)` for actual (:253); `manifestVersion` is accepted but not resolved (:213-214).
- The CrewAI guard sets a fresh `uuid4` idempotency key on every call (crewai.py:144), so a retry is not deduplicated, contrary to README.md:163; `_resolve_amount` returns 0.0 if the key is missing or the extractor throws (crewai.py:186-195), and the server accepts zero (`@PositiveOrZero`, AuthorizeSpendRequest.java:25-26): a wrong `amount_key` means the budget is never touched; confirm sends the requested amount, not the measured one (:168).
We do better by: capping confirm at reserve (or flagging overage as a typed event), tying each reservation to an outcome record, hash-chaining the ledger so it is verifiable offline, and reserving an upper bound for LLM calls (neither SDK supplies a token estimate).

## 6. Agent patterns
Causal chain via `parentEventId` and `chainRootEventId` with an optional per-chain cap (:302-320); delegation tokens give sub-agents category caps; denials are structured codes an LLM can act on (README.md:113-115).

## 7. Model and data layer
No model awareness: the caller declares quantity and category (docs/known-limitations.md:5-9, 29-31).

## 8. Hackathon-care checks
Embedded mode is offline with zero infra; the server needs Docker and Postgres. Benchmarks are local-dev numbers: p50 17 ms uncontended, 508 ms with 100 agents on one row (BENCHMARKS.md:64-85); one lock per budget is the stated ceiling (known-limitations.md:61-67).

## 9. Traps seen
Static test badge; "append-only" with an in-place status; inconsistent replay summary; a guard that defaults to a zero-amount approval; honest-agents-only threat model (README.md:192).

## 10. Reuse
Apache-2.0 text: copy with credit. Best parts: the two-field reserve/spent model, idempotency replay with transient-denial bypass (:810-824), SHADOW mode, the integrity invariants (spent equals sum of confirmed, reserved equals sum of authorized, spent+reserved <= limit).

## 11. Verdict: ADOPT the reserve/confirm/void model, ADAPT the rest
Copy: (1) `reserved`/`spent` split with idempotent authorize and a sweep that voids stale reservations; (2) SHADOW mode and counterfactual replay as the "what if this cap" preview; (3) the three integrity invariants run on a schedule.
Avoid: (1) confirm without an upper bound; (2) a status column updated in place called a ledger; (3) integration defaults that turn a lookup failure into a zero-amount approval.
Missing: outcome tie-in and any forecast.
