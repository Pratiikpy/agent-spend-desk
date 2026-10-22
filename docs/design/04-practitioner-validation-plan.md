# Practitioner Validation Plan

Purpose: test the product premise with the people who would use it, before it is presented as a solved problem. At the time of writing **no interview has been done**; the premise below is unvalidated and the product-validation score of the design is low until this plan is executed. This document is a plan and a protocol, not a result.

## Premise under test

At the moment a payment is released to a counterparty, no single step reconciles what internal master data, public registries and documents say about the counterparty's identity, ownership, status and bank details, so conflicting or stale facts reach the release decision unflagged. A tool that does this reconciliation, states what is verified, contested, unresolved or unchecked, applies the company's own rules, and leaves an independently verifiable record would change the workflow and be trusted enough to use.

## Hypotheses (each can be disproved)

- **P1 Problem exists.** Teams report incidents or near-misses where identity, ownership or bank-detail facts about a payee were wrong, stale or conflicting at release time.
- **P2 No owner at release.** Responsibility for reconciling those facts is split across onboarding, master data, treasury and compliance, with no single check at release.
- **P3 Existing tools leave a gap.** Current tooling (ERP controls, three-way match, vendor-master workflows, sanctions screening, third-party-risk platforms, KYB services) does not cover cross-source conflict handling at release time, or covers it with unacceptable false-hold cost.
- **P4 Trust requires evidence.** Reviewers would rely on a machine-assisted recommendation only if they can open the source passage behind each claim and see what was not checked.
- **P5 Verifiable records matter.** Internal audit, external audit or regulators ask for decision records that a third party can re-check, and current records do not allow it.
- **P6 Over-caution is a cost.** False holds have a material cost (late payment, supplier friction), so a system that holds everything would not be adopted.

## Who to interview

Roles: accounts-payable managers, procurement and sourcing leads, treasury and payment operations, vendor-master data owners, third-party-risk and compliance analysts, internal auditors, fraud and financial-crime investigators, ERP and finance-systems administrators. Target at least 15 interviews across at least 3 company sizes and 3 sectors, with at least 4 roles represented, so no conclusion rests on one organisation. Record company size, sector, ERP and tooling in use. Avoid interviewing only people we already know.

Recruitment: professional networks, relevant practitioner communities and conferences, direct outreach with a short description that does not lead the witness. No payment to participants that could bias answers; offer to share the anonymised findings.

## Ethics, consent and data handling

Informed consent before recording; participants may skip any question and withdraw at any time; interviews are recorded only with consent, otherwise notes. No confidential company data is requested; participants are asked to describe patterns, not name counterparties or share documents. Store notes and transcripts under pseudonymous ids, outside the repository; only anonymised quotes with consent appear in any public document. For a funded study, obtain ethics review or a written exemption from the funder's or an institution's process before starting; this is an open item (a lawyer or ethics board is needed, not decided here).

## Interview guide (semi-structured, about 45 minutes)

1. Context: role, team, systems, volume of payments, thresholds that trigger extra review.
2. Walk through the last time a new or changed payee was onboarded or paid. Who did what, with which system and which sources?
3. When have you seen, or nearly paid, the wrong party or the wrong account? What was the cost? How was it caught?
4. Which facts about a counterparty do you check, from where, and how often? What do you do when two sources disagree? What do you do when a source is silent or unavailable?
5. What do your sanctions and ownership checks produce, how many alerts are false, and who clears them? How long does a review take?
6. What happens when a rule says hold and the business wants to pay now? Who can override, and how is it recorded?
7. What would an auditor or regulator ask to see after a disputed payment? How easy is it to produce?
8. Which tools do you use for any of this today, what do they miss, what do they cost, and why did you choose them?
9. Concept test (run by an independent interviewer, not the builder, to limit confirmation bias; after the above, to avoid leading): show a storyboard of a case with a reconciled truth table, claim evidence view and a decision with reasons. What would you trust, not trust, or need to see? What would make you ignore it? What would you do differently if it said "unresolved"?
10. Adoption: who would own it, what integrations are required, what security and data-handling review would it face, and what level of automation would you allow?

Ask for specifics and recent examples; probe for counter-evidence ("tell me about a time this was not a problem").

## Domain reviewer (Level 3 condition)

The organizers' High-risk level asks for domain expertise on the team. Separately from the interview sample, recruit at least one procurement, accounts-payable or third-party-risk practitioner as a named domain reviewer who reviews the policy rules, the gold-set scenarios, the dossier wording and the limitations block, and whose review is recorded (with consent) in the evidence for the submission and the grant.

## Analysis and outputs

Pre-register the codebook before the first interview. Two coders code every transcript; the agreement threshold is Cohen's kappa of at least 0.7, otherwise the codebook is revised and recoded. Code transcripts against P1 to P6, the null and adoption hypotheses below, and emergent themes; log every claim with its interviewer and context. Report, per hypothesis, the count of participants for, against and silent, with their roles and sector, never a single percentage from a small sample without its count. Keep a quote log of disconfirming evidence. Deliverables: `docs/design/prior-art/18-practitioner-validation-report.md` (anonymised) and an updated premise statement.

## Decision rules (written before any interview)

- If fewer than half of the interviewees in each of at least two sectors report P1 or P2 (counted per sector, not pooled), the problem framing is revised before the grant case is written.
- If P3 fails (existing tools already cover the gap), the product position moves to what remains uncovered (for example verifiable records, the explanation, or the injection-safe gate) and the claim of a missing owner is dropped.
- If P6 dominates (false holds are intolerable), selective release and over-caution metrics become primary success criteria, ahead of detection rate.
- Any hypothesis not supported is reported as such in the grant case.

## Null and adoption hypotheses

- **N1** The problem is real but is already handled adequately by existing controls and tools (the null for P2 and P3).
- **A1** The buyer is identifiable and has budget (who pays: AP, procurement, risk, compliance, internal audit).
- **A2** Integration with the ERP, vendor-master and identity systems is feasible within the buyer's security review; record the blockers named.
- **A3** The reviewers who would use it accept a recommendation with evidence at the volumes and thresholds they operate.

## Feasibility and fallback

Fifteen unpaid 45-minute interviews with payments and risk professionals across three sizes and three sectors is a target whose feasibility is **NOT VERIFIED**. Fallback sample: at least 8 interviews across at least 2 sectors and 3 roles, reported as exploratory with the gap stated; supplement with public sources (regulator guidance, audit reports) clearly labelled as not practitioner evidence.

## Limits

Small, self-selected samples; stated practices differ from actual practice; interviewees may be reluctant to discuss incidents; our concept test shows a design, not a working product. The plan produces evidence about need, not about system performance, which is measured separately.
