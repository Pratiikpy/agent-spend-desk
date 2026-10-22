# Decision Log

Append-only. One entry per decision that would be expensive to rediscover. Newest at the bottom. Format: context, decision, alternatives considered, consequences, evidence.

---

## D-001 · 2026-10-13 · Repository holds no commits before the window opens

> Annotation: D-012 reverses the rejected alternative: all pre-window work is declared as pre-existing.

**Context.** "Work committed before the build window opens is not eligible, except for clearly declared pre-existing components." (`docs/intel/04-rules-deadlines-and-hard-constraints.md`). Window opens 22 Oct 2026 00:00 UTC.

**Decision.** Do not commit or push anything before that time. Building locally is fine and encouraged; it stays uncommitted. A hook blocks `git commit` and `git push` until the window opens.

**Alternatives.** Commit the scaffold and declare it as pre-existing. Rejected: it adds a declaration burden and invites questions for no benefit.

**Consequences.** `git init` happens on or after 22 Oct. Organizer material under `docs/event/` is gitignored regardless (it is the organizer's, not ours).

**Evidence.** FAQ §5; hook `.claude/hooks/window_guard.py`.

---

## D-002 · 2026-10-13 · Cursor is the real IDE; Claude Code is an assistant

**Context.** Cursor is a required development environment and the submission must explain its use.

**Decision.** Work in Cursor; keep `docs/sponsors/cursor-usage-log.md` current each session; mirror project standards into `.cursor/rules/`.

**Consequences.** Claude Code sessions are fine for generation and review, but cannot substitute for Cursor in the evidence.

**Evidence.** FAQ §5, §7.

---

## D-003 · 2026-10-13 · Track, use case and stack are NOT decided

**Decision.** Left open on purpose; they are Prateek's. See `docs/open-questions.md` Q1–Q4. Scaffolding contains no application code, so nothing is pre-committed to a track.

---

## D-004 · 2026-10-13 · Internal working docs stay out of the public repo

**Context.** The repo is public and judged; organizer material and internal planning are not ours to publish and would look out of place.

**Decision.** Gitignore `docs/event/`, `docs/intel/`, `docs/open-questions.md`, `docs/evaluation/reviews/` and `docs/plan/days/`. They remain on disk as the team's working memory. Plan, design, sponsor notes, submission kit, rubric and templates are committed.

**Alternatives.** Commit everything. Rejected: republishes organizer content and exposes unfinished internal notes.

**Consequences.** Local-only files are not backed up by git; keep the folder backed up separately. Reverse by editing `.gitignore` if the organizers say it is fine.

---

## D-005 · 2026-10-13 · No time limit, no build limit

**Context.** Prateek's primary goal is the best possible product; submitting is secondary. Standing instruction: remove the deadline, do not ask about it, do not re-raise it.

**Decision.** Plans, designs and recommendations are for the best product, never trimmed for a deadline, effort or size. Every other hackathon rule still applies in full. The only date that binds us is the commit gate in D-001.

**Consequences.** `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, the skills and the plan carry no deadlines or countdowns. The milestone plan (`docs/plan/01-milestone-plan.md`) is gated by quality evidence, not dates. The organizers' schedule survives only as a labelled record in `docs/intel/`.

---

## D-006 · 2026-10-13 · One product spans all three tracks; Track 3 is the registration track

> Annotation: the registration-track part was withdrawn by D-010; the product direction stands.

**Context.** Prateek: build one serious, large product that covers Tracks 1, 2 and 3 "in the best possible way", compared against the best open-source work, "everything our own". This supersedes D-003 for direction (track, use case); he delegated the choice ("now it's your turn to make the best"). Registration still needs exactly one primary track, and he performs the HackOS action.

**Decision.** Working name **Plumbline**: a counterparty-release decision system. Given a purchase order or onboarding case for a vendor, it (1) reconciles conflicting records across internal and public sources (Track 1), (2) explains every conclusion with mechanically verified evidence and a counterfactual (Track 2), and (3) decides under policy rules plus precedent memory with an approval gate (Track 3). Register under Track 3 (Reasoning Architecture), because the decision is the product and Tracks 1 and 2 are its first two stages. The name is a placeholder.

**Alternatives.** Register under Track 1 or 2 (the same system, narrower story); healthcare triage (no legitimate real data; synthetic only); a Gemini-drafted "ARBITER-OS" concept (kept as an idea source: its H-MEM / Markovian names match real Meterless engines, but its sponsor claims are unsupported, see `docs/intel/06`).

**Consequences.** Every module is judged against the Track 1, 2 and 3 repos in `research/`. Judges still score one track, so the demo must lead with the decision. Revisit the registration track on or after 22 Oct once Prateek has seen the finished product.

---

## D-007 · 2026-10-13 · TypeScript on Node, no agent framework, no build step for the UI

> Annotation: revised by D-011 (execution substrate chosen by bake-off; JSON Schema instead of a custom validator) and D-012.

**Context.** Meterless engines are specs with TypeScript references and conformance suites (`research/sponsor-reference/Meterless`, Apache-2.0); Node 22 is installed; the repo must run for a judge with one command and no runtime installs.

**Decision.** Single TypeScript codebase (strict mode, ESM) run with `tsx`; schemas validated at runtime; no LangGraph/CrewAI/AutoGen dependency (our own orchestration runtime with budgets, record/replay and JSONL traces); UI served as static files with no bundler. Python stays only for the existing guard scripts.

**Alternatives.** Python with FastAPI (richer NLP ecosystem, but no direct path to the Meterless references and conformance runners); a framework such as LangGraph (hidden nondeterminism, lock-in, less control over budgets).

**Consequences.** The Meterless H-MEM, World Model and Markovian engines are implemented in our code and proven by their own conformance runners. Disk is tight, so dependencies are few and `node_modules` stays out of the repo.

---

## D-008 · 2026-10-13 · Data comes through an Agent-Reach-style source-channel layer

> Annotation: Zetaris access is REST and JDBC first with MCP as a fallback (D-011); Bright Data is dropped unless HackOS confirms a bounty.

**Context.** Prateek: "for data we will use what the Agent Reach repo is doing". Agent Reach routes to the best backend per platform, health-probes each backend for real, and reports through a doctor command.

**Decision.** Build a `source channel` layer: one contract per source (`canHandle`, `read`, `search`, `check`), tiered by setup effort, ordered backends with real probes, a doctor report with credential scrubbing, URL safety checks, a content-addressed cache and record/replay cassettes. Live public sources verified reachable on 2026-10-13: GLEIF LEI API, SEC EDGAR submissions, Wikidata, Jina Reader, OFAC sanctions list export (redirects). Internal "silos" are synthetic and served through a Zetaris adapter (real MCP/JDBC when credentials exist, embedded fallback otherwise).

**Consequences.** Detailed in `docs/design/prior-art/02-data-channels-agent-reach-and-connectors.md`. Bright Data is not part of the core (bounty-only); the channel layer lets it be added as one more backend later.

---

## D-009 · 2026-10-13 · Outside audit (GPT, Gemini): what was accepted and what was not

> Annotation: the sponsor-requirement reading in this entry (Wildcard only) was corrected by D-011 and `docs/intel/06` items 10 to 14: the Official Rules require Zetaris, Meterless and Cursor in every submission. The runtime default stays custom in this entry; D-011 and D-012 replace that with a bake-off. The runtime bake-off is described in spec sections 4 and 19a, not section 5.

**Accepted.** One primary track, Reasoning Architecture (the event page says "Pick one track"). Executable sponsor proof, with Nemotron as the default of a sponsor profile. No source bodies committed before reuse terms are verified. Authority per attribute, a full evidence record, uncollapsed fetch states. The six verification checks kept separate and the counterfactual wording narrowed. Replay defined narrowly. A document-ingestion decision made by measurement. Threat model against the OWASP agentic list. Gold set before prompt tuning, with long-context and rules-only baselines.

**Rejected, with reasons.** (1) Replacing the custom runtime with LangGraph.js or Temporal as the default: our teardown found re-executed side effects on resume, after-the-fact token caps and hidden routing, and Temporal needs a server, which breaks one-command judge runs. Instead a published bake-off on one reference case decides (see spec section 5). (2) "Overcommitting" as a reason to shrink: there is no build limit (D-005); instead each feature is claimed only if its ablation shows it matters. (3) Dropping our own Meterless engine implementations: Meterless's own docs ask for spec-driven implementations proven by conformance suites, and the reference is documented as not a production library; we add the official reference as a differential oracle and ablations. (4) Replacing the validator rationale with "use a library": kept our own, with golden-hash tests, revisit if its tests expose defects.

**Unverified claims in the audit.** That the product "runs on Nemotron directly or through Meterless" was not found on the fetched pages; the event page lists Zetaris and Meterless as required for the Wildcard track only, our organizer FAQ says every submission (`docs/intel/06`, item 9). Treated as: use all of them for real.

**Superseded in part (D-010).** The "one primary track" acceptance above and D-006's "register under Track 3" are withdrawn as decisions: Prateek said (2026-10-13) that track selection is his, to be made later, and must not be raised. The product is built so each track is a module.

**Name.** Plumbline stays the working name (used throughout the specs); the VERDICT OS blueprint from another chat is a different draft and is not merged. Rename is one search-and-replace if Prateek prefers it.

---

## D-010 · 2026-10-13 · Track selection is Prateek's, made later

**Context.** Prateek (2026-10-13): "dont care about track selection, I will decide later"; the goal is one product so dense that each track is a module and every organizer demand is covered.

**Decision.** Track selection and registration are not discussed, asked about or decided in the design. D-006's "register under Track 3" and D-009's "one primary track" acceptance are withdrawn as decisions. Tracks appear only as compliance-profile metadata (`docs/design/03-compliance-profiles.md`). The Official Rules do require exactly one primary track per submission and allow changing it before the deadline, so the choice stays open until Prateek makes it.

**Consequences.** Instruction files say "never raise it". The product is organised by capability and workflow, not by track.

---

## D-011 · 2026-10-13 · Second outside review (two models): architecture v3

**Context.** Prateek had the architecture, the traceability matrix and the grant case reviewed by two other models and asked for a critical analysis to make the architecture the best, with no time or build limit. Each point was checked and judged on whether it improves the product.

**Accepted and applied (spec v3).**
- **Trust-propagation bug (P0), confirmed.** v2 said `tier(derived) = min(inputs)` over labels where T4 was the least trusted, which reads the wrong way round, and it also treated "deterministic derivation" as a trust level. Replaced by a four-level lattice (`SOR`, `VERIFIED`, `EXTRACTED`, `UNTRUSTED`) with a `combine` meet, derivation as a separate attribute, authority and factual support as separate attributes, and exhaustive property tests (spec section 5).
- **Kernel plus domain packs.** The root abstraction is a decision-intelligence kernel; procurement counterparty release is the first complete pack; generality is tested by a second small pack. Hackathon, sponsor and funder requirements moved to compliance profiles (`docs/design/03-compliance-profiles.md`).
- **Three research pillars** for the grant (all 17 contributions kept as roadmap); contribution cards with disconfirming results; a novelty search protocol; "exact value of information" renamed decision-relevant evidence-gap analysis; sample-size assumptions stated (246 versus 385).
- **Guarantee boundaries** table (integrity, attribution, epistemic status, decision correctness, explanation exactness), and provenance kept in separate dimensions including authenticity.
- **Foundations bake-offs before building** (runtime substrate, policy engine, entity matching, PDF parser, embedded store, Meterless engine strategy, structured output). The runtime becomes two layers: our kernel contracts (effects, budgets, trace, gates, trust propagation) and an execution substrate chosen by measurement; a LangGraph.js hybrid is the expected result. This revises D-009's "default stays custom".
- **Validator reversed.** The custom `Schema<T>` is dropped in favour of JSON Schema with a schema-first TypeScript library and a pinned strict validator, schema documents hashed under JCS with golden-hash tests. The abandoned starter code is discarded. It was a worse choice than a standard (exportable to MCP, checkable from any language).
- **Case lifecycle and action broker (M13)**, outcome feedback, and a list of enterprise operations designed now and built after the core.
- **Over-caution measured with safety**; AgentDojo, promptfoo and Inspect AI reused as foundations; OpenSanctions data licence (CC BY-NC) recorded; practitioner validation plan written (`docs/design/04-practitioner-validation-plan.md`).
- **From the sponsor and organizer readouts:** Zetaris REST and JDBC first with MCP as fallback; role-scoped masked views; Scout contracts capability-scoped, asymmetric and single-use; pinned replayable retrieval; data classes with an egress manifest; inert controls; Markovian never across counterparties; the Official Rules require Zetaris, Meterless and Cursor and name in-kind prizes for Nemotron and Cursor use; Bright Data is not in the Official Rules (bounty dropped unless HackOS confirms).

**Rejected, with reasons.**
- Myers diff or other tolerant alignment for quote verification (could pass a near-fabricated quote); a diff library may report disagreement between two extractors only.
- Copying SAFE's prompts or the Generative Agents retrieval formula (our design differs on purpose; research showed their defects).
- Temporal as the default (needs a server and workers, so a judge cannot run it with one command); it remains a candidate in the bake-off only if that changes.
- Two competing truth stores (Graphiti is a behavioural baseline, not a second store). DuckDB is a candidate for raw source tables only.

**Reviewer errors noted.** One review named `investigativedata/nomenklatura` and `google-deepmind/search-augmented-factuality-evaluator`; neither exists (the real ones are `opensanctions/nomenklatura` and `google-deepmind/long-form-factuality`, verified 2026-10-13).

**Consequences.** Spec v3 supersedes v2. Next architecture work: re-run the coverage matrix against v3 and the Official Rules facts, then await Prateek's green signal before any build.

---

## D-012 · 2026-10-13 · Adversarial review of v3: findings accepted, spec v3.1

**Context.** An independent adversarial review of spec v3 (`docs/evaluation/reviews/2026-10-13-architecture-v3-adversarial-review.md`, gitignored) found 72 issues: 2 P0, 24 P1, 46 P2. Each was checked against the spec and the research; the P0 and P1 findings were all accepted and the spec was revised to v3.1.

**P0 fixes.**
- **Suppression/steering (SEC-01).** Restrict-only does not cap an injection at "escalation": an injection can make the extractor omit a hold-relevant fact, which loosens the outcome with no added fact. v3.1 requires a positive manifest of release-enabling facts from `SOR` or `VERIFIED` channels (absence of a required document-derived fact is a hold), double extraction for hold-relevant signals, a new attack family `SEC-I18` with a benign-twin oracle, and a guarantee reworded to what is actually true.
- **`SOR` and human confirmation (SEC-02).** "Human-confirmed" is removed from `SOR` (a click on an untrusted value is the social-engineering path), vendor-master writes carry provenance, and a typed out-of-band attestation creates a new `VERIFIED` fact bound to the exact value.

**P1 fixes (selected).** Lattice semantics, a (source, attribute, producer) level table, propagation tests instead of vacuous algebra tests, `authorship` and a `self_declared` tier, account and amount as `SOR` only plus attested `VERIFIED` events, a join-propagating confidentiality lattice with one vocabulary, the judge's recommended action as a ceiling, compartment enforcement mechanisms; RS/MRS/MF definitions and edge locality, one normative `unresolved`, Dung semantics as an optional layer; exhaustive enumeration against the real interpreter as the primary evidence for invariants, independent-draw validation of the selective-release bound; verifier split into a zero-dependency core and a recompute module, relying-party pins required for PASS, an `--evidence-dir` mode; bounded identity-hypothesis enumeration; an ownership split between our effect layer and the substrate; Sponsor and evaluation model profiles; a minimum viable Zetaris integration that needs only read access; circular-evaluation fixes with external anchors; optional layers gated by an ablation; extra guarantee-boundary rows and a wording lint.

**Reversal.** D-001 had rejected declaring pre-window work as pre-existing to avoid the declaration burden. v3.1 reverses it: a first commit after the window containing months of earlier work reads as pre-existing code, so all pre-window code is declared, a dated authorship log is kept, and history is not squashed or backdated. The build waits on the organizer's written answer.

**Operational findings.** The development drive repeatedly fell to near-zero free space; disk is freed under the standing procedure before any build. The prompt log and Cursor log did not exist; they are created (`docs/sponsors/ai-use-provenance-log.md`).

**P2 findings.** Mostly applied in the same revision (wording, cross-references, impact-figure definitions, replay classes, `why_kind`, erasure receipts, TOCTOU, key custody, evaluation toolchain tier, role-necessity design); the remainder are tracked in the review file.

**Consequences.** The architecture is more honest about its guarantees and carries explicit acceptance lines per module (spec section 21b). No build starts until Prateek gives the green signal.

---

## D-013 · 2026-10-13 · Build everything; own every component; per-component blueprints

**Context.** After the organizer guide's Level 3 ("narrow prototype, not a platform") was pointed out, Prateek decided (2026-10-13): "I don't want narrow, I want to do all things", and that each component will be owned: for each one, study the best research paper or repository that does it, then specify how it is implemented in this project.

**Decision.** The build covers every module, not a reduced slice. The submission slice in spec section 1a defines only how the product is presented and scored (the demo, README and deck lead with one hero case; breadth is shown as architecture and roadmap). Each component gets an implementation blueprint under `docs/design/modules/` following `00-conventions-and-shared-types.md`: best references (verified), what they actually do, adopt/adapt/own decision, implementation design, tests, risks.

**Consequences.** Fourteen blueprints (modules 01 to 14) are written and cross-checked before any build; the organizers' warning about under-delivering at Level 3 is recorded as a risk, answered by depth, proof and the module acceptance gates (spec section 21b) and by a presentation rule, not by cutting scope.

---

## D-014 · 2026-10-13 · Architecture v4.1: fourteen module blueprints, integrated and reconciled

**Context.** Per D-013, fourteen implementation blueprints (`docs/design/modules/01-*.md` to `14-*.md`) were written in parallel, each grounded in verified research and the cloned reference code, without seeing the others. An integration pass compared them against spec v3.1 and against each other.

**Process and result.**
- Pass 1 (`docs/design/modules/99-integration-register.md`): 65 conflicts (4 P0, 38 P1, 23 P2) with resolutions, a shared-types change list, new guarantee-table rows and a corrected build order (eleven ordering violations). Spec rewritten to v4.0 and the shared types replaced.
- Every blueprint was patched in place against the register (revision block at the top; each Spec-feedback item marked resolved or open).
- Pass 2 (`docs/design/modules/99b-integration-register-pass3.md`): 58 further contradictions found by the patches (1 P0, 18 P1, 39 P2) resolved; spec at v4.1; each blueprint carries an appended 'Pass 3 resolutions' section that wins over its body until folded in.

**The four P0 outcomes.** One locator unit (code points, with UTF-8 byte offsets as a verifier cross-check); one release capability (`ExecutionContract` with `ReleaseBinding`, single verification order, consume last); the permission matrix applied through full labels instead of a numeric trust level in the policy core (and extended in pass 2 to assertions and fused facts); one owner for the verdict function V(S).

**Still open (named, not hidden).** Zetaris behaviour (needs a trial account), model-endpoint facts (needs a key), measurements of every budget and threshold, the verifier-size budget, Windows durability, the second-pass pairs listed in spec section 21c, legal items, the namespace for predicate URLs, and organizer answers (pre-window work, Grok Build, Bright Data).

**Consequences.** The architecture is the spec (`docs/design/00-architecture-master-spec.md`, v4.1) plus the fourteen blueprints plus the two registers. Nothing is built; build starts only on Prateek's green signal, in the order of spec section 20.

---

## D-015 · 2026-10-14 · Third outside review (Gemini, eight subsystem upgrades): accept, adapt, reject

**Accepted or adapted (spec v4.1 additions).** An SMT or MaxSAT encoding as a second oracle for the explanation function V, as a bake-off candidate (bake-off 9), not a replacement for the component-tabulation enumeration the offline verifier can check. Exact correlation clustering with cannot-link constraints as a bake-off 3 candidate, deterministic, small components only. Related-party multi-hop graph analysis, as deterministic bounded traversal in M3 with explainable paths (Personalized PageRank only for ranking), not as a replacement for precedent retrieval. Online risk monitoring beside the existing anytime-valid promotion test, as a drift alarm that demotes the autonomy ladder. A mandatory render-and-OCR check on every decision-bearing span and Unicode confusable and bidi detection as findings. SES and LavaMoat as an experimental hardening configuration. A sparse-Merkle verifiable map kept on the roadmap behind a concrete failing claim.

**Rejected, with reasons.** Biscuit tokens as the release capability: the blueprints already weighed it and rejected it (a second policy language and a WebAssembly dependency; offline attenuation by intermediate parties widens who can act, the opposite of a single-use, audience-bound capability; and Scout's contract format must stay the sponsor-facing mechanism). Stripping bidi controls from the text layer (it would break locator fidelity; they are reported, not removed). Replacing precedent retrieval with HippoRAG (wrong layer; the need is relationship discovery, which belongs in M3). Replacing the policy-and-LTT design with online conformal control (the guarantee is long-run average and needs labels that are delayed and censored in payments; it is added for monitoring, not as a substitute). SES as proof of isolation (JavaScript has no in-process security boundary against native or WebAssembly exploits; process isolation stays).

**Review inaccuracies noted.** The review described v4.1 as using a black-box oracle for explanations (M4 already decomposes the cone into components and tabulates them; hitting-set search is the fallback), as lacking ToUnicode defences (M2 has a glyph-remap defence and an OCR level), as using a post-hoc transitivity audit (cannot-link is enforced inside clustering), and as ranking memory by decay factors (time decay on precedents was rejected). Its claims of mathematical guarantees and of closing every vulnerability are not supported; no component here is claimed to do either.

---

## D-016 · 2026-10-15 · Fourth outside review ("v5.0 absorb the trending repositories"): what is kept, what is not

**Context.** A review mapped trending agent repositories onto our modules (Agent-Reach, PageIndex, RAGFlow, Graphiti, Splink, DeerFlow, claude-mem, Hermes Agent, OpenClaw, everything-claude-code, superpowers, Firecrawl) and proposed a "v5.0". Repository existence was checked with `gh api` on 2026-10-15: all named repositories exist at very high star counts except three names that do not resolve as written (a PDF-detector repository, a clingo-wasm repository under that owner, and a ByteDance DeerFlow path; the real one is `bytedance/deer-flow`). Firecrawl is AGPL-3.0, so its code is never copied. celestiaorg/smt is archived and cedoor/sparse-merkle-tree has had no push since 2021.

**Kept (spec v4.2).** A deterministic document tree with a cross-reference follower (PageIndex pattern; model summaries are aids, never evidence). A three-layer progressive-disclosure memory interface (claude-mem pattern) for agents and MCP. Entity-link candidate generation for precedents (HippoRAG-style bounded walk), gated by an ablation. Certified playbooks as proposals with the existing holdout certificate (Hermes-style skills, never silent overwrite). A risk-lexeme sentinel with windowed extraction against suppression (SEC-I18). The organizers' autonomy vocabulary (Macro, Confirm, Loop with stops, Free-run chosen by context delta, confirmed in the workshop slides) and the four named pairings as trace tags.

**Already in v4.1 (restated by the review).** Agent-Reach-style channel cascade and doctor; bitemporal facts; the exact-explanation solver as a candidate oracle; SES as an experimental hardening configuration; online risk monitoring; dual-channel glyph checks; the sparse-Merkle map on the roadmap.

**Rejected again, with the original reasons (D-015).** Biscuit-attenuated release contracts (post-approval attenuation also breaks the approval-binds-exact-request property, and the signer already mints the final contract after every gate). Stripping bidi controls from the layer. Replacing precedent retrieval with PageRank. Production SES `lockdown()` at startup as the isolation boundary.

**Rejected as process.** Declaring all bake-offs resolved. The review "resolved" nine bake-offs by assertion (own 300-line runner, clean engines from spec, DuckDB tiering, and so on) without any measurement; a bake-off is decided by its test, and several of those choices contradict D-011 and the integration registers. Superlatives ("undeniably number one", "bulletproof", "cannot hallucinate", "closes every vulnerability") are rejected as claims: nothing is built, and the wording lint forbids them.

**Unverified in the review.** The five-argument `generator` wrapper and some Meterless service names it cites could not be confirmed in the local reference clone by search; module 12 remains authoritative until checked against the runners. The "ten-step ingest" and "wiredVsHelper" names likewise need checking.

**Consequence.** More mechanisms are not better by themselves: each addition above carries a named gate and ablation, and any that fail it are dropped.

---

## D-017 · 2026-10-15 · Eight capability additions and a wider reference set (spec v4.3)

**Decision.** Per Prateek: copy every strong mechanism from the most-starred agent repositories and add the capabilities listed in spec section 21a-2 (watch mode, living profiles, ready-to-send outputs, scenario testing, calibrated escalation, agent-to-agent calls, a published detection score, and a jury for serious answers). Seven new reference repositories were found by star-ranked `gh search` on 2026-10-15; their descriptions were checked, their contents were not yet read.

**Licence handling.** MIT and Apache-2.0 code may be reused with credit in the repository; AGPL repositories (Firecrawl, OpenViking) are rebuilt from the mechanism and never copied; repositories whose licence is listed as `other` are read for terms before any reuse.

**Problem statement direction.** The product is stated as an ability agents lack, not as trust: answers an agent can show, with the evidence, the disagreements, the gaps, the one fact that would flip the result and the memory of how similar cases ended. Headline line under consideration: "Agents that show their proof, and what would change their mind." Track selection remains Prateek's (primary track stated by him as Track 3; the product covers all three).

---

## D-018 · 2026-10-15 · Zetaris becomes the primary internal-data path; Nemotron must power the product

**Trigger.** The organizers' Participant Setup Guide (updated 2026-10-15; readout in `docs/intel/09`) states that Zetaris and Meterless must be running on the participant's machine for eligibility, that Zetaris is "the center of every build", that the product "must run on NVIDIA Nemotron", and that the build happens in Cursor (with Grok and Composer included).

**Decision.** The spec's section 19 is amended: Zetaris is the primary source path for internal data (reads through typed views over its REST API), with the embedded layer as fallback only; the Nemotron profile is primary and the deterministic rule brain remains the credential-free fallback. No new capability is added by this decision; it changes which path is primary.

**Open (needs Prateek).** The Zetaris platform bundle and registry credentials from the organizers; the Zetaris API key created by hand in its web interface; a free NVIDIA API key from build.nvidia.com; the build machine's Docker memory and free disk; the Meterless route details that the guide leaves as placeholders; the event-rule answer on how much code may be prepared in advance.

---

## D-019 · 2026-10-15 · Idea updated after the deep-research report: release gate for agent actions, payments as the hero pack

**Input.** A deep-research report (produced by an external research agent, pasted by Prateek 2026-10-15) scored 42 candidate ideas and ranked: vendor payment release gate 55/60, coding and infrastructure release gate 53/60, the horizontal operating layer 48/60. Spot check on 2026-10-15: the cited Hacker News items, eleven GitHub issues and the debate-sycophancy papers exist; the DREAM paper was mislabelled, the "437,000 compromised environments" line comes from a 3-point Show HN vendor post, the pain percentages cannot be reproduced (no post list), funding and grant figures were not checked, the Fed SR 26-2 item cites our own spec, and the scores are the analyst's own, produced after reading our spec (so biased toward our design).

**Decision.** Spec section 1-update records the new positioning: a release gate for irreversible agent actions; payments hero pack; coding gate as second pack; the symbolic check required for rule promotion; the jury demoted to an experiment; headless interfaces first; owner-operator persona deferred pending interviews. Kernel and module list are unchanged.

**Still unverified.** Willingness to pay of finance buyers (no interviews done), funding and grant details in the report, the claim that no product combines replay-tested overrides with payload-bound approval and minimal-flip explanations (README and issue level only).

---

## D-020 · 2026-10-15 · OpenClaw review: distribution, install and enterprise-property lessons (spec v4.6)

OpenClaw's README, VISION.md and two documentation pages were read on 2026-10-15 (code was not read). Eight lessons were judged on whether they improve the product and were added to spec section 21a-3: ship as a plugin inside OpenClaw and other agent hosts, a one-line installer with onboarding, migration discipline with `doctor`, its seven enterprise properties as our acceptance tests plus two of ours, a lean core with plugin growth, approvals in chat channels, maintenance skills, and neutral stewardship with signed releases. OpenClaw is a reference for scale and reach, not a source of our decision layer: its documented approval and policy surface does not include evidence checks, minimal-flip explanations or replay-tested rules (README and docs level; NOT VERIFIED at code level).

---

## D-021 · 2026-10-15 · Operating-layer framing and corrected differentiators after the repo check (spec v4.7)

**Method change by Prateek.** Whole repositories are not read; DeepWiki (an AI index of each repository) was asked four fixed questions for 22 repositories, and one targeted look was taken at the closest hit (Mastra's security-incident-triage template: file list and `docs/evals.md`). DeepWiki answers are leads, not verified facts.

**Decisions.** (1) The product is framed as an operating layer for agent work whose kernel is the verified release gate (spec 21a-4). (2) Payload-bound approval and quote citation are no longer presented as unique. (3) The claims to prove are: override-to-rule with replay plus a symbolic permissive-surface check, and exact minimal-flip counterfactuals. (4) Mastra's published eval gates (numerators, denominators, hashes, tamper checks) are the bar for our own published scores. (5) Document 001 is updated to v1.3.

**Still unverified.** The code-level behaviour behind every DeepWiki answer; whether any project already combines override-to-rule with a symbolic check; willingness to pay.

---

## D-022 · 2026-10-15 · Agent behaviour matrix: every organizer pattern plus eight more (spec v4.8)

Per Prateek: include everything the Approach Guide suggests for agent behaviour and exceed it. `docs/design/05-agent-behaviour-matrix.md` maps all nine checklist behaviours, all seven strong behaviours, the strong loop and the four workshop pairings to roles, trace events and tests, and adds eight patterns (adversarial pair, red-team agent, independent verifier, rule learner loop, counter-precedent, evidence-gap re-planning, restrict-only lattice, watcher). The jury stays experimental. Each behaviour is claimed only after its test has shown it can change an outcome; the trace labels each role as LLM or code.

---

## D-023 · 2026-10-15 · Technical constraints compliance matrix (spec v4.9)

Per Prateek: add the Approach Guide step A constraints and make them as strong as possible. `docs/design/06-technical-constraints-compliance.md` maps each organizer rule to its implementation and an automated check that can fail, adds five gates beyond the list (determinism, fault injection, claims, sponsor honesty, reproducibility), and notes where the Setup Guide is stricter than the Approach Guide (Zetaris and Meterless running locally; the product running on Nemotron), which is treated as binding until the organizers say otherwise.

---

## D-024 · 2026-10-15 · Sponsor depth check: three additions (spec v5.0)

Prateek asked whether Zetaris and Meterless are used to the maximum. Answer recorded: the design already uses both deeply, but maximum is not provable and the Setup Guide names three further uses. Added after the product-benefit test: Zetaris Unified Semantic Layer for the hero pack's vendor view, Meterless as the Nemotron route (guide Option A) with NVIDIA's free API as fallback, and the Meterless prompt library for the Cursor build. Each needs a switch-off ablation; the first two need access the guide leaves to the organizers.

---

## D-025 · 2026-10-15 · Architecture v5.1: goals register, operating-layer shell, outer contract, new build steps

Prateek asked for the architecture to be updated and made the best after comparing it with every goal he has stated. Spec section 0 records the goals register (G1 to G10) with where each is met and the gaps found; seven gaps were closed: section 1 corrected for the stated track, a new section 14b for the operating-layer shell (agent registry, mission-control console, host plug-ins, chat approvals, doctor and migrations, watcher, seven enterprise properties), a provisional outer contract for the larger platform (14c), build steps 9a, 12a, 14b and 14c, corrected risks, and decisions D11 to D13 for Prateek. Nothing is built; every addition carries a named gate.


---

## D-026 · 2026-10-16 · The 56-repository profile pass: spec v5.2, PRD and adoption register

Prateek asked for every good mechanism in every referenced repository to be checked one by one (architecture, features, how real users use them, the mechanism for our module, agent patterns, model and data layer, and what the GenAI hackathon cares about), half with Haiku and half with agy (Gemini CLI), and for the findings to be folded into the architecture, the feature list and the documents. Result: 56 profiles in `docs/design/prior-art/profiles/` (each with a reader, a reviewer spot-check and an adopt, adapt or reject verdict written by the reviewer), a roster and reader comparison (`98`), and an adoption register (`99`) with stable ids. Spec v5.2 adds section 0.4 (what changed), build-order gates (P-1 to P-8 at step 1, release-safety tests at step 14, object pinning at step 12a) and section 21a-5 (the register, the licence rule, and corrections to earlier statements). New files: `docs/design/07-product-requirements-and-feature-list.md` (the PRD and feature list) and `docs/design/modules/98-profile-pass-additions.md` (per-module additions, pointed to from every blueprint). Key findings: several repositories swallow errors or substitute defaults (register P-1); one agent SDK runs its safety checks in parallel with tools and on the first agent only (profile 15); one popular agent runtime ships its approval gate off by default and fail-open; HippoRAG's zero-cutoff reranker attaches invented facts to real ones; the Meterless repository holds specifications, reference code and conformance suites but no server; several vendor benchmark numbers describe a different build. Reader finding: both readers were reliable on single-place facts and unreliable on verdicts, so the rule is that readers extract and the reviewer writes verdicts and checks at least three facts per profile. Licence handling: MIT and Apache with credit; no-licence repositories (llm_multiagent_debate, ClinicalAgents-Code) ideas only; AGPL and source-available (Firecrawl, n8n, Dify) mechanism only; the old `letta` repository is a reject (owners forbid copying), its successor `letta-code` is profile 48. Not read: OpenClaw extensions, apps and skills (its gateway, approvals and scheduler are profile 56), the OpenHands agent server and runtime, Gaia, Relay and Swarms, OpenViking, TencentDB-Agent-Memory. Nothing was built; every adoption carries a gate. Alternatives rejected: adopting any framework wholesale (none of those read meets all of P-1 to P-8 as far as it was read); copying a vendor's benchmark numbers.

Follow-up 2026-10-16: two independent reviewers read the result (the judge-simulator and the rules-auditor). The judge-simulator scored the project about 14 of 100 as it stands today (nothing is runnable) and about 50 as a paper-design ceiling, and named three mark-downs: nothing runnable, a broad concept against little code, and sponsor use asserted but not shown. The rules-auditor found no secrets and no commit-window breach, and listed licence carve-outs, stale sponsor-status lines, overclaim wording, an empty Cursor log and missing pre-existing-component declaration; these were corrected the same day (licence tags in the register, `docs/submission/pre-existing-components.md`, softened wording, status lines). Still open from the reviews: Cursor sessions must be logged for real, the organizers' answer on pre-window preparation, committed design docs quote organizer material (open question F16), and the single largest gap is that nothing runs.


---

## D-027 · 2026-10-17 · Market and demand pass: hero-pack recommendation revised (not yet decided)

Prateek asked for the product to be judged as a company, using what already exists on the internet. Two web researchers produced `docs/design/prior-art/2026-10-17-market-and-demand-evidence.md`. Findings: large security vendors bought four guardrail start-ups in 2025; none of the pages read offered a signed, offline-verifiable gate decision, rule learning from overrides with replay, exact minimal block explanations, or a counterparty evidence check (not found, not proven absent); sourced incidents exist for coding and infrastructure agents (Replit, PocketOS, Kiro) and none were found for payments; permission prompts and approval hooks are becoming free in Claude Code, Cursor and the main agent frameworks. Correction the same day: Prateek rejected settling on payments and fraud numbers ("I really dislike this idea") and asked for research on agentic use cases the tracks actually ask for. D13 is therefore OPEN with no recommendation; the earlier coding-first and payments-first leanings are withdrawn. Prateek also confirmed there is no build limit, so breadth is not cut; each pack must still be fully implemented. The payment-side evidence (FBI IC3 BEC losses $3.05B in 2025 and $2.77B in 2024; AFP 63%; Basware agreed to buy Trustpair on 2026-08-26) stays on file as evidence, not as a choice.


---

## D-028 · 2026-10-17 · Submission track: Track 3, Reasoning Architecture; the product is built for the grant

Prateek decided that the hackathon submission goes in Track 3 (Reasoning Architecture) while the whole product is built for a serious-product grant, covering all three tracks and any vertical packs. The "How the Week Runs" lesson (`docs/event/07-how-the-week-runs-lesson-2026-10-17.md`) says one primary track is judged and cross-track relevance is not scored twice, so the pitch quotes Track 3's own words (turn data, knowledge, memory and reasoning into reliable decisions and actions) and shows the other tracks as depth. The hero vertical (D13) remains open. No time limit or build limit applies. Zetaris and Meterless are required and will be built for real; Nemotron runs through Meterless (the lesson's Power rule).


---

## D-029 · 2026-10-17 · The demo is one Decision Desk across packs (closes D13)

Prateek rejected a single tiny vertical ("not just one tiny thing") and asked for the framing that looks biggest and shows the full power, leaving the choice to the assistant. Decision: the demo and the pitch are one Decision Desk. One user: the head of risk and operations at a mid-size health insurer (a payer). One decision type: release or hold a consequential action. Several packs feed the same desk: prior authorization, claims, provider payment release, contract renewal, access and data-deletion requests. One kernel, one memory, one rule learner and one signed record chain sit under all of them, so one override teaches a rule that applies across packs where it fits. This keeps the organizers' formula (one user, one decision, many data slices) while showing breadth as proof of the kernel. A payer was chosen because it naturally spans health, insurance, finance, legal and security work and gives Zetaris a real job (claims, clinical extracts, policy library, billing, provider directory). Risks recorded: health content stays synthetic, is framed as policy-criteria matching with clinician review, and the system never denies on its own (the organizers' unsafe-overclaiming example); whether state laws bar AI-only denials is NOT VERIFIED. Rejected: payments-only (Prateek disliked it; Trustpair competes), legal-only (Harvey dominates), a developer-platform framing as the headline (kept as a surface, the MCP proxy and SDK, for the grant story).


---

## D-030 · 2026-10-17 · Durable runtime: evaluate DBOS and Temporal before deciding

The best-in-world check (`docs/design/prior-art/2026-10-17-best-in-world-check-kernel-parts.md`, section 5) found DBOS Transact for TypeScript (MIT, state in Postgres, library) and Temporal (MIT, replay engine) as the credible existing engines; Restate (BSL) and Inngest (SSPL) are rebuild-only. Prateek chose to evaluate DBOS and Temporal first and decide afterwards. The comparison is a bake-off against our needs: an idempotency key written before every side effect with reconciliation on resume, one trace schema, bounded retries and budgets, crash-and-resume that never repeats a paid or irreversible step, and the register rules P-1 to P-8. This continues the earlier decision that the substrate is chosen by bake-off (D-005 to D-013); building our own remains the fallback if neither passes. Their mechanisms are NOT VERIFIED beyond repository facts until the bake-off reads their code. Limits: both passes hit search caps, no willingness-to-pay data was found, and the researchers' facts were not re-fetched by the reviewer.


---

## D-031 · 2026-10-17 · Durable runtime: a pluggable port with our own SQLite default (supersedes the D-030 bake-off)

Prateek accepted the proposal. The durable runtime is a port whose contract is our crash-and-resume test suite (an idempotency key written before every side effect, reconciliation with the downstream system on resume, one trace schema, bounded retries and budgets, one side effect and not two after a crash). The default implementation is our own thin layer on SQLite with an effect log, which needs no install, so judges can run it. DBOS Transact for TypeScript (MIT) and Temporal (MIT) are optional adapters that must pass the same suite; Restate (BSL) and Inngest (SSPL) are rebuild-only. Reasons: zero manual setup for judges (organizer red flag), enterprises can plug in their engine, and a published substrate test suite is a grant contribution. Whether DBOS runs without Postgres is NOT VERIFIED and only matters for the adapter. D-030's evaluate-first bake-off is replaced by this design; the adapters still get measured.

## D-032 · 2026-10-17 · Zetaris data path: every source through Zetaris, no side doors

Prateek accepted the proposal. Whenever Zetaris is running, every source goes through it. The synthetic silos are registered as three source types so that Track 1's fragmentation is real: claims in a small Postgres, billing as files in an S3-style bucket, policy and eligibility from a small REST service, joined under Zetaris's semantic layer by one SQL query shown on camera. Its AI data steward is tested for PII tagging on the synthetic health data. The no-Zetaris judge mode reads the same fixtures through an embedded engine and the trace marks every such read as fallback. Zetaris features beyond SQL (Postgres and S3 sources, semantic layer, data steward) are NOT VERIFIED until each is tested on the local instance; files on the laptop are invisible to Zetaris, so each source must live in a service or storage its container can reach.

## D-033 · 2026-10-18 · PRD v2.0 from the vertical and open-source agent study

- **Decision:** adopt five additions (F-S17, F-S18, F-K21, F-K22, F-K23) and raise the PRD to v2.0. The master spec stays v5.3.
- **Why:** nine open-source research agents were read and none checks a claim against its source text with code; the one published measurement of a closed product (Elicit) found supporting quotes matched in 46% of repeated runs. Evidence: `docs/design/prior-art/2026-10-18-vertical-and-research-agents-study.md`.
- **Limits:** closed products were studied from public sources only (REA gave the tech stack and no agent logic); Cohere, Sixfold, Anterior, Glean and AlphaSense were not re-read; AutoGen was not read in depth.

## D-034 · 2026-10-18 · Policy Twin and verifier honesty added (PRD v2.1)

- **Decision:** add F-S19 (Policy Twin) and F-K24 to F-K27 to the PRD, raising it to v2.1. The demo still opens on one prior-authorization decision; the Policy Twin is the second scene, never the first. The master spec stays v5.3.
- **Why:** a divergent-ideas run ranked rule governance by replay as the strongest upgrade (it reuses the replay, the restrict-only proof and the signed dossier), and the rival teardown showed that every competing trust or gating product states that a valid signature does not prove the claim. Evidence: `docs/design/prior-art/2026-10-18-adhd-divergent-ideas.md`, `docs/design/prior-art/2026-10-18-rival-teardown-trust-and-action-gating.md`.
- **Basis:** added after Prateek asked for the teardown and then for the docs to be updated for the product; he did not name the Policy Twin separately. Reversible: remove F-S19 and W-T1 to W-T3.
- **Limits:** the rivals were read from READMEs and public pages only; replay fidelity is the load-bearing risk and is unproven.

## D-035 · 2026-10-19 · PRD v3.0: three doors on one engine, with the X-ray, Evidence Graph, live board and typed screener

- **Decision:** raise the PRD to v3.0. Add tier D (the doors): the `prove-it` skill, distribution routes, a local MCP server, an optional stop hook, doctor, the everyday-person page, the single-file HTML brief, a public benchmark, a compliance map and a real public policy pack (F-D01 to F-D10). Add F-S20 to F-S23 (X-ray, Evidence Graph, live evidence board, typed screener), F-K28 to F-K33 (quote check v2, computed evidence grade, source capability table, admissibility rules, locked evaluator, reversible context store) and F-P14 and F-P15 (clearing house, compiler). The master spec stays v5.3; the submission stays Track 3 (D-028).
- **Why:** Prateek asked for the product to combine what the fastest-rising repositories do (superpowers, skills, graphs and dashboards, sourced guides, decision models) and sit at the centre of what the hackathon asks, and to cover every part of each group properly. Five readers studied thirty-odd repositories; none produces a record whose content, not only its signature, a stranger can verify offline. Evidence: `docs/design/prior-art/2026-10-19-top-repos-pattern-study.md`.
- **Basis:** Prateek's messages of 2026-10-19 ("yes and make sure we are doing every single thing which comes under these"). The face wording (an X-ray and time machine for AI answers) was proposed by me and accepted by that "yes". Reversible: remove tier D and the rows listed above.
- **Limits:** the study is mostly README-level; benchmark numbers quoted from repositories are their own and unverified; the screener needs an ablation before its model is chosen and must not require training; the compliance map is a mapping aid, not legal advice.


## D-036 · 2026-10-20 · The Desk (Agent Spend and Worth Desk on the Plumbline core) becomes the product direction; D-029's insurer Decision Desk is superseded as the demo

- **Decision:** the product to specify and build is the Desk: a desk for the person who pays for AI agents, tying each dollar to work that landed, running a daily canary of the owner's own tasks, replaying past tasks on a cheaper route with a quality interval, and gating spend through a written policy with the Plumbline verified-decision core underneath (exact-quote checks, restrict-only policy proof, signed dossier). The architecture, feature list and PRD live in `docs/design/desk/`. Primary submission track stays Track 3.
- **Why:** an eight-pass idea hunt (1,970+ sources, 3,000+ quoted claims, `research/idea-hunt/`) found no idea above the 80-point bar, and the closest was the Desk at 53.4 after a hostile red team. Plumbline scored 33.0 on the same rubric after its red team (10 open weaknesses: Zelis, Cohere Health, Anterior and Microsoft's governance toolkit already ship parts of the insurer release-or-hold desk). The Desk keeps Plumbline's kernel and replaces the insurer scene with a user, a bill and a wow moment that are checkable by anyone with agent logs.
- **Basis:** Prateek chose "Spend and Worth Desk + Plumbline core" on 2026-10-20 and asked for the best architecture, feature list and PRD built by copying what the best repositories do.
- **Limits:** no idea cleared 80; scores are agent judgement with attached evidence; the leaders' quotes were NOT re-opened after the final round; all 34 repository profiles (57 to 90) were read through the GitHub API without running the code; the canary and replay statistics are unproven until the simulation runs. Reversible: keep the Plumbline spec v5.3 and PRD v3.0 untouched.

---

## D-037 · 2026-10-22 · Build in the main session; no parallel subagents

- **Decision:** the Desk is built directly, one piece at a time, each tested before the next. Six parallel forks were started and stopped by Prateek the same day; the half-written, untested files they left were either finished and tested here (gate, dossier, verifier, canary, Ask, engines) or deleted (task replay).
- **Why:** token cost and incoherent partial work. Recorded in the user-level instructions.

## D-038 · 2026-10-22 · Route replay of recorded tasks (DK7) is not built

- **Decision:** not built, and listed as NOT RUN by `desk prove`. The policy replay, the wind tunnel and the held-out proposal check are built and tested.
- **Why:** a cheaper-route replay needs recorded tool results for real tasks and a priced route; the sample is constructed, the Nemotron route has no verified price, and a replay on invented prices would be the "claim without evidence" the project forbids. The fork's task-replay code (1,700 lines, no tests) was deleted rather than shipped.

## D-039 · 2026-10-22 · Dollar figures round half up everywhere

- **Decision:** `formatUsd` rounds to the nearest cent. It truncated before. The card, the bill, answers, the approval card and the dossier now show the same cents, and the Auditor's figure check agrees with the verifier's rounding.
- **Why:** a one-cent difference between the proposal report and its dossier appeared in the first end-to-end run.

## D-040 · 2026-10-22 · The canary is real model runs on assigned dates

- **Decision:** a 16-task pack with checkers that read text (no model output is executed). The scenario series is one real run per day and arm against NVIDIA's API; day 1 is 30 September so that day 15 is the 14 October the sample plants its own change on. The primary arm serves nemotron-3.5-super-120b until day 14 and nemotron-3.5-lightning-30b from day 15; the control arm serves nemotron-3.5-lightning-30b throughout and runs every other task (the 550B model and nemotron-3-nano-omni both answered HTTP 429 on a quarter or more of attempts, which would have made the error rate refuse every call). The served model id is read from each reply. Dates are assigned, the switch is on purpose, and every card says so.
- **Why:** the sample has no real prompts to replay, a simulated series would prove only the simulator, and real runs show real sampling noise. The control shares a model with the primary arm after the switch; it is flat by construction there, and what it tests is a platform-wide event, not the model.
