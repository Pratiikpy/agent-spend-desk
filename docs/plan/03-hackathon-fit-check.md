# Hackathon fit check (2026-10-15)

Question: does the current idea (an operating layer for agent work whose kernel is a release gate for irreversible agent actions; hero pack vendor-payment and bank-change release; spec v4.7, brief 001 v1.3) fit what the Open Agent Hackathon asks of the product? Sources: the Welcome Guide, FAQ and Approach Guide in `docs/event/`, the Participant Setup Guide of 2026-10-15 (`docs/intel/09`), and the Official Rules readout (`docs/intel/08`). This is a fit check of the design, not of a build: nothing is built or measured. Schedule items are left out by instruction.

## Ambition level (Approach Guide step P)

**Set by Prateek on 2026-10-15: level 6.** The organizers define levels 1 to 3 only (Focused, Ambitious, High-risk). Our own levels above them are L4 Verifiable, L5 Measured and L6 General (a kernel with swappable packs). The organizers' Level 3 warning (easiest to under-deliver) is answered with measured results, a clean run and honest limits, not with fewer capabilities.

## Sponsor integrations are real (Prateek, 2026-10-15)

Zetaris and Meterless will be built in as real integrations, not decoration: Zetaris as the primary data path for internal sources, and the four Meterless engines (H-MEM, World Model, Markovian, Scout Intent) implemented from their specifications and run through the conformance runners. Needs from Prateek: the Zetaris bundle, registry credentials and API key, and the Meterless route details the guide leaves blank.

## Verdict

**Fits Track 3 (Reasoning Architecture) by design.** Two conditions decide whether the fit holds: the pitch must show one user and one decision, and Zetaris must be the real centre of the data path.

## Fit, requirement by requirement

| Organizer requirement | Fit | Note |
|---|---|---|
| Track 3: turn data, knowledge, memory and reasoning into reliable decisions and actions | Fits | Data via Zetaris, knowledge via World Model, memory via H-MEM precedents, reasoning via policy plus evidence, action via the one-time release. |
| Tracks 1 and 2 also covered | Fits | Reconcile (fragmented sources), Explain (evidence and flip fact). One primary track only is scored. |
| Working agent system, not a chatbot or prompt chain; at least three of nine collaboration behaviours | Fits (designed) | All nine are designed with trace events; "dynamic delegation" is claimed only if a proposed check changes an outcome. |
| Zetaris required, "the center of every build"; must run locally | Conditional | Spec section 19 now makes it the primary data path. Access (bundle, registry credentials, API key) is not yet obtained. |
| Meterless required; must run locally | Conditional | Roles are specified (H-MEM, World Model, Markovian, Scout). Runners not run; the guide's Meterless route details are placeholders. |
| The product must run on NVIDIA Nemotron | Fits (designed) | Nemotron profile is primary; key and rate limits to check. |
| Build in Cursor | Open | A session log is required from the first day; `docs/sponsors/cursor-usage-log.md` is a template with no sessions recorded yet, which is a risk against the Cursor requirement until real sessions are logged. |
| Data: open, legal, small, no real personal data; sample mode; fallback if an API is down | Fits (designed) | Real public companies plus planted fakes, synthetic people; licences still to be read. |
| Bounded runtime; clean setup with no manual steps | Risk | Jury, replay and the symbolic check are unmeasured; a fast mode is needed. |
| Logs or traces; sample inputs and outputs; no committed secrets | Fits (designed) | JSONL trace, input_examples and output_examples, secret scan. |
| Judges discount broad concepts with weak implementation | Risk | The operating-layer framing is large. Answer: pitch one user (accounts-payable controller) and one decision; keep the platform behind it. |
| Judges discount hardcoded demo paths and unsupported value claims | Fits (designed) | Real varying inputs; NOT VERIFIED marking; measured scores to be published. |
| Pre-existing work not eligible | Open | Eligibility of uncommitted local work before the window is an unanswered organizer question. |
| Submission pack: demo video, deck, repo and README, sponsor explanation | Fits (designed) | Outline in `docs/submission/`. |

## Organizer self-score (Approach Guide section 13), scored on the design

| Question | Score 0 to 2 | Why |
|---|---:|---|
| Explain the problem clearly in 30 seconds | 2 | "A gate that shows its proof before an agent's irreversible action runs." |
| Know who the user is | 2 | Accounts-payable controller (hero), developers running coding agents (second). |
| Accessible data | 1 | Planned and mostly synthetic; licences unread. |
| Working version is buildable | 1 | Nothing built yet. |
| Runs quickly and predictably | 1 | Unmeasured. |
| Zetaris and Meterless have a real role | 1 | Designed; access and runners unverified. |
| Agents interact more than once | 2 | Loops, critique, re-planning designed. |
| Critique, validation or retry | 2 | Hard and soft critics, replay, symbolic check. |
| Useful output in a 1 to 4 minute demo | 2 | One scene with the hold, the flip fact and the rule replay. |
| Limitations documented clearly | 2 | NOT VERIFIED markings throughout. |
| **Total** | **16 of 20** | Our own application of the guide's self-test to the plan (the guide's bucket for this score is "strong candidate use case"; that is the guide's scale, not an endorsement). This scores the plan, not a result. |

## What would raise or lower the fit

- Raises: obtaining Zetaris and Meterless access and running a connection test; a measured memory-off versus memory-on gain; a published detection score; the HackOS challenge pages read and quoted.
- Lowers: Zetaris used as decoration; a demo that opens on the platform instead of one decision; a run longer than the organizers' 5 to 10 minute target; another entry in the same domain (a public repo, `Karthik0809/procurement-fraud-investigator`, targets procurement fraud with a skeptic agent) that shows a clearer single scene.


## Update 2026-10-16 (after the 56-repository profile pass, spec v5.2)

What changed in the fit: (1) Sponsors. Zetaris is installed and running locally (9 of 9 platform checks, 2026-10-16) with its API key stored and a REST query verified on the sample sources; it stays "Conditional" until our own sources are served through it and it appears in a product trace. The Meterless repository was read: it holds four engine specifications, reference implementations and conformance suites, and no server or hosted API; the engines are therefore built and run against their suites, and a hosted-route claim waits for the sponsor's answer. An NVIDIA key is stored and one live call returned HTTP 200; rates, tool calling and streaming are NOT VERIFIED. (2) Judges' discount list. The profile pass found the same traps in the field that judges discount: silent failures, defaults that look like results, vendor numbers quoted as ours, a gate that is off by default. Spec section 0.4 and the rules P-1 to P-8 answer each with a test. (3) Narrow competing designs. Entries with one claim, three verdicts and a short loop are easy to finish and to show. Our advantage depends on the hero path running end to end with traces; until then it is NOT VERIFIED. (4) Disk. The development drive has about 19 GB free and Zetaris needs 15 GB free (about 10 GB once pulled). Self-score of the plan stays 16 of 20; it scores the plan, not a result.
