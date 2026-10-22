# Use-Case Decision Worksheet: Plumbline

Filled in the organizers' worksheet format (`docs/plan/00-use-case-decision-worksheet.md` holds the blank form and our extra tests). Scores are honest first estimates, to be revised after the validation interviews and the HackOS reading. Track selection is Prateek's and is not part of this sheet.

## Problem

**Problem statement.** We are building an agent that helps a procurement or accounts-payable approver decide whether to release a payment to a vendor by reconciling conflicting internal records, public registries and documents, verifying each claim against the source text, and applying the company's policy and precedent, producing a decision dossier with cited evidence, reasons, gaps and an approval state.

**Target user.** An accounts-payable or procurement approver, with vendor-risk reviewers as secondary users.

**Decision supported.** Release, hold, escalate or reject one payment to one vendor.

**Final output.** A decision dossier: reconciled truth table, verified claim ledger with source passages, rules and precedents applied, minimal-flip explanation, autonomy level and approval state.

## Scope

**What we build for the submission slice.** The hero case end to end on three to four small sources, with the five visible agents, a re-plan loop, the claim ledger with mechanical quote checks, the policy engine with approval gate, a console that shows the dossier and evidence viewer, the offline verifier, and the sponsor integrations.

**What the slice does not show.** The whole product is built (D-013), but the demo and submission lead with the slice and do not show enterprise operations, the second domain pack, continuous portfolio monitoring or any real payment execution.

**Main demo scenario.** One vendor whose internal record disagrees with the registry and with an audit document, with a bank-detail change shortly before a large payment: the system reconciles, flags the unresolved conflict, shows the unverified claim and the minimal change that would flip the decision, and holds for approval.

**Pre-existing components to declare.** Vendored Meterless conformance runners (Apache-2.0), the seeded data generator and its seed, cassettes recorded before the window, and all design and local code written before the window opens (declared, not hidden).

## Data

**Primary sources.** Synthetic internal silos served through Zetaris (ERP extract, contracts and payments), GLEIF and Wikidata (CC0), a synthetic registry or filing extract and synthetic documents for the rest.

**Static data size estimate.** Well under a few MB in the repository.

**Runtime API required.** Optional in live mode; none in `SAMPLE_MODE`.

**Fallback sample mode.** Yes (cassette replay and the rule brain).

**Licensing or sensitivity concerns.** No real personal data in committed fixtures; SEC, OFAC and CourtListener reuse terms are unverified, so their bodies are not committed; OpenSanctions data is non-commercial and is never shipped.

## Sponsor technology

| Sponsor | Requirement | Where it fits |
|---|---|---|
| Zetaris | Required | All internal data reads through REST or JDBC; role-scoped views and the audit-log cross-check as candidates once the trial grants them |
| Meterless | Required | H-MEM precedent memory, World Model case and entity state with as-of replay, Markovian inside one deep case, Scout contracts for the release capability |
| Cursor | Required | Development environment, session log with screenshots |
| NVIDIA | Where it contributes | Nemotron as the sponsor-profile model for extraction, decomposition, entailment and judgement |
| Bright Data | Bounty only | Not planned; the Official Rules do not mention it |

## Agents (visible view)

| Agent | Role | Input | Output | Collaborates with |
|---|---|---|---|---|
| Planner | Plans the checks and routes sources; re-plans on gaps | Case, policy | Plan, source routing decisions | Evidence Retriever, Safety and Risk Evaluator |
| Evidence Retriever | Fetches, extracts and matches | Plan | Typed facts with locators | Planner, Domain Reasoner |
| Domain Reasoner | Reconciles, applies rules and precedent | Facts | Truth table, allowed actions, recommendation | Safety and Risk Evaluator |
| Safety and Risk Evaluator | Verifies claims, argues for and against, enforces the gate | Facts, recommendation | Verified ledger, gaps, revision requests, holds | Retriever (revision), Reasoner |
| Recommendation Agent | Produces the dossier and approval card | All of the above | Dossier | Human approver |

## Collaboration (checked)

Delegation, critique, revision loop, shared memory, branching, retry, escalation, confidence scoring (ordinal), human-in-the-loop.

## Self-score (0 to 2 each)

| Question | Score | Note |
|---|---:|---|
| Explain the problem clearly in 30 seconds | 2 | One user, one decision |
| Know who the user is | 1 | Plausible, unvalidated until interviews |
| Accessible data | 2 | Synthetic plus CC0 sources |
| Can build a working version of the slice | 2 | The slice is narrow by design |
| Runs quickly and predictably | 1 | Budgets designed, not measured |
| Zetaris and Meterless have a real role | 1 | Designed; Zetaris access unverified |
| Agents interact more than once | 2 | Revision and re-plan loops |
| Critique, validation or retry | 2 | Mechanical verification, restrict-only gate, bounded reflexion |
| Useful output in a 1 to 4 minute demo | 1 | Needs a storyboard and a rehearsed hero case |
| Document limitations clearly | 2 | Limitations block, guarantee-boundaries table |
| **Total** | **16 of 20** | Strong candidate on the organizers' scale, with the unvalidated items to close |

## Constraints (status)

Runs from a clean setup (designed); runs quickly and predictably (designed); light repository (checked by `scripts/repo_size_check.py`); no hardcoded outputs (the rule brain and cassettes serve recorded inputs only, and replay misses are errors); no committed keys (hook and scan); logs show how the agent worked (trace with `why`); sample inputs and outputs (planned); sponsor use documented (planned).

## The five statements

1. We understand the problem and the user: partly, pending the interviews.
2. We can access the data reliably: yes.
3. We can build a narrow working version with Zetaris and Meterless integrated: yes for the slice; Zetaris access depends on a trial account.
4. We can show agents doing real work: yes.
5. We can run it cleanly and explain it in a 1 to 4 minute demo: to be proven by the storyboard and a clean-room run.
