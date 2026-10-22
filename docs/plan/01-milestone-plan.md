# Milestone Plan

**No time limit. No build limit.** Milestones are gated by quality and evidence, never by dates. A milestone is finished when its gate is demonstrated, not when time runs out. Nothing here may be cut or shrunk to save time.

The only date that binds us: **nothing is committed or pushed before 22 Oct 2026 00:00 UTC** (earlier-committed work is ineligible). Build locally and uncommitted until then.

**Where the detailed build order lives.** M1 (idea choice) and most of M2 (design) are done: the use case and direction are decided (D-006 to D-009) and the design is `docs/design/00-architecture-master-spec.md`, whose section 20 gives the dependency-ordered quality gates for the build and section 21 the closures needed to cover every organizer demand. Treat M3 onward below as the coarse view and the spec's section 20 as the working order. The use-case worksheet for Plumbline (F-WORKSHEET) and the loop spec are still to be filled from the spec.

## M0 · Foundations (no code)

| Gate | Done |
|---|---|
| Registered on hackathon.genai.works | |
| Data Day recording watched (Zetaris, Bright Data) | |
| All five sponsor folders on HackOS read; `docs/sponsors/*` verified-facts tables filled with sources | |
| Official Rules and every challenge page read; gaps closed in `docs/intel/06-source-gaps-and-discrepancies.md` | |
| Cursor installed and working; first entry in `docs/sponsors/cursor-usage-log.md` | |
| Onboarding session content captured through `/capture-intel` (Bright Data bounty, extra challenges) | |
| Open questions answered: use case, stack and direction closed by D-006 to D-009; team size, registration and sponsor accounts (Zetaris trial, NVIDIA key) remain Prateek's | |

## M1 · Choose the idea, as rigorously as possible

- Generate many candidate use cases across all tracks. Fill one worksheet each (`00-use-case-decision-worksheet.md`).
- Research the strongest existing alternatives and the likely competing entries per track; name what makes ours better, with evidence.
- Run `/judge` on each idea (scope `idea`). Pick the one with the highest real ceiling on Impact, Technical and Innovation, not the easiest.
- Record the choice and the reasons in `docs/DECISIONS.md`. Keep every losing candidate.

Gate: a chosen use case whose outcome a stranger can verify independently, with a written reason it beats the alternatives.

## M2 · Design before code

- `/loop-spec`: complete `docs/design/agent-loop-spec.md`.
- Choose agent pairings (`docs/design/agent-pairings.md`), autonomy level per agent, memory layers, caps, trace schema.
- Decide exactly where Zetaris, Meterless and NVIDIA (and Bright Data for the bounty) do real work.
- `agent-behaviour-critic` and `sponsor-integration-reviewer` review the design on paper.

Gate: reviewers cannot name a wrapper agent or a cosmetic sponsor role.

## M3 · Walking skeleton

- Connection test to every sponsor service, each with a tested fallback.
- A basic loop running end to end on one real sample input with `SAMPLE_MODE=true`.
- JSONL trace with a `why` per decision.

Gate: `python scripts/secret_scan.py` clean; the loop runs from a fresh checkout.

## M4 · Agent depth

- Real critic with the 0–3 rubric; revision loop; branching; retry; escalation or human-in-the-loop; shared state.
- At least three real collaboration behaviours, each forced by a test (forced critic rejection, tool failure, no-evidence input, cap hit).

Gate: `agent-behaviour-critic` reports every agent REAL.

## M5 · Real data and the best outcome quality

- Real data and tools in; retrieval working; provenance on every claim.
- Judge outcome quality on real inputs, three runs each, worst case reported; compare against strong alternatives and baselines.
- Failure drills: every dependency killed, junk input, empty input, oversized input.

Gate: output worth acting on for the named user, verified independently against a source of truth.

## M6 · Product and experience

- Output usable by the intended user; evidence one click away; accessibility checked; every state looked at, light and dark where applicable, desktop and mobile where applicable.

Gate: reviewed as a stranger, screenshots read critically.

## M7 · Materials

- README from `docs/templates/project-readme.template.md`, `data/README.md`, sample inputs and outputs, a cleaned sample trace.
- Demo video from a real run; slide deck; sponsor technology explanation (all templates in `docs/submission/`).

Gate: every claim in the materials is backed by something inspectable.

## M8 · Full verification

- `clean-room-verifier` on a fresh clone, README followed literally, `SAMPLE_MODE` and live.
- `/judge` scope `final`; every item below 3 fixed or consciously accepted in `docs/DECISIONS.md`.
- `rules-auditor` clean; `python scripts/secret_scan.py --history`; `python scripts/repo_size_check.py`.

Gate: no FAIL, nothing silently NOT VERIFIED.

## M9 · Publish

- Possible only on or after 22 Oct 2026 00:00 UTC: `git init`, plain professional commits, push, then submit on HackOS if and when Prateek chooses. Create the HackOS submission only when the team is final (it locks the team).

## Standing rules

- Each working session: one entry in `docs/sponsors/cursor-usage-log.md`.
- Each costly decision: one entry in `docs/DECISIONS.md`.
- Each sponsor fact: sourced in `docs/sponsors/`.
- Quality is the only objective.
