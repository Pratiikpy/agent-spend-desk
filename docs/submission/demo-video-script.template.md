# Demo Video Script: <project name>

Required: **1–4 minutes**, main workflow, how the agent solves the challenge, key features, **how Zetaris and Meterless are integrated** (`docs/event/02-faq.md` §7). Judges discount hardcoded demo paths, so record a **real run** and show the trace.

Aim for 3:15–3:45 to leave margin under the 4:00 limit. Record from a clean checkout so what is shown is what a judge can reproduce.

| Time | Segment | On screen | Voiceover | Proof it is real |
|---|---|---|---|---|
| 0:00–0:20 | The problem and the user | | One sentence in the organizer format: helps [user] solve [problem] ... | |
| 0:20–0:40 | The input | the real input being given | | input file path visible |
| 0:40–1:40 | Agents at work | live run; agents delegating, critic rejecting, revision, retry | narrate each decision and *why* | trace stream visible, timestamps running |
| 1:40–2:10 | **Zetaris** | where Zetaris data enters; the call and what it returned | what role it plays, what would be impossible without it | trace line with sponsor call |
| 2:10–2:40 | **Meterless** | where Meterless executes | what it makes faster or possible | trace line with sponsor call |
| 2:40–3:00 | Failure handling | one dependency killed, system falls back and says so | | fallback log line |
| 3:00–3:30 | The output | final output with evidence and confidence | why a user can act on it | citations open to real sources |
| 3:30–3:45 | Close | architecture slide, repo link | what is unique; limits | |

## Rules for the recording

- One take of a real run. Cuts allowed only to skip waiting; mark skipped time on screen.
- No API keys, tokens or personal data visible. Check every frame.
- Readable at 1080p; terminal font large enough for a phone.
- Audio clear; captions on, since many judges watch muted.
- NVIDIA and Cursor get a line each in the video only if they genuinely appear in the build.
- After export: watch it end to end once, with a stopwatch, before uploading.
