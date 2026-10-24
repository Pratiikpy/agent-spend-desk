# Approvals and the morning brief (2026-10-25)

Two features that decide whether the owner is looking at the right thing each morning, and whether they looked before they approved.

## Approval habit (`desk approvals`)

`desk approvals` lists what is waiting, with the time left and whether the evidence was opened; `desk approvals show <id>` prints the approval card (typed fields only: rules added, the replay on the held-out period, the restrict check, dollars and tasks affected, the audited sentences, the unresolved evasions and the action digest) and **is what the Desk counts as opening the evidence**; `desk approvals deny <id>` denies without an echo and is always honoured; `desk approvals habit` is the record.

The record (also on the Week screen and in `desk review`) says, for decisions in the period: how many were approved and denied, and why each denial happened (the approver said no, the request expired, the policy changed, the log moved on); the median seconds from the card being shown to the decision; the share approved within ten seconds of being shown ("faster than it can be read"); the share approved with no record of the evidence being opened first (evidence opened after the decision does not count); requests that ran out of time unanswered and requests still waiting; and responses that were refused (a digest that did not match is exactly what the echo exists to catch). It makes no claim that a card improves anyone's accuracy.

`desk approve` now says, after an approval, when the evidence was not opened first.

**A broken promise found and fixed.** The proposal text said the attacker's unresolved evasions were "shown on the approval card", and the card did not carry them. The card now lists each as typed fields (the action, the waste rule, the recoverable dollars, the dimension it steps around, the verdict the proposed policy gives it) and none of the attacker's own words; an evasion the proposed policy would in fact deny is left out; a card issued before this change says nothing rather than "none". The Dossiers screen says how many are unresolved for each waiting request.

Run on this machine: the one approval in the real record, made on 22 October, was decided 2 seconds after the card was shown with no evidence opened. The record says so.

## The morning brief

- **Yesterday means the calendar day that just ended where the owner is.** The machine's zone is used (UTC in the sample), a day is a half-open window, and a day of 23 or 25 hours across a clock change is handled; zones with half-hour offsets (Kolkata, Lord Howe) and +14 (Kiritimati) are tested. A day with no call says so, and the last day that has one is briefed instead; a day that is still running says it is not finished. `?day=` or the Earlier and Later buttons step through days with calls.
- **Overnight.** What the gate denied, paused and asked for (and whether an approval was answered), read from the gate's own event table since the start of the briefed day. When there is no gate database it says the gate is not running here, which is not the same as a quiet night.
- **Canary card.** The verdict as of the briefed day (not as of today), whether it changed since the run before, the date a call becomes possible while the canary is too young, and "not running" after three days with no run.
- **One recommended action, by rule.** A canary that regressed (or whose platform moved) since the run before comes first. Otherwise the cause with the most recoverable dollars, but only when it is measured on the owner's own windows and is at least $1.00 a window; an upper bound with too little history behind it is not recommended and the reason is said ("never a filler action").
- **Stale sources.** Each reader's last run, and a banner when one is more than 36 hours old.
- **Every figure opens the rows behind it.** The spend, the landed share, each landing state, each project and each model open the Sessions screen narrowed to the same window and the same project, model or state, with a line that says what the rows add up to.

## What was run

- `tests/desk/ui/brief.test.ts` (14), `tests/desk/localday.test.ts` (6), `tests/desk/approvals.test.ts` (9), plus the card tests. The recompute test takes every figure the brief states (total spend, each landing state, landed, each project, each model with its call count) and reproduces it from the sessions that figure's link opens, to the micro-dollar; a malformed narrowing (`from` without `to`, a bad state, a 300-character project) is refused with a 400.
- The sample canary's real transitions drive the card tests (the brief for 2026-10-05 is "too early to call", for 2026-10-29 "regressed", and the day it changed is the day the card says changed).
- The brief was photographed in light at desktop width (whole page), the spend figure was clicked, its popover offered the rows, and the link opened the Sessions list narrowed to the day with "These 22 sessions add up to $132.50"; dark at phone width was photographed. Console clean.

## Defect found by testing, not yet fixed (tracked under DF-007)

The canary's harness name is a hash of the checkers' **source text** (`check.toString()`), which differs between compilers: the sample canary recorded under `tsx` reads "the platform or the harness moved" under the test compiler. In use the Desk always runs through `tsx`, so the name is stable until `tsx` or Node changes its output, and then every stored baseline would be reported as a changed harness. The tests re-label the sample rows to work around it; the fix (a declared version per checker with a test that fails when the source changes without it) is part of DF-007.

## Not covered

- The overnight section was exercised against a constructed gate database, not against a gate that has been serving a real agent for a night. No gate database exists on this machine.
- The cause shares link to the day's sessions, not to the individual calls of each cause: a session holds calls of several causes, so the rows do not add up to a cause's figure the way they do for the others.
- The figures are recomputed from rows through the Sessions screen; they are not stated in a signed dossier and recomputed by the offline verifier (the month bill is: see `month-close-2026-10-25.md`).
- Approvals the gate asks for per call (`gate approve`) are not in the habit record; only dossier approvals are.
- The Sessions screen still shows the Range selector when a link narrowed it to a window; the selector then has no effect.
- A real person has not used the brief. Whether "one change" is the right amount is not known.
