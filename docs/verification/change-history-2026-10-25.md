# The change history: what changed before a date (2026-10-25)

Feature DF-117. `desk changes [--before DATE] [--days N]`, `desk changes audit`, and the canary verdict's account of what changed before it. `--ablate world_model` leaves the history out.

## What it does

- **The history, in the Meterless World Model.** It is an event-sourced record built from sources the Desk already keeps, each with the date it carries: the ledger's own calls (a model first seen, last used, or whose share of calls moved; a tool version first seen; a plan setting), and, beside the ledger, the model id the canary's endpoint reported for each arm, the policy versions the gate has run, the price lists the ledger was priced with, what the owner edited in the memory, what a kind of work was promoted, demoted or blocked to, and the policy changes the owner approved. Sessions are drawn into it as entities with relationships to the agent that ran them, the task they belong to, the models they ran on and the tool version, so "what began on the thing that changed" is a walk along relationships: each change that has something to relate says how many sessions began on it in the window.
- **What stayed as it was, and what was not looked at.** A source that was read and shows no change in the window is listed as unchanged; a source that could not be read (no gate database here, no canary run, the memory not opened) is listed as not looked at, and nothing is said about it. "Nothing changed" is never said of something that was not seen.
- **The canary.** The verdict's "consistent with, not caused by" line, which named only a change of the served model id, now lists every change from the last baseline day to the verdict's day, with the sessions each touched, what was looked at and unchanged, and what was not looked at. With the World Model off it says "unknowable: no entity history is available" and has no "consistent with" line, since nothing was looked at to be consistent with.
- **The audit trail.** `desk changes audit` prints the engine's own record of every entity, fact and relationship written, with who wrote it.

## What ran

- `tests/desk/changes.test.ts` (12): each source read with its date, and a missing source listed as not read; sessions drawn with the models and tool version they ran on (40 sessions, 160 relationships), and counted by relationship after a change (12 sessions on the model that appeared, 16 on the tool version); no graph, and no count, for a history built without the beside-the-ledger sources; a change outside the window left out, a source that did not change called unchanged, a source that changed or was not read not; the listing's text; a date before and after the ledger; a bad date and window; the audit trail; each kind of change in words with its figures; the canary's account, the unknowable case without a "consistent with" line, the single served-model line kept for a caller that gives no history; nothing consistent with a drop when nothing changed; and the real command line with and without `--ablate world_model`.
- On the constructed sample, the canary's regression on 29 Oct now lists the model-share shifts, the change of the served model id on the 14th, the new tool version, the sessions each touched, and what was looked at and unchanged.

## Not covered

- **The engine's name-matching merge queue is not used.** It merges or queues entities whose names are similar by edit distance, and `claude-opus-4` and `claude-opus-5` are 92% similar, so it would join two different models and hide the change this exists to show. Entities are keyed by what the ledger calls them.
- People are not drawn: nothing in the ledger says who a session was for beyond a branch prefix.
- Only the newest 5,000 sessions are drawn with their relationships; the model and tool-version histories cover all of them.
- Ask still answers "what changed before" from the ledger's own history, so that an answer can be checked again later from the ledger alone; the beside-the-ledger sources change as the owner edits things, and an answer built on them could not be reproduced.
- The sources are read when asked. Nothing is recorded as it happens, so a policy file edited and edited back between two runs leaves no trace, and the gate's policy versions are only those the gate saw.
- A change is consistent with a drop when it falls in the span; the Desk does not say which one, if any, caused it.
