# Requirements coverage: what the organisers ask for, and where desk. answers it

Every requirement below is taken from the organisers' own documents (the welcome guide, the FAQ, the Approach Guide, the setup guide and the lesson "How the Week Runs"). Each row says where in the submission it is covered and its status. Statuses are PASS (done and checked), YOU (only Prateek can do it) and OPEN (an unknown the organisers have not answered). Nothing here is marked PASS on the strength of code alone: each PASS names something to open or run.

## Submission components

| Requirement | Where covered | Status |
|---|---|---|
| Demo video, 1 to 4 minutes, main workflow end to end | `scripts/demo-video/record.mjs` records it from real runs; `demo-video-script.md` lists every scene | PASS for the recording; YOU to upload and link it |
| Video names Zetaris, Meterless and Cursor and shows where each sits | A scene with the four sponsors and their place in the pipeline, plus the Zetaris and Meterless scenes | PASS for Zetaris and Meterless; Cursor is named and placed, with its log's honest state (see below) |
| Slide deck: problem and users, solution, agent workflow and architecture, technical stack, how Zetaris and Meterless are used, what was unique about sponsor usage, product visuals, future enhancements | `docs/submission/desk-deck.pdf` (source `deck/deck.html`): problem and user, why it matters, what it is, the demo, architecture, one product across three tracks, Track 3 mapping, the agents, the collaboration checklist, a trace, verification, head to head, new measurements, Zetaris, Meterless, NVIDIA and Cursor, where each sponsor sits, technical stack, canary, product, the organisers' red flags, proven and not proven, next | PASS |
| GitHub repository with README: setup, usage, dependencies | `README.md`: Try it, What it does, Stack and dependencies, Live mode; clean-room run recorded in `docs/verification/` | PASS; YOU to check the link while logged out |
| Sponsor technology explanation: Zetaris, Meterless, Cursor, NVIDIA, what was unique | `docs/submission/sponsor-technology-explanation.md` | PASS; the Cursor section states that no session is logged |
| Primary track selected (exactly one) | Track 3, Reasoning Architecture, stated in the README, the deck and the explanation | YOU to select it in HackOS |
| Pre-existing components declared | `docs/submission/pre-existing-components.md` | PASS |
| Colab links, only if Colab-hosted agents were used | None were used | PASS (not applicable) |
| Team: one to five, locked at the first submission | Prateek's decision | YOU |

## The Approach Guide, section by section

| Ask | Where covered | Status |
|---|---|---|
| The problem sentence: "We are building an agent that helps [user] solve [problem] by [capability] using [data], producing [output]" | The README's opening and the deck's first slide | PASS |
| One user, one decision, one data slice, one strong output | An engineering lead who pays for coding agents; next month's caps and routes; agent logs, git history and three Zetaris-joined sources; a signed, replay-tested policy | PASS |
| Collaboration checklist, at least three of nine | All nine, each with a file or a trace event: README "The agents", deck slides "The agents" and "Collaboration, against the organizers' checklist" | PASS |
| Agent roster: role, input, output, who it works with | The same two places | PASS |
| Human in the loop and escalation | Approval echo of the request id and action digest; the Drafter's escalation when no policy passes; the gate fails closed | PASS |
| Runtime discipline: bounded, predictable, 5 to 10 minutes | README "How long a run takes", deck "red flags" slide; budgets are enforced in code | PASS |
| Data README, sample strategy | `data/README.md`; the sample is generated from a seed | PASS |
| Sample inputs and outputs, a trace | `input_examples/`, `output_examples/`, `output_examples/traces/` | PASS |
| Red flags in section 18, each one answered | README "Against the organizers' red flags" and the matching deck slide | PASS |

## Sponsors and rules

| Requirement | Where covered | Status |
|---|---|---|
| Zetaris is required and has a real role | One statement over three silos; billed spend, CI facts and spend per landed pull request disappear when it is off; a container was really stopped. `desk prove` checks the difference | PASS |
| Meterless is required and has a real role | Three engines with their own conformance suites (8/8, 13/13, 8/8); each changes an answer when switched off. There is no Meterless API or key: the organisers confirmed on 2026-10-17 that the engines are implemented in our own code | PASS |
| NVIDIA wherever it contributes; the product runs on Nemotron | Every language role and all three benchmark arms run on Nemotron through NVIDIA's API. `MODEL_BASE_URL`, `MODEL_API_KEY` and `NEMOTRON_MODEL` are accepted as well as the `NVIDIA_` names | PASS |
| Cursor is the required IDE; the explanation says how it was used | `docs/sponsors/cursor-usage-log.md` records what was done in Cursor. No session is logged, so nothing is claimed | YOU: work in Cursor and log real sessions, or accept a weaker sponsor score |
| Zetaris and Meterless "running on your machine" for eligibility | Zetaris runs locally in Docker; the Meterless engines run in our process and pass their conformance runners. What the organisers mean by "Meterless running" is not defined | OPEN |
| Whether other models may run beside Nemotron | The product uses Nemotron only | PASS |
| Work committed before the window is not eligible | The first commit is after 22 October 00:00 UTC; nothing earlier was committed or pushed | PASS |
| No secrets, runnable by an outsider, light repository | `scripts/secret_scan.py` on the tree and the history; `scripts/repo_size_check.py`; `.env` is ignored and `.env.example` is empty | PASS |
| Never hardcode outputs; fall back when an API is down | Outputs come from the run; recorded replies replay offline; a cassette miss is an error, never a guess | PASS |

## What the judges reward, and where it is shown

| Judging criterion | Evidence a judge can open |
|---|---|
| Impact (30): a clearly defined user with a real problem | The problem sentence; five public quotes with their sources (README and deck); `docs/design/desk/04-evidence-table.md` |
| Technical (20): reliable execution, agents that do real work, critique and recovery | `desk prove`; the trace with a draft that blocked landed work and was revised; a plan critic; a pre-registered benchmark whose losing first run is published |
| Innovation (15) | A restrict-only policy check fuzzed against an oracle; an Explainer that never reads the question; a signed dossier a stranger verifies offline; the Desk's own judgement recorded and scored |
| Demo (15) | The captioned video of real runs; `npm run desk -- demo` |
| Product and UX (10) | Fourteen screens, light and dark, stacked cards on a phone; `docs/verification/ui-sweep.md` |
| Sponsor technology (10) | The sponsor slides and `sponsor-technology-explanation.md`, each claim with a call site and a switch-off test |

## What the judges discount, and our guard

| Discount trigger | Guard |
|---|---|
| UI polish without depth | Every screen reads recorded data; the Evidence screen shows what was measured, including what failed |
| A single agent called multi-agent | The roster, the nine behaviours and a trace of one agent's work being sent back by another |
| Hardcoded demo paths | Outputs change with inputs; the benchmark replays from recordings and the check fails if a recording is missing |
| Weak implementations | 460 or more tests; `desk prove` with every check named |
| Unsupported claims of value | Every figure in the README, deck and video comes from a run; limits are stated beside them |

## Open questions the organisers have not answered

1. What "Meterless running on your machine" requires.
2. Whether pre-window preparation is scored (the documents and two guard scripts are declared).
3. Two documents we have not read: "Strong Submission Examples" and "Vibe Coding Starter Guide" in the HackOS resources. They sit behind a login; pasting them here would let us check this table against them.
