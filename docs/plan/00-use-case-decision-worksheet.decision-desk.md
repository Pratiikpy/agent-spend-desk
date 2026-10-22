# Use Case Decision Worksheet: the Decision Desk (payer pack leading)

Filled 2026-10-17 from `docs/plan/00-use-case-decision-worksheet.md` (the organizers' §21 worksheet and §13 self-score). Candidate chosen by Prateek (D-028 track, D-029 framing). Everything below is a plan; scores are our own hypotheses, not results. Sources of the facts: `docs/event/`, `docs/intel/12-how-the-week-runs-key-facts.md`, `docs/design/prior-art/2026-10-17-*.md`.

### Problem

- **Selected track:** Track 3, Reasoning Architecture.
- **Problem statement:** We are building an agent that helps a health insurer's utilization-review lead decide, for each prior-authorization request, whether to approve or route to a clinician, by reconciling the clinical note, the plan's policy criteria and the claims history, verifying every claim against its source text, applying precedent from past overrides and learning safe new rules from them, using synthetic payer data through Zetaris and Nemotron, producing a signed decision dossier that a stranger can verify offline, with the exact criterion, the cited excerpt and the one fact that would flip it.
- **Target user:** the utilization-review lead (lead scene); the head of risk and operations at the same insurer works the wider Decision Desk (D-029).
- **Decision supported:** approve or route to a clinician. The system never denies.
- **Final output:** a signed decision dossier per case, and a prioritised queue of cases ordered by deadline clock and risk, with the reasoning for each decision (the organizers' Track 3 example ends in a prioritised list with reasoning).

### Scope

- **What we will build (to full quality):** the whole kernel (M1 to M14) and the packs of PRD F-S16 and F-P09 to F-P13, each fully implemented, with the lead scene polished.
- **Deliberately not building:** real patient data, any automatic denial, clinical diagnosis, a hosted multi-tenant service, real payer integrations, forgery detection of images.
- **Main demo scenario (1 to 4 min):** open on one prior-authorization case whose note, policy criteria and claims history disagree; Zetaris query and rows on screen; a held case names the exact criterion and the one flip fact; the approver overrides; a proposed rule passes replay and the symbolic check; a rerun changes the outcome; the dossier verifies offline. Then the desk shows a second and a third case type (a claim and a provider payment) as a diff on the same kernel. The organizers' own better example for a broad idea uses three case types.
- **Pre-existing components to declare:** the local runtime starter `src/runtime/*.ts` (505 lines, 2026-10-13, uncommitted) pending the organizers' answer (F13); design documents; third-party open-source libraries with credit; tooling.

### Data

- **Primary data source:** synthetic payer data we generate (Synthea seed, our generator, policy criteria we author as versioned rules from public coverage text), plus CMS NCCI edit files and CMS DE-SynPUF samples for the claims pack, and CUAD-style contracts for renewal.
- **Static data size estimate:** small samples only, a few megabytes (NOT MEASURED); larger files are fetched by a script, never committed.
- **Runtime API required?** Yes: Zetaris local REST and Nemotron through Meterless; each has a recorded fallback.
- **`SAMPLE_MODE` fallback?** Yes: cassette replay, embedded store and rule brain; the run states what it fell back to.
- **Licensing or sensitivity concerns:** synthetic data only; CPT code descriptions are AMA copyright and are not shipped (a lawyer decides); EDIReader is GPL-3.0 (rebuild only); state laws on AI in utilization review are NOT VERIFIED.

### Sponsor technology

| Sponsor | Requirement | Where it fits in our build |
|---|---|---|
| Zetaris | required | Primary data path: federated queries over the separate payer systems (claims, notes, policy library, billing); query and rows shown on camera; fallback to the embedded store. Local install verified; our own silos not yet registered |
| Meterless | required | The memory and reasoning engines built to the sponsor's conformance suites with a switch-off test each; No Meterless API or key exists (answered 2026-10-17), so Nemotron goes through NVIDIA's free API; what "Meterless running" requires is unconfirmed |
| Cursor (with Space XAI) | required IDE | The build environment; every session logged in `docs/sponsors/cursor-usage-log.md` (empty today) |
| NVIDIA | where it contributes | Nemotron (through Meterless or NVIDIA's free API) as the primary model profile; a separate in-kind prize exists |
| Bright Data | not used | The bounty is not in the Official Rules or the lesson |

### Agents (the visible five, named in the organizers' own vocabulary; the roster has about 23 roles)

| Agent | Role | Input | Output | Collaborates with |
|---|---|---|---|---|
| Intake Agent | structures the request and plans the checks | request, case type | typed case and plan | Rules Checker, Memory Keeper |
| Rules Checker | tests each policy criterion against reconciled evidence | reconciled claims, versioned criteria | per-criterion verdicts with cited spans | Critic, Memory Keeper |
| Memory Keeper | supplies precedent and counter-precedent | the case | similar past decisions, rules in force | Rules Checker, Critic |
| Critic (Skeptic and Advocate, verifier) | challenges unsupported claims, checks quotes mechanically, may reopen evidence | draft decision | flags, revision requests, abstain | Rules Checker, Intake Agent |
| Release Broker | binds the approval to the exact request and issues one single-use release or a routing | approved decision | signed dossier, release or clinician routing | the approver, Rule Learner |

### Collaboration

- [x] Delegation  - [x] Critique  - [x] Revision loop  - [x] Shared memory  - [x] Branching
- [x] Retry  - [x] Escalation  - [x] Confidence scoring  - [x] Human-in-the-loop

All nine are designed with trace events (`docs/design/05-agent-behaviour-matrix.md`); none is verified.

### Constraints (designed, each with a gate; none checked yet)

- [ ] Runs from a clean setup, no manual steps (gate: clean-clone run following the README literally; the Zetaris local install is the manual step to design around)
- [ ] Runs predictably and bounded (gate: timed run, budgets enforced in code)
- [ ] Repository is light (gate: `scripts/repo_size_check.py`)
- [ ] No hardcoded outputs (gate: varied inputs change outputs)
- [ ] No committed keys (gate: `scripts/secret_scan.py --history`)
- [ ] Logs show how the agent worked (gate: trace linter)
- [ ] Sample inputs and outputs included
- [ ] Zetaris and Meterless integrated; Cursor used; NVIDIA documented

## Organizers' self-score (0 to 2 each; our own hypothesis)

| Question | Score | Basis |
|---|---:|---|
| Can we explain the problem clearly in 30 seconds? | 2 | one-sentence problem above |
| Do we know who the user is? | 1 | named, not yet checked with practitioners (D3) |
| Do we have accessible data? | 2 | synthetic and generated by us |
| Can we build and fully verify a working version? | 1 | designed; verification is planned, not done |
| Can it run quickly and predictably? | 1 | unmeasured |
| Do Zetaris and Meterless have a real role in the build? | 1 | Zetaris installed and queried; our silos and the Meterless route are open |
| Do agents interact more than once? | 2 | revision loop, Skeptic and Advocate, re-planning |
| Is there critique, validation, or retry? | 2 | designed |
| Can we show useful output in a 1-4 minute demo? | 1 | staging risk; solved by opening on one decision |
| Can we document limitations clearly? | 2 | standing rule, NOT VERIFIED marks |
| **Total (max 20)** | **15** | the earlier 16 in `03-hackathon-fit-check.md` scored the plan, this scores confirmed evidence; the gap is closed by verification |

## Our own extra tests

| Test | Result |
|---|---|
| Which rubric criteria could this idea win outright? | Innovation (override to a provably safe rule; a signed record anyone can verify offline); Technical if reliability is measured; Impact depends on the user check |
| Can a judge verify the output independently? | Yes by design: cited spans, a per-criterion reason and an offline verifier |
| Most likely live failure and fallback | Zetaris or Nemotron unavailable or a slow run: cassette replay, embedded store and the rule brain, stated on screen |
| A strong competitor entry in the same track | One narrow, polished agent (for example a procurement fraud explainer) with a clear loop and a clean README; we differ by verifiability, learning that cannot widen permissions, and measured reliability |

## Five yes/no statements [A §22]

1. We understand the problem and the user: yes, pending practitioner checks.
2. We can access the data reliably: yes, synthetic.
3. We can build a narrow, excellent, fully verified version with Zetaris and Meterless integrated: yes by design; the Meterless route is open.
4. We can show agents doing real work: yes by design.
5. We can run it cleanly and explain it in a 1 to 4 minute demo: yes if the demo opens on one decision.
