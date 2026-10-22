# Judging Rubric and Self-Scoring

The published rubric (`docs/event/02-faq.md` §8) turned into a checklist we score ourselves against, honestly, at the end of each phase. Used by the `judge` skill and `judge-simulator` subagent. Evidence over opinion: a score without a pointer to a file, a trace line or a demo timestamp is not a score.

## Scoring scale

For each criterion, score 0–5 and convert: points = (score / 5) x weight. A criterion scores 5 only with evidence a stranger can verify.

| 0 | 1 | 2 | 3 | 4 | 5 |
|---|---|---|---|---|---|
| absent | claimed, not shown | partial, brittle | works on the demo path | works across inputs and failures | verified from clean setup, edge cases handled, evidence attached |

## Criteria and what to check

### Impact (30) · also the tie-breaker
- Named user and a real decision that improves.
- Problem statement matches the chosen track's challenge statement (read it on HackOS).
- Output is something the user could act on today.
- Value claim is supported by a measurable or checkable result, not adjectives.

### Technical (20)
- Runs from a clean setup, no manual steps, no runtime installs.
- Bounded runtime, timeouts, capped retries, `SAMPLE_MODE` fallback.
- Failure drills done: each external dependency killed, system degrades gracefully.
- Architecture is explainable in a minute; modules have contracts and tests.
- No hardcoded outputs, no committed keys.

### Innovation (15)
- A thoughtful agent pattern, not the familiar chain. Name the idea in one sentence.
- Differs from the strongest obvious entry in the same track.

### Demo (15)
- 1–4 minutes. Shows the main workflow, key features, **Zetaris and Meterless integration**.
- Recorded from a real run; logs or traces visible.
- A viewer who has never seen it understands the problem in 30 seconds.

### Product & UX (10)
- Output readable and usable by the intended user.
- Evidence behind each answer is one click or one line away.
- Accessible and uncluttered. A polished shell over a weak system scores badly, so spend effort in proportion.

### Sponsor Tech (10)
- Zetaris and Meterless each have a **real role**, not a logo.
- Cursor use evidenced (`docs/sponsors/cursor-usage-log.md`).
- NVIDIA contribution stated truthfully, or its absence explained.
- For the bounty: Bright Data data visibly changes the agent's output.
- The explanation says what was **unique** about our use.

## Discount triggers (from the FAQ): check each explicitly

- [ ] UI polish without depth
- [ ] Single-agent system presented as agents
- [ ] Hardcoded demo path
- [ ] Broad concept, weak implementation
- [ ] Unsupported value claims

Any ticked box is a defect to fix before submission, not a note.

## Score sheet (copy per review, save as `docs/evaluation/reviews/YYYY-MM-DD-<phase>.md`)

| Criterion | Weight | Score 0–5 | Points | Evidence pointer | Biggest weakness |
|---|---:|---:|---:|---|---|
| Impact | 30 | | | | |
| Technical | 20 | | | | |
| Innovation | 15 | | | | |
| Demo | 15 | | | | |
| Product & UX | 10 | | | | |
| Sponsor Tech | 10 | | | | |
| **Total** | **100** | | | | |

Rules: the reviewer scores as three independent judges would; names the single most likely reason each would mark down; and records anything that could not be verified as **NOT VERIFIED**, scored as 0 for that line.
