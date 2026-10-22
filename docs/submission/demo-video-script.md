# Demo video script: desk. (3:50 of 4:00)

One continuous thread, recorded from a real run of `npm run desk -- demo` and the screens (`npm run desk -- ui --sample`), then trimmed, never edited for content. Every figure read aloud is the figure on screen; if a run differs from this script, the script changes, not the number. The narrator is one person throughout: an engineering lead who first feels the limit on their own seat and then makes the team decision.

Caption shown for the first ten seconds and again in the deck: **"Constructed scenario. Built for the Open Agent Hackathon. Organisational data through Zetaris. History, memory and long-range engines from Meterless. Language roles on NVIDIA Nemotron. Required IDE: Cursor (session log in the repository)."** The Cursor clause stays only if `docs/sponsors/cursor-usage-log.md` has rows.

| Time | On screen | Narration (read at a normal pace) | Proof on screen |
|---|---|---|---|
| 0:00 to 0:15 | `npm run desk -- --sample`: the card appears. | "I pay for coding agents. Two hours in, the limit appears and I do not know why. This is where one window went: sub-agents, cache misses, loops, and what I could not know." | The eight causes sum to the window; the *What I could not know* block |
| 0:15 to 0:40 | `desk silos`: the joined statement; then the trace lines. | "The bill is not in my logs. Invoices sit in a bucket, CI in Postgres, the roster behind a service. One Zetaris statement joins them: spend per landed pull request by team. Invoices are 1.2 percent under my list-price estimate, and 60 landed sessions merged on red checks." | `desk.ingest {port:"silo", servedFrom:"cassette"}` x4 (recorded from a live run); on-screen caption "Zetaris stopped: nothing billed, no table" with the real drill output |
| 0:40 to 1:00 | `desk canary` (or the Canary screen): the line chart, the verdict. | The canary narration is written after the final run; see the line below this table. | `Constructed: the model behind the primary arm was switched on purpose on day 15.` caption; "consistent with, not caused by" line |
| 1:00 to 1:40 | `desk propose --dossier`: findings, Nemotron's draft, restrict check, attacker, then the held-out line. | "Nemotron drafts rules from September. Code checks they only narrow the policy, over every cell. The Attacker finds requests that step around them. Then the policy meets October, a month it never saw: ten sessions paused, one hundred thirty-seven dollars not spent, and five of three hundred thirty-three landed sessions blocked. I put that first. It is the number that decides." | `served_model private/nvidia/nemotron-3.5-super-120b-a12b`; "narrows only, over all 36 cells"; the in-sample figure shown smaller beneath, labelled |
| 1:40 to 2:15 | The Ask screen; then `npm run desk -- prove auditor`. | "I ask a question. The Planner proposes a typed program, code runs it read-only, and the Auditor checks every figure in the answer. When I force a draft with a number nothing supports, it is rejected, the Explainer revises, and the answer shows no unsupported figure." | `audit attempt 1: 0 accepted, 1 rejected (number_mismatch)` then `revision applied` then `accepted` |
| 2:15 to 2:40 | `desk ask "What changed before 2026-10-15?"`, then the same with `--ablate world_model`. | "What changed before the 15th? The History engine, Meterless's World Model, answers: tool version vsample-2 first appeared on the 14th, and the model mix moved. Switch it off and the same question is unknowable. That difference is the proof it does something." | `desk.engine {engine:"world_model", conformance:"8/8", ablated:true}` |
| 2:40 to 3:05 | `desk approve <id> <digest>`: PASS; then the tampered copy. | "To apply it I echo the action digest. A signed dossier is written, and anyone can verify it on plain Node with the network off: untouched, PASS; change one byte of one row and it names the row." | `V6-D PASS recompute cited computations`; `row_hash_mismatch: replay_heldout#2`; PASS prints what it does not mean |
| 3:05 to 3:25 | The gate beat: the hook blocking, then a still of `docs/verification/gate-enforcement.md`. | "The same hook Claude Code calls blocked a real Bash call under a policy that permits nothing, and let it run under one that does. If the gate is down, it blocks." | `Desk gate: no permit matches (default deny).` and `exit 2` |
| 3:25 to 3:50 | `npm run desk`: the card; the closing screen. | "Run it on your own logs: npm run desk. Under three minutes, entirely local. Your autopsy, your ranked fixes, and what it could not know. A new regression cannot be called before day 28, and I say so." | The command, the *What I could not know* block |

**Canary narration (0:40 to 1:00).** Read the verdict card exactly: the word (Regressed, Steady or No call), the change in points with its 99% interval, the smallest change one window could see, and whether the control arm was flat. Say "constructed" and "real model runs" in the same sentence. Do not say the switch caused anything.

## Rules for the recording

1. Record the commands live, in order, in a clean terminal at 1920 by 1080 with the Blank brand kit's colours (ink on white, one green for PASS only). Zoom into the line that proves each beat; never cut away from a failure.
2. The sample banner stays visible on every screen.
3. No keys, no personal paths on screen. `desk demo` writes the dossier to a temporary folder; the terminal shows folder names only.
4. Length gate: `npm run desk -- demo` finishes in about 35 seconds offline; the video is those outputs with narration, trimmed to 3:50.
5. Upload so that it plays from a logged-out browser; check by opening the link in a private window.

## What the script does not show

A live vendor pause on a tool that has no hook; a dollar figure claimed as an invoice; a "better model" claim without an interval; a regression presented as natural; a canary verdict reached in four minutes (the statistic needs 28 days, and the script says so).
