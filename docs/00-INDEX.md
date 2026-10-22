# Documentation Index

Start here. Every file is named for what it holds; numbered files are meant to be read in order.

## What the organizers, judges and sponsors want (`docs/intel/`, local only)

| Read | File | Answers |
|---|---|---|
| 1 | `intel/01-what-judges-and-organizers-like-and-discount.md` | What do they reward, what do they discount, how is it scored? |
| 2 | `intel/02-how-organizers-propose-we-build-and-plan.md` | Their method: APPROACH, ambition levels, build rhythm, loop spec, pairings, runtime budget |
| 3 | `intel/03-sponsor-by-sponsor-expectations.md` | Zetaris, Meterless, Cursor, NVIDIA, Bright Data: requirement, role, unknowns |
| 4 | `intel/04-rules-deadlines-and-hard-constraints.md` | Organizer schedule (record only), eligibility, tracks, tech rules, submission, security |
| 5 | `intel/05-prizes-and-payouts.md` | Prize table and what is not stated |
| 6 | `intel/06-source-gaps-and-discrepancies.md` | Conflicts and missing material found in the originals |
| 7 | `intel/07-instructor-and-checkin-slides-takeaways.md` | What the Day 4 slides teach (other cycle, methodology only) |

## Organizer originals (`docs/event/`, local only, read-only)

`01-welcome-guide.md` · `02-faq.md` · `03-participant-journey-map.md` · `04-approach-guide-solutioning.md` · `05-day4-weekly-checkin-slides-OTHER-CYCLE.pdf`

## Plan and design

| File | Purpose |
|---|---|
| `plan/00-use-case-decision-worksheet.md` | Choose the use case: organizer worksheet and self-score, plus our tests |
| `plan/01-milestone-plan.md` | Quality-gated milestones M0 to M9; no dates, no time limit |
| `design/modules/00-conventions-and-shared-types.md` | Blueprint template, reference rules, shared types and name tables every module uses |
| `design/modules/01-...` to `14-...` | **Fourteen implementation blueprints**, one per module: best references, what they actually do, adopt/adapt/own, implementation design, tests, risks (source fabric; documents; reconcile; explain; decide; memory; runtime; security; audit and verifier; interfaces and UX; evaluation and data; Meterless engines and sponsor adapters; case lifecycle and broker; agents and models) |
| `design/modules/99-integration-register.md`, `99b-integration-register-pass3.md` | 65 + 58 resolved contradictions between blueprints, shared-type changes, corrected build order, decisions for Prateek |
| `design/00-architecture-master-spec.md` | **The architecture (v5.2)**: product and 14 modules, security layer, runtime, reconcile, explain, decide, memory, audit bundle, interfaces, agent roster, data, evaluation, governance, sponsors, build order, closures |
| `design/01-demand-traceability-matrix.md` | Every organizer demand (203 in the current refresh) traced to a module and test; gaps and fixes (local only, quotes organizer material) |
| `evaluation/reviews/2026-10-13-architecture-v3-adversarial-review.md` | Adversarial review of spec v3: 72 findings (2 P0, 24 P1, 46 P2) with fixes; answered in D-012 (local only) |
| `sponsors/ai-use-provenance-log.md` | Dated record of generative-AI use for funders; transcripts archived privately |
| `design/02-research-contributions-and-grant-case.md` | Three research pillars, 17 falsifiable contributions with anchor cards, novelty search protocol, reusable open modules, funder mechanics, risks |
| `design/03-compliance-profiles.md` | Hackathon and grant requirements mapped onto the modules; open questions for organizers |
| `design/04-practitioner-validation-plan.md` | Interview protocol to test the product premise; decision rules; ethics |
| `sponsors/meterless-docs-readout.md`, `sponsors/zetaris-docs-readout.md` | Everything the sponsors' own documents say, 29 and 18 integration ideas judged on product benefit |
| `intel/08-public-genai-hackathon-resources-readout.md` | Official Rules text from the public event page, past winners, conflicts with our organizer documents (local only) |
| `intel/09-participant-setup-guide-readout.md` | Setup Guide of 2026-10-15: local Zetaris, Nemotron, sponsor access steps (local only) |
| `intel/10-public-github-repos-mentioning-the-hackathon.md` | Public repositories that mention the hackathon (local only) |
| `intel/12-how-the-week-runs-key-facts.md` | Key facts from the organizers' rulebook lesson "How the Week Runs" (verbatim copy in `event/07-how-the-week-runs-lesson-2026-10-17.md`): one primary track, Nemotron through Meterless, submission checklist, prizes (local only) |
| `intel/11-escalation-path-readout.md` | Organizers' escalation path: where to route sponsor, build, rules and security issues; severity and timing (local only) |
| `design/07-product-requirements-and-feature-list.md` | The PRD and feature list (v3.0, aligned to spec v5.3): goal and mindset, users, hackathon requirements mapped to the product, features by tier with gates, non-functional requirements, success measures, rubric mapping |
| `design/modules/98-profile-pass-additions.md` | Per-module additions from the 56-repository profile pass (adoption register ids); read after each blueprint |
| `design/prior-art/profiles/` | 56 per-repository profiles (architecture, features, real use, mechanism, agent patterns, model and data layer, hackathon-care checks, traps, reuse, verdict), each spot-checked; `98-roster-and-reader-comparison.md` lists them with the reader comparison; `99-synthesis-best-of-by-module.md` is the adoption register |
| `design/05-agent-behaviour-matrix.md` | Every organizer collaboration pattern (nine checklist, seven strong, four pairings) and our additions, each with a role, a trace event and a test |
| `design/06-technical-constraints-compliance.md` | Every organizer technical constraint mapped to its implementation and an automated gate |
| `plan/03-hackathon-fit-check.md` | Fit of the idea to the hackathon, requirement by requirement, with the organizer self-score of the plan (16 of 20) and a 2026-10-16 update |
| `sponsors/zetaris-local-setup.md` | Zetaris local install steps and facts (registry credentials live only in `.env`) |
| `design/prior-art/2026-10-17-market-and-demand-evidence.md` | Market and demand pass: who sells parts of the gate, what nobody was found to do, sourced incidents, regulation, evidence gaps (D-027) |
| `design/prior-art/2026-10-17-best-in-world-check-kernel-parts.md` | Best-in-world check of each kernel part: products, new repositories, papers, what to copy, beat and watch, and the open runtime decision |
| `design/prior-art/2026-10-18-vertical-and-research-agents-study.md` | Study of vertical agents (Elicit, Consensus, Perplexity, Harvey) and nine open-source research agents: what REA could and could not show, what to copy and beat, and the PRD v2.0 additions |
| `design/prior-art/2026-10-18-pain-evidence-from-video.md` | Prior-authorization pain from public videos, with the primary sources to verify |
| `design/prior-art/2026-10-18-rival-teardown-trust-and-action-gating.md` | Teardown of ActionRail, rubric-attest, Originary Agent Auditor, Keypost and others: what they check, what they say they do not, what we take |
| `design/prior-art/2026-10-18-adhd-divergent-ideas.md` | Divergent-ideas run on whether the Decision Desk is the best idea: clusters, the Policy Twin, the clearing house and the compiler |
| `design/prior-art/2026-10-19-top-repos-pattern-study.md` | Study of the fastest-rising repositories in five groups (agent superpowers, skills, graphs and dashboards, sourced guides, decision models): hooks, gaps, holes found in the closest rival checks, and the PRD v3.0 additions |
| `design/prior-art/16-citation-check-report.md`, `17-claim-matrix-from-deepwiki.md` | Citation check of arXiv ids; DeepWiki claim matrix (leads, partly corrected by the profile pass, spec section 21a-5) |
| `design/prior-art/01-...` to `06-...` | Teardowns of the 38 reference repos, each ending in what to adopt and beat (graph and reconciliation; data channels and Agent Reach; research agents; verification methods; memory and decision; orchestration) |
| `design/prior-art/07-...` to `15-...` | Verified research per module: data fusion; explanation and counterfactuals; policy, calibration, precedent; agent security and evaluation; memory and learning; multi-agent design and protocols; provenance and replay; documents and evidence UI; procurement domain and governance |
| `sponsors/meterless-engines-engineering-brief.md` | Exact contracts and conformance invocations for the four Meterless engines, mapping to our product, evidence plan |
| `design/agent-pairings.md` | Planner+Doer, Proposer+Critic, Packer+Actor, Weaver+Synthesizer |
| `templates/agent-loop-spec.template.md` | The 8-line loop spec, made buildable |
| `templates/project-readme.template.md` | README skeleton that satisfies the submission requirement |

## Sponsors (`docs/sponsors/`)

`zetaris-integration-notes.md` · `meterless-integration-notes.md` · `nvidia-integration-notes.md` · `bright-data-integration-notes.md` · `cursor-usage-log.md`. Verified-facts tables stay empty until filled from a cited source.

## Submission (`docs/submission/`)

`submission-checklist.md` · `demo-video-script.template.md` · `slide-deck-outline.template.md` · `sponsor-technology-explanation.template.md`

## Evaluation

`evaluation/judging-rubric-and-self-scoring.md`. Saved reviews go to `evaluation/reviews/YYYY-MM-DD-<scope>.md`.

## Living records

`DECISIONS.md` (append-only decision log) · `open-questions.md` (close with answer, source, date).

## Naming rules

`NN-topic-purpose.md` ordered references · `<thing>.template.md` templates · `<sponsor>-integration-notes.md` · `YYYY-MM-DD-<scope>.md` dated records. Never `notes.md`, `misc.md`, `final2.md`.
