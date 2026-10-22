# Use Case Decision Worksheet

The organizers' one-page worksheet (`docs/event/04-approach-guide-solutioning.md` §21) plus their self-scoring (§13), made fillable. Complete **before** building. Run once per candidate idea; keep every candidate, including the losers, so the decision is auditable. Record the final choice in `docs/DECISIONS.md`.

## Candidate: ______________________ (copy this file per candidate: `00-use-case-decision-worksheet.<name>.md`)

### Problem

- **Selected track:**
- **Problem statement** (format: *We are building an agent that helps [user] solve [problem] by [agent capability] using [data source], producing [output].*):
- **Target user:**
- **Decision supported:**
- **Final output:**

### Scope

- **What we will build (to full quality):**
- **Deliberately not building:**
- **Main demo scenario (1–4 min):**
- **Pre-existing components to declare:**

### Data

- **Primary data source:**
- **Static data size estimate:**
- **Runtime API required?** Yes / No
- **`SAMPLE_MODE` fallback?** Yes / No
- **Licensing or sensitivity concerns:**

### Sponsor technology

| Sponsor | Requirement | Where it fits in our build |
|---|---|---|
| Zetaris | required | |
| Meterless | required | |
| Cursor (with Space XAI) | required IDE | |
| NVIDIA | where it contributes | |
| Bright Data | bounty only | |

### Agents

| Agent | Role | Input | Output | Collaborates with |
|---|---|---|---|---|
| | | | | |

### Collaboration (tick all that apply; need at least three)

- [ ] Delegation  - [ ] Critique  - [ ] Revision loop  - [ ] Shared memory  - [ ] Branching
- [ ] Retry  - [ ] Escalation  - [ ] Confidence scoring  - [ ] Human-in-the-loop

### Constraints

- [ ] Runs from a clean setup, no manual steps
- [ ] Runs predictably and bounded (organizer target 5–10 min per run)
- [ ] Repository is light
- [ ] No hardcoded outputs
- [ ] No committed keys
- [ ] Logs show how the agent worked
- [ ] Sample inputs and outputs included
- [ ] Zetaris and Meterless integrated; Cursor used; NVIDIA (and Bright Data for the bounty) documented

## Organizers' self-score (0–2 each)

| Question | Score |
|---|---:|
| Can we explain the problem clearly in 30 seconds? | |
| Do we know who the user is? | |
| Do we have accessible data? | |
| Can we build and fully verify a working version? | |
| Can it run quickly and predictably? | |
| Do Zetaris and Meterless have a real role in the build? | |
| Do agents interact more than once? | |
| Is there critique, validation, or retry? | |
| Can we show useful output in a 1–4 minute demo? | |
| Can we document limitations clearly? | |
| **Total (max 20)** | |

16–20 strong candidate · 11–15 feasible, reduce scope · 6–10 high risk · 0–5 choose another.

## Our own extra tests (not organizer text)

| Test | Result |
|---|---|
| Which rubric criteria could this idea win outright? (Impact 30 / Technical 20 / Innovation 15 / Demo 15 / UX 10 / Sponsor 10) | |
| Is the output something a judge can verify independently (source cited, number checkable)? | |
| What is the single most likely way it fails live in front of a judge, and what is the fallback? | |
| What would a strong competitor entry in the same track look like, and how are we different? | |

## Five yes/no statements (all must be yes) [A §22]

1. We understand the problem and the user.
2. We can access the data reliably.
3. We can build a narrow, excellent, fully verified version with Zetaris and Meterless integrated.
4. We can show agents doing real work.
5. We can run it cleanly and explain it in a 1–4 minute demo.
