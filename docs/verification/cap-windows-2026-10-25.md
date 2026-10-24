# Caps by session, by recent minutes, by model and by project (2026-10-25)

Feature DF-045 built. Before, a cap could only be the person's day or the person's month.

## What a cap can now say

`window` is one of `day`, `month` (calendar UTC, as before), `session` (one session), `10m` and `1h` (sliding back from now). `per` says whose spend counts: the person's whole (the default, and what every existing policy means), or only the spend on the request's own `model` or `project`, which have a day and a month window. A cap that picks a window picks one of ten named numbers the language already talked about (`session_spend_after_usd`, `spend_10m_after_usd`, `spend_1h_after_usd`, `model_day_spend_after_usd`, and so on), so a condition can ask about them too, and the language stays closed: the check that an edit only narrows still decides on a finite grid. It was tested for the new windows: lowering a velocity cap narrows, raising it is reported as a widening with the first spend that was newly let through, adding a cap narrows and removing one widens.

Every matching cap applies, and the tightest binds: a request is refused when any of them would be passed, and the refusal names the cap and its window (`cap velocity: deny (last 10 minutes)`). The reasons for the person's day and month read as they always did. The decision and the budget-left answer list each of these caps with what its window would hold and what is left, the tightest first (`scoped`).

## How it stays true

The windows are not stored as counters. Each is summed from the gate's own events when the request comes: spent (settled, overage, observed) in the window, plus every reservation still open whatever its age, plus the request's own reserve. So a window is the same after a restart, cannot drift from the record, gives a voided reservation back, and counts only the person's own spend. Only the windows some rule reads are computed, so a policy that has none of them does no extra work and its decisions are unchanged (no `scoped` field appears).

Shipped: `policies/velocity-and-session.yaml`, a day cap, a $25-in-ten-minutes cap, a $60-a-session cap and a $90-a-day cap for each opus model.

## What ran

`tests/desk/gate/windows.test.ts` (21): a burst refused and allowed again as the spend slides out of the window, ask and deny lines at the cap, an open reservation counted and a voided one given back, a restart on the same database, the person's own spend only, a session cap that does not lapse with time and does not touch another session, a per-model cap that ignores other models and starts again the next day, a per-project month cap, the tightest of several caps, parsing and writing the new windows and the refusals (unknown window, unknown scope, a session cap per model, a velocity cap per project), the narrowing check, and the shipped example policy stopping a burst, a session and a model. All 129 earlier gate and policy tests pass unchanged. Full suite: 106 files, 1,382 tests. The Policy screen shows the window of each cap.

## Not covered

- The windows were run against a real gate only in tests with a controllable clock; the gate was not run for days against live traffic.
- A cap per model counts the model the request asked for. When a route rule sends the request to another model, the cap of the model asked for still counts it.
- `per: agent` and `per: person` over a window other than day and month are not offered; the spec names session, model and velocity.
- The sliding windows count spend by the time it was settled or observed, not by the time the call began; a long call settled late is counted when it is settled.
- Notifications at 85% and 100% are the alert rules' business, not this one's.
