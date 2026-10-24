# The weekly review and the owner questions (2026-10-25)

Two features that turn the ledger into something a person acts on weekly: `desk review` (and the Week screen) and `desk questions`.

## The weekly review

`desk review [--week 2026-W43] [--markdown]` and the Week screen give one ISO week, Monday to Sunday UTC, defaulting to the last complete week (on a Sunday the week still running is not complete). It holds:

- the week's spend, calls and days with data, against the week before;
- what it bought, with the unlinked dollars and the dollars resting on a weak link kept apart and labelled "unknown, not waste";
- the spend by workflow (the type of each task: the branch's first part, a ticket's project key, the text before a colon in a label), how much of each landed and how much is not tied to a commit;
- spend, landed spend and the cost of each landed task for the last four weeks;
- how the pre-run estimate's range did over every task (the scorecard of `desk estimate`);
- the number of open owner questions and the costliest;
- what drifted against the week before: a model that is new, a model whose share of the spend moved by 15 points or more (including one that fell to nothing), a tool version first seen, a model with no price;
- how approvals were made, when the gate is named (not yet populated: see DF-049);
- at most three suggested changes, each taken from the autopsy's fixes, each with the dollars it cost this week, the part a change could avoid, the interval from the owner's own past windows where there are enough of them, and whether the figure is measured or an upper bound.

With fewer than seven days of data it says so and shows what it has. A week with no call says that. A bad week (`2021-W53`, `2026-43`) is refused before anything else is said.

The review reads a ledger it cannot write to: tasks are worked out from the sessions and the owner's labels when the page is built, so it does not depend on the task table being fresh. `desk estimate` and the MCP tool now work the same way, and the MCP tool no longer writes to the ledger.

## The owner questions

Where the Desk links a commit to a session by weak evidence (the commit was made near when the session ran, or the files overlap too little, or two sessions are equally good), it asks, the costliest session first. `desk questions` lists them, `desk questions answer <id> yes|no` records an answer, `desk questions ask` goes through them on a terminal (y, n, s to skip, q to stop). A yes becomes an explicit, high-confidence link, even where the guess had missed it; a no removes the link; a skipped question stays open. The answers are kept by repository folder and applied every time landing is recomputed, so they survive a rescan. What a commit became (committed, merged, kept, reverted) still comes from git alone, so no answer can make work look more landed than its commit is. The Outcomes screen shows the open questions and the command that answers one; it never answers, because the screens are read-only by design.

## What was run

- 14 tests of the weeks (the ISO boundaries 2026-W01, 2020-W53, a Sunday in the old year), the review against a constructed ledger (every total, the landed and unlinked split, the workflows, the four-week trend, the drift cases, the part-week note, the empty week, the cap of three suggestions, the text and markdown renderings) and the command line.
- 9 tests of the questions against a real git repository: two sessions that wrote the same file and cannot be told apart become two questions, the costliest first; a yes and a no change the links only when landing is recomputed, the state follows git, the answers survive another recomputation, a mind can be changed, an id can be a unique prefix, and the terminal loop records y and n and leaves a skipped one open.
- On this machine the review ran for 2026-W42 in five seconds: $2,444.16 on 31,655 calls; $495.23 landed; a model-share shift from Opus 5.5 (82%) to Sonnet 5.5 (86%); a tool version first seen; one suggestion (cap sub-agents) with its interval from 27 of the owner's own past windows. It also found **49 open owner questions**, the costliest session $786.18: a real queue for a real person to answer.
- The Week screen was photographed in light at desktop width (the whole page) and in dark at phone width, and the console was read.

**Defects found by looking.** The first Week screen raised eight Content-Security-Policy errors because the week picker set an inline style, and its links ran together without spacing; both are now a stylesheet class. With thirteen screens the navigation no longer fit in the header row at desktop width and the last screen was cut off behind a hidden scroll bar; the navigation now has its own row under the logo, and wraps on a phone. A canary file with dates still to come is a scenario, not daily runs (see alerts).

**A defect found by testing `forget`.** The task, repricing and answer tables added this week are referenced from sessions and calls, so `desk forget` failed with a foreign-key error on any ledger that had them; it now removes them with their sessions, drops tasks and repricings left with nothing to describe, and a whole forget also removes invoices, reconciliations and alert history and the Desk's own files beside the ledger (the status line readings, the task labels, the gauge cache). The test that found it fails without the fix.

## Not covered

The approvals block is empty until the approval metrics exist. The calibration line says rule thresholds are not calibrated on the owner's history, which is true until DF-034 is built. A suggestion's measured effect is what the autopsy can read from the logs (idle, loops, cache misses) or an upper bound (the other causes); none has been tested by acting on it and watching the next week. A real person has not answered a real question, so whether the wording of a question is clear enough is not known. The Week screen was not photographed in dark at desktop width or in light on a phone.
