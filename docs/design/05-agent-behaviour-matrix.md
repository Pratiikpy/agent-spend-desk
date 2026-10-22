# Agent behaviour matrix: the organizers' strong patterns, and beyond them

Status: design (nothing is built). Source of the organizer wording: the Approach Guide section 9 and the Welcome Guide section 3 (`docs/event/`), and the instructor deck takeaways (`docs/intel/07`). The role roster and its LLM-versus-code rules are in the spec, section 15; this document makes every organizer pattern, and the additions beyond them, explicit and testable. Every row names a trace event and a test that shows the behaviour can change the outcome, because judges discount agents that are prompt wrappers or fixed pipelines.

## 1. The organizers' collaboration checklist (at least three required): all nine

| # | Organizer behaviour | Role that does it | Trace event | Test that it can change the outcome |
|---|---|---|---|---|
| 1 | Planner delegates subtasks based on the input | Planner (template per case type) plus plan augmenter (LLM proposes extra checks as proposals) | `plan.created`, `plan.check_proposed` | A case whose augmenter-proposed check flips the verdict. Claimed as dynamic delegation only if such a case exists. |
| 2 | Specialist agent uses data or tools | Source Mapper, Document Reader, Reconciler, Researcher | `tool.call`, `tool.result` (hashed) | A run where removing a tool changes the answer. |
| 3 | Evaluator critiques the specialist output | Critic (rubric 0 to 3 on accuracy, appropriateness, actionability; pass at 7 of 9) and the hard critic (code) | `critic.score` | A draft with a planted unsupported claim scores below 7. |
| 4 | Agent revises output after critique | Weaver and Synthesizer revise once on one targeted fix | `revision.applied` | The revised draft differs and passes. |
| 5 | Risk or safety agent flags unsupported claims | Risk Agent (claim ledger, risk-term scan, injection flags) | `risk.flag` | A planted fabricated quote and a hidden instruction are both flagged. |
| 6 | Agents write structured messages to shared memory | Typed case state shared by every role | `state.write` | State snapshot at each step replays the run. |
| 7 | Workflow branches on confidence | Selective release and the autonomy ladder AL0 to AL3 | `branch.confidence` | Same case, lower confidence, different branch (hold instead of release). |
| 8 | Fallback path activates if data or an API fails | Cassettes, cached samples, deterministic rule brain, embedded store | `fallback.used` | Kill each dependency in turn; the run still completes and says what it fell back to. |
| 9 | Final answer includes traceable evidence | Reporter with span-addressed claims | `report.claim_to_span` | The offline verifier re-checks every quote. |

## 2. The organizers' strong behaviours (seven): all seven

| Strong behaviour | Our mechanism |
|---|---|
| Dynamic task delegation | Plan template plus augmenter proposals; the Skeptic delegates questions to the Researcher. |
| Back-and-forth communication | Skeptic and Researcher exchange questions and evidence until all are answered or the budget is spent; Critic and Weaver exchange fixes. |
| Agents validating outputs | Hard critic, entailment judge, mechanical quote check, offline verifier. |
| Shared memory or state | Typed case state; World Model for facts; H-MEM for past cases. |
| Branching based on confidence or risk | Selective release, autonomy ladder, escalation to a human. |
| Retry and recovery | One bounded retry with backoff on tools; one targeted revision on critique; fall back to cached sample or deterministic brain. |
| Role specialisation with real interdependence | Each role changes tool scope, input view, model tier or trust boundary, and removing it measurably changes an outcome (role-necessity ablation). |

## 3. The organizers' strong loop, extended

Organizer pattern: Planner creates approach, Executor attempts, Evaluator detects missing evidence, Planner revises, Research Agent retrieves, Executor reruns, Evaluator approves or requests another iteration, Final Agent answers.

Ours, with the extra edges in brackets:

```
Case --> Planner --> Source Mapper / Document Reader / Reconciler
                         |  (Document Reader is quarantined: no tools, typed output only)
                         v
                    Evidence Weaver (claim ledger, mechanical quote checks)
                         |
        +----------------+---------------------+
        v                                      v
   Skeptic <--questions/evidence--> Researcher      Risk Agent --> escalate / hold
        |                                      (injection, unsupported, sanctions)
        v
     Critic (0-3 x 3, pass 7/9) --one fix--> Synthesizer --> Critic (second look)
        |
        v
   Memory Keeper (precedent + counter-precedent) --> Decider (policy, autonomy)
        |                                               |
        v                                               v
   Release Broker (approval bound to request) <-- Human approver
        |
        v
   Reporter (evidence, confidence, limitations, flip fact)
        |
   Rule Learner <-- override from the approver --> replay on past cases + symbolic check
   Watcher (scheduler) re-opens cases when a source changes
   Red-team Agent (offline) generates attacks against the whole loop
```

## 4. The four named pairings from the workshop deck

| Pairing | Our roles | Hand-off format |
|---|---|---|
| Planner + Doer | Planner and the specialists | Plan of at most 5 checkable steps with tool hints; the Doer halts on a failed rubric. |
| Proposer + Critic | Synthesizer and Critic | Draft brief, then rubric score and one targeted fix. |
| Context-Packer + Actor | Evidence Weaver packs, Decider acts | BRIEF, CITES[], RISKS, OPEN_QS; open questions become re-planning queries or to-dos. |
| Evidence-Weaver + Synthesizer | Weaver and Synthesizer | QUOTES[source], LIMITS, TIMESTAMP; unmet limits become explicit questions. |

Each hand-off carries a pairing tag in the trace so a judge sees the pairing without reading code.

## 5. Beyond the organizers (eight additional strong patterns)

| # | Pattern | Why it is stronger than the checklist | Test |
|---|---|---|---|
| A | Adversarial pair: Advocate and Skeptic argue, an Arbiter resolves only the residue | Agreement between agents is never accepted as evidence; contested claims escalate | Contradiction recall of the pair versus a token-matched single call |
| B | Red-team agent (offline) | The system is attacked by an agent that generates injections, forgeries and near-duplicates; the detection score is published | Catch rate with intervals on planted attacks |
| C | Independent non-LLM verifier | A separate checker re-verifies quotes and the decision bundle offline | Tamper corpus with zero false accepts (with exact bound) |
| D | Rule Learner loop | The approver's override becomes a rule only after replay on past cases and a symbolic check | A rule that would widen the permissive surface is rejected |
| E | Counter-precedent rule | Memory must show cases that point the other way | A planted opposing case is always shown |
| F | Evidence-gap re-planning | An unanswered sub-question triggers a bounded re-plan, not a guess | Case where re-planning retrieves the missing fact and changes the verdict |
| G | Restrict-only trust lattice | Untrusted text can add holds but never grant permission | Injected "approved by the CFO" text never releases |
| H | Watcher | Open cases re-open when a source changes, and pending approvals are invalidated | A planted source change reopens exactly the affected cases |

Experimental, only if an ablation shows a gain: a jury of independent judges (different models and evidence slices). Debate studies report agreement collapse, so it is not a headline claim.

## 6. Roster (visible agents)

LLM roles: Document Reader, entity matcher (possible band only), claim decomposer, entailment judge, Advocate, Skeptic, Arbiter, soft Critic, plan augmenter, optional policy judge. Code roles (shown as agents in the trace because they act, delegate and validate): Planner template, Source Mapper, Reconciler, Evidence Weaver, hard Critic, Risk Agent scans, Memory Keeper retrieval, Decider and rule engine, Release Broker, Rule Learner, Watcher, Reporter. Offline: Red-team Agent.

Honesty rule: the trace states for each role whether it is an LLM call or deterministic code, so no role is presented as an agent when it is a prompt wrapper, and no check is credited to a model when code performed it.

## 7. Count

Organizer checklist: 9 of 9. Strong behaviours: 7 of 7. Named pairings: 4 of 4. Additional patterns: 8. All designed, none built; the figures describe the design, and each is claimed only after its test has run.


## 8. Additions from the 56-repository profile pass (v5.2, D-026)

Each row is a behaviour taken or tightened from a profiled repository, with the trace event and the test that shows it can change an outcome. Ids refer to the adoption register (`prior-art/profiles/99-synthesis-best-of-by-module.md`).

| Behaviour | Role | Trace event | Test that it can change the outcome |
|---|---|---|---|
| Blocking check before any irreversible tool, on every agent and handoff (M5-1) | Gate in the kernel | `gate.verdict` before `tool.call` | Parallel-check regression: no tool call precedes the verdict |
| Allow, reject with reason, or raise (M5-2) | Gate | `gate.outcome` | One test per outcome; the reason is recorded |
| Pause and resume with a one-time key (M5-3) | Broker | `release.paused`, `release.resumed` | Crash between approval and send: one payment, not two |
| Approval pins the exact object reviewed (M5-8) | Approval service | `approval.pinned`, `approval.refused_changed` | Change the proposal after staging: approval refused |
| Bounded release-versus-hold debate (M5-5, ablation-gated) | Advocate and skeptic | `debate.turn`, `debate.end` | Ablation: removing it changes at least one routing on the gold set, else it is a roadmap item |
| Stakeholder perspectives ask questions of the evidence (M4-4, ablation-gated) | Researcher | `perspective.question` | Removing one perspective changes at least one finding on the gold set, else dropped |
| Claim extracted from our own draft and searched (M4-3) | Risk agent | `claim.draft_extracted` | Planted unsupported sentence in a draft is caught |
| Narrative-numeric grounding before display (M4-5) | Reporter check | `report.figure_checked` | Planted wrong figure is rejected |
| Evidence-gap rollback to a snapshot within a budget (M4-11) | Planner | `plan.rollback` | Rollback restores state exactly; budget enforced |
| Failed unit of work recorded as an evidence gap (P-1, M4-7) | Any role | `gap.recorded` | Kill each dependency in turn; every run shows a gap and no default |
| Critic and proposer are different models (M4-14) | Start-up validator | `config.validated` | Same-model configuration fails start-up |
| Observe mode records what would have been blocked, with an alarm if left on (M5-4) | Gate | `gate.observe_would_block` | Observe left on raises a doctor warning |
| Outcome memory: the lesson waits for the real outcome (M6-3) | Learner | `lesson.pending`, `lesson.proposed` | Outcome arrives later; a lesson is proposed, never applied without a certificate |
| Scheduler runs at most once, restores a missed slot once (M7-7) | Watcher | `schedule.slot_restored` | Crash test: at most once, never dropped silently |
