# Compliance Profiles

The product architecture (`00-architecture-master-spec.md`) is defined by capabilities and user workflows. External programmes (a hackathon, a funder) each have their own requirements. A **compliance profile** maps one programme onto the modules and records what that programme needs as evidence. A profile may add work; it never changes what the product fundamentally is. Selecting a track or programme is Prateek's decision, made later; nothing in the product depends on it.

## Profile A: Open Agent Hackathon 2026 (GenAI Works)

Sources: the public event page and its Official Rules (fetched 2026-10-13), the organizer documents received in the original folder, and the readout of public resources in `docs/intel/08` (local only). The Official Rules override every other source. Items marked NOT VERIFIED are unresolved; the lesson "How the Week Runs", which the course page calls the final authority on required technology, is login-gated and unread.

**Build window and eligibility.** 22 October 2026 00:00 UTC to 27 October 23:45 UTC. Work committed before the window is not eligible except clearly declared pre-existing components. Our rule: nothing is committed or pushed before the window opens, enforced by a hook. Time-zone rules do not extend the window.

**Tracks.** Each submission selects exactly one primary track; cross-track relevance is welcome but is not scored twice; the track can be changed before the deadline. The product is built so every track capability exists as a module:

| Track | Modules that carry it | Standalone entry point |
|---|---|---|
| Solving Fragmented Intelligence | M1 Source Fabric, M2 Document Intelligence, M3 Reconcile | `plumbline reconcile` |
| The Agent That Can Explain Why | M4 Explain, M9 Audit and Bundle, the evidence viewer | `plumbline explain` |
| Reasoning Architecture | M5 Decide, M6 Memory and Learning, M7 Runtime, M13 Case Lifecycle | `plumbline decide` |
| Wildcard [Tinkerer] | M12 sponsor adapters measured against the baseline profile | `profiles/baseline` versus `profiles/full` |

**Sponsor technology.** Zetaris and Meterless in every submission, and Cursor for development (Official Rules section 5). NVIDIA wherever it contributes; two in-kind prizes are named separately from the track prizes: "Best use of NVIDIA Nemotron" and "Best use of Cursor-built product", so both integrations are built to be demonstrable in their own right. Bright Data is not mentioned in the Official Rules; an optional bounty appears only in the course FAQ and is not planned unless HackOS confirms it. Grok Build appears in Zetaris press material in place of Cursor; Cursor stays required until HackOS says otherwise.

**Submission components.** A demo video of 1 to 4 minutes; a slide deck; a GitHub repository with a README (and Colab links if used); a clear explanation of how Zetaris and Meterless were integrated, how Cursor was used, where NVIDIA contributes and what was unique about the sponsor usage; a declaration of pre-existing components (`docs/submission/pre-existing-components.md`, to be created). Form fields and format limits are unpublished.

**Judging.** Out of 100: Impact 30, Technical 20, Innovation 15, Demo 15, Product and UX 10, Sponsor tech 10; ties go to Impact then submission timestamp; at least three judges. The three named judges are organizer staff; no sponsor judge is listed. Impact is scored against the track's challenge statement, which is held on HackOS and unread, so our Impact claims stay unaimed until Prateek supplies them.

**What past editions suggest (organizer's own history, mostly self-reported, NOT VERIFIED beyond the cited pages).** Winners built on the organizer's stack; they quoted the challenge statement; they picked one narrow user with real data; they proved claims; they shipped a complete runnable submission. For us that means: use the sponsors' technology deeply and verifiably, quote the challenge statement in the README and deck once it is read, keep the hero case narrow, and make every claim inspectable.

**Ambition level.** The organizers define three levels and say that Level 3 (High-risk) means a complex domain handled as a narrow prototype with a small curated dataset, strong caveats and a fallback mode. Plumbline sits at Level 3 (financial and security risk). We add rigour levels of our own on top, inside the same narrow slice: Level 4 Verifiable, Level 5 Measured, Level 6 General (spec section 1a). Level 3's condition of domain expertise is open: a procurement or risk practitioner is recruited as domain reviewer. The filled worksheet is `docs/plan/00-use-case-decision-worksheet.plumbline.md`.

**Rule 5 reminders.** No secrets anywhere (screenshots included); no real personal data; legal data only; sample data and a fallback mode so judges can run it with no manual setup; a bounded run (organizer target 5 to 10 minutes); logs of agent activity.

**Evidence the profile needs from the build:** the coverage matrix (`01-demand-traceability-matrix.md`, local), sponsor proof tests (spec section 19), per-phase runtime report, clean-room verification report, Cursor usage log with screenshots, generated engine-usage map, demo storyboard.

**Open questions for the organizers (`hackathons@genai.works` or HackOS):** whether pre-window uncommitted preparation is acceptable; whether Grok Build is accepted in place of Cursor; the Bright Data bounty status; whether Zetaris access is an administrator account on the shared event instance; submission form fields; whether Discord or HackOS is the operations venue; the prize structure (the Official Rules and the course page state different splits).

## Profile B: Research funding (grant)

Sources: `docs/design/02-research-contributions-and-grant-case.md` and `prior-art/15`.

**Shape.** Three pillars (verifiable evidence-to-decision explanations; reconciliation under conflicting evidence; safe decision governance), each with an anchor contribution, a benchmark, a reusable open module and published negative results. The programme question is how much of a consequential agent decision a stranger can verify without trusting the system, and where that stops.

**Requirements to meet (NLnet is the only funder read; others unread).** Open licences and open standards; disclosure of generative-AI use with a prompt provenance log kept from now; funded work centred on human-directed design, evaluation and review; reproducibility from a clean checkout; a written evaluation protocol; a safety case; data governance and licence clarity for every dataset; honest limitations. Regulatory language is coverage mapping only (no "AI Act compliant", SR 11-7 is rescinded and replaced by SR 26-2, scoping questions are for a lawyer).

**Evidence the profile needs from the build:** the contribution cards with pre-registered hypotheses, the novelty search log, the practitioner validation report (`04-practitioner-validation-plan.md`), released modules with licences, benchmark datasheets, the tamper corpus and verifier.

## Adding a profile

A new programme gets a section here with: its sources and their authority order, its requirements, how each maps to a module or artifact, what evidence it needs, what is unread or NOT VERIFIED, and the questions to ask its organizers. It never edits the architecture spec to bend the product.
