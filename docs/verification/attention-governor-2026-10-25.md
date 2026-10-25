# The supervision attention-load governor (2026-10-25)

Feature DF-088. An owner can only watch so many agents and answer so many questions an hour before they stop reading what they approve. The governor is in the gate, which sees every agent's first call, and it refuses a new agent when its person is already supervising the most they can.

## What it does

- **Active agents:** the person's other sessions with a gate event in the last ten minutes. **Interruptions:** approval requests the gate has made of the person in the last hour. **Load:** the larger of (active + the one that would start) / the most agents allowed and interruptions / the most questions an hour allowed.
- A new agent is refused with `attention_budget_exceeded` when the person already has the most agents allowed (default four) or has already been asked the most questions an hour allows (default ten). At 80% the decision carries a warning in the trace and goes through. An agent already working is never cut off: only a session the gate has not seen in the last ten minutes is a launch. A refusal for this reason does not make the refused session count as working.
- The emergency bypass the owner opens with their key allows it, and is recorded as every bypass is. The limits are `--max-agents` and `--max-questions` on `desk gate serve`; `--no-attention` turns it off. A gate built as a library has it off unless given limits; the daemon turns it on with the specification's defaults. `desk gate status --person NAME` reports the load.
- **Review time:** the wait from each approval request to its approval, priced at the owner's rate ($120 an hour unless `DESK_REVIEW_USD_PER_HOUR` says otherwise), is its own section on the Bill screen, "Your review time", labelled as reported by the gate. It is never added to what the models cost. A question with no answer yet is counted apart and costs nothing until it is answered.

## What ran

- `tests/desk/gate/attention.test.ts` (12): the governor off by default; the fifth agent refused with the reason, and the four working ones going on; an agent let through once the others have been quiet for eleven minutes and not at nine, and a refused session not counting as working; each person's agents counted on their own; the emergency bypass; custom limits; ten questions in an hour refusing a new agent with no agent working elsewhere, nine not, and an hour later again; the 80% warning; a launch told from an agent already seen; review time priced from request to approval with an unanswered question counted apart.
- `tests/desk/gate/attention-cli.test.ts` (3): the daemon's defaults and the status line, the limits from the flags and the refusal of a limit that is not a whole number of at least one, and `--no-attention`.
- `tests/desk/ui/review-time-ui.test.ts` (3): the Bill's review time through the real server and client: $120 an hour and the owner's own rate, a rate that is not a positive number ignored, no gate database giving nothing, and the model spend unchanged by it.
- **A real daemon, over HTTP:** `desk gate serve` on a scratch database, six sessions for one person: the first four allowed, the fifth and the sixth refused with `prateek already has 4 agents working (the most allowed is 4); a 5th is more than one person can supervise`, and the first session's next call allowed.
- The gate and gateway suites (184 tests) pass with the governor in the code.

## Not covered

- Concurrent agents are counted as **sessions with a gate event in ten minutes**, not as running processes. A session that is waiting on a long tool call for more than ten minutes stops counting, and a long-running quiet agent can be joined by a fifth. Sub-agents share their parent's session and are not counted separately, which is the unit a person supervises.
- The review time is the wait, not the time spent reading: a request left for an hour counts as an hour. A denied request has no event, so it is counted as unanswered.
- The specification's `attention_snapshots` table is not written: the load is computed from the gate's own events when it is asked for, so there is no second record that could drift from them.
- The governor does not stop the person from starting an agent outside the gate (an agent whose hook is not installed never asks). It is as strong as the gate's reach, which the enforcement ladder already states.
- Not tested with several processes starting agents at the same moment; the count and the refusal happen in one gate transaction, which serialises them, but a race was not run.
