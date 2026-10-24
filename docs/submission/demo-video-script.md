# Demo video script: desk. (3:39 of 4:00)

A captioned motion-graphic video with no voice. Every figure on screen is read out of a real run (`desk demo`, `desk bench report --sample --set B`) or a committed result file (`docs/verification/`) by `scripts/demo-video-motion/gen-data.mjs`; the script stops if a figure cannot be found, and the render stops if the film would run outside one to four minutes. Where the video shows a product screen it is a capture of the real UI. Scene lengths follow the caption reading time (about 2.7 words a second plus a second), so every caption can be read.

The look is the Blank brand kit: ink on white, one green accent, rust red only for what failed or was blocked, Outfit and JetBrains Mono, a black redaction bar as the one motif.

Every scene opens on the constructed scenario's own label: "A constructed scenario. Every figure on screen comes from it, through the same code that reads your own logs." Cursor appears only as "the required IDE", and the closing caption says the video claims nothing beyond what its session log records; `docs/sponsors/cursor-usage-log.md` is empty until real Cursor sessions are logged.

| Scene | Starts | On screen | Burned-in captions |
|---|---|---|---|
| The problem | 0:00 | "5 hours in, the limit appears." The word *limit* is revealed from under a black bar; $102.76, 1,082 calls and $20.55 an hour count up. | "5 hours in, the limit appears and I do not know why." "It is a constructed scenario. Every figure on screen comes from it..." |
| The product | 0:15 | "desk." and four verbs: explains the limit, checks the agent every day, tests a spend policy on a month it never saw, signs what it concludes. The four sponsors slide in. | "desk. is a local desk for whoever pays for AI coding agents." "Organisational data through Zetaris. Memory and history from Meterless engines. Every language role on NVIDIA Nemotron." |
| 1 of 8. Where did my limit go | 0:28 | The stacked bar grows to the split by cause (sub-agents 59%), the ranked fixes with intervals, and what it could not know. | "It splits the heaviest window by cause. Sub-agents are 59% of it." "It ranks the fixes worth making, each with an interval." "And it says what it could not know. Unlinked work is unknowable, not waste." |
| 2 of 8. The bill, through Zetaris | 0:45 | Three silo cards (files, Postgres, REST) draw into one Zetaris statement and a per-team table; two tiles: invoices 1.2% under the list-price estimate, 60 of 644 landed sessions merged on red checks. | "The bill is not in the logs..." "One Zetaris statement joins the three. Invoices land 1.2% under my list-price estimate." "And 60 landed sessions merged although the checks were red." |
| 3 of 8. The canary | 1:05 | The real Canary screen, then −40.0 points with its 99% interval, the flat control arm (−2.2), and the primary pass rate 92% → 51% → 52%. | "The canary runs a 52-task pack once a day on each arm. Here the primary arm's model was switched on day 15." "The call comes with its interval, a flat control arm, and what it cannot say." |
| 4 of 8. Propose, check, attack, replay | 1:21 | Drafter, restrict check over 36 cells, Attacker (4 closed, 2 unresolved), replay on a held-out month; then "5 of 333 landed sessions would have been blocked", with $136.72 and 10 paused beneath it as an upper bound. | "Nemotron drafts a cap policy. Code checks that it only narrows the one in force." "An Attacker looks for requests that step around it. Then it meets a month it never saw." "5 of 333 landed sessions would have been blocked. That is the headline, not the savings." |
| 5 of 8. Ask, engines on and off | 1:43 | A question types in; Risk Router, Planner, Specialists, Auditor (15 accepted, 0 rejected); the answer; the World Model switched off and the answer becomes "Unknowable". | "I ask a question. The Planner writes a typed program, code runs it read-only, the Auditor checks every figure." "Switch the History engine off and ask again: the answer changes. That is the proof it does something." |
| 6 of 8. Same model, three ways | 2:03 | Bars for one call 12, tool agent 41, the Desk 49 of 60; a dashed 54 added beside it, labelled post hoc; pass^3 17%, 63%, 77%; the note that the margin is at the edge of what 60 questions can show. | "60 questions it never saw, pre-registered..." "The Desk answered 49 exactly. The tool agent, 41. One call, 12." "A fix found by reading the misses lifts the Desk to 54. It is shown as post hoc, beside the first figure." |
| Self-measurement | 2:27 | 73% of 48 constructed months inside the printed 90% range (77% with none planted); +2 held-out questions from learning, the interval touching zero. | "The Desk also scores itself. Its 90% one-month range held the real month 73% of the time." "That is printed beside the range. So is what learning from mistakes moved: 2 questions of 60, no improvement claimed." |
| 7 of 8. Verify offline, then the gate | 2:43 | The offline verifier ticks V0 to VA to RESULT: PASS; one byte changed, V2 FAIL naming `replay_heldout#252`; the gate's `hook exit code 2`. | "To apply the policy I echo the action digest..." "A stranger verifies it on plain Node with the network off. Change one byte and it names the row." "The same hook Claude Code calls blocked a real Bash call under a policy that permits nothing." |
| Where each sponsor sits | 3:08 | A five-step flow (agent logs, Zetaris, ledger and Meterless engines, Nemotron agents, gate and signed dossier) and four cards: Zetaris, Meterless (conformance 8/8, 8/8, 13/13), Nemotron, Cursor. | "Where each sponsor sits. Zetaris is the data layer: three silos, one statement." "Meterless holds memory and history. Each of its engines changes an answer when it is switched off." "Nemotron runs every language role. Cursor is the required IDE, and the video claims only what its log records." |
| Close | 3:30 | "Run it on your own logs." `npm run desk`, the repository address. | "Everything here is in the repository: the code, the recordings, the pre-registration, and what failed." |

## Making it again

```
npm i --prefix scripts/demo-video-motion
node scripts/demo-video-motion/gen-data.mjs          # reads the figures from real runs and result files
cd scripts/demo-video-motion
node stills.mjs <dir> <frame> ...                    # look at chosen frames first
npx remotion render src/index.ts Demo <out.mp4> --concurrency=1 --port=3417
```

It needs Google Chrome (pass `--browser-executable` if it is not found) and about 1 GB of free memory for one render worker. Upload the result so that it plays from a logged-out browser, and check by opening the link in a private window. The older screen-recording version (`scripts/demo-video/record.mjs`) is kept; its title card says "Built in Cursor and Claude Code", which the repository does not support, so it must not be uploaded.

## What the video does not show

A live vendor pause on a tool that has no hook; a dollar figure claimed as an invoice; a "better model" claim without an interval; a regression presented as natural; a canary verdict reached in minutes (the statistic needs 28 days); the Desk presented as clearly better than a tool-using agent (the pre-registered margin is 8 of 60, at the edge of what that sample shows); any Cursor session, since none is logged.
