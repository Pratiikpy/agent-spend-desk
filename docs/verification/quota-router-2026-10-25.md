# The quota-aware plan router (DF-091), 2026-10-25

`desk quota` answers one question for a person who has more than one place to do work: the plan the next task would run on is close to a limit, so where should it go?

## What it does

It reads each plan's tightest window as the tool reports it (the five-hour and weekly windows of Claude Code and Codex, the same readings `desk plans` and the brief use), and treats a plan as pressed when 5% or less of that window is left, or when at the pace of the last hour it would fill within 15 minutes, or when the tokens left are under the 20,000 kept back for a handoff (the last only when the plan's own history gives a token rate for a percent). A plan that is not pressed gets "stay". A pressed plan gets one of three answers, each with its reasons: move to the plan with the most room (a fixed-price plan before one paid by the token); wait for the reset, when no other plan has room and the reset is within a day; or refuse with `quota_runway_depleted`, when neither is possible. In all three it says to write a handoff first, writes the handoff file, and holds the 20,000 tokens on the plan being left until `desk quota release <id>`. Every decision is logged (`route_dispatch`, schema 29): nothing is dropped without a record.

Commands: `desk quota` (every plan's room, and the answer for each pressed one), `desk quota next --from <plan> [--task <type>] [--dry-run]`, `desk quota history`, `desk quota release <id>`, `desk quota plans`. The morning brief shows the same answer under "Where the next task should go" when a plan is pressed, and nothing otherwise.

## What it will not do

- It never moves work between two accounts of one vendor to get past a limit. A limit belongs to an account; a second account of the same vendor is a way round it. A candidate at the same vendor under another account is listed as "not an option", with the reason. Moving from a subscription to the same account's own API key is allowed, is said to cost money, and ranks after any fixed-price plan.
- It never makes up a reading. A plan whose tool reports no window is not a candidate, and if the plan the work is on reports nothing the answer is "stay" with the reason `no_reading`. A reading older than the tool's staleness mark is not acted on.
- It does not start work in another tool. It recommends, writes the handoff and logs; a person or an agent moves the work.

## What was run

`tests/desk/quota-router.test.ts` (35): the tightest window is the one read; each threshold at its edge (5%, 14 and 15 minutes, the token reserve); the vendor rule (another account refused, the same account's key allowed, a fixed-price plan preferred); a pressed, stale or silent candidate is refused with its reason; waiting and refusing; an unknown plan; a policy the owner changes; the same input giving the same output; the reserve held for a move and not for staying, and released once; a plans file that adds to and replaces the inferred plans, and says which field is wrong; and the whole path from a ledger with readings (status, the handoff file, the held reserve, the history, a dry run that writes nothing). The test that moves the 97%-used Claude Code plan's next task to the 30%-used Codex plan is the one the specification names. The vendor rule's tests fail when the rule is switched off. `tests/desk/ui/quota-ui.test.ts` (4): the brief names the plan, the target and the handoff, shows nothing when no plan is pressed, and draws the card.

## Not covered

- The gateway does not switch upstream when a plan is full: a call through it is metered and capped, not re-sent to another vendor.
- The 20,000-token reserve is a record of what is held back, not a quota enforced against a vendor: no tool exposes a way to reserve tokens in its own plan.
- Plans are the owner's own statement (the tools with sessions in the ledger, plus an optional file). The router does not look for accounts, and it cannot know that two plans in the file belong to the same person unless the file says so.
- Real use over days: the readings and the rules were run on constructed ledgers and on a ledger's readings, not on a plan hitting its limit while a task ran.
