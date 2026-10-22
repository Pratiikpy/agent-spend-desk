# Module 10: Interfaces and Experience Design

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Section 14b of the spec adds the operating-layer shell to this module: agent registry (process table), mission-control console (layers, nodes, conflicts in red, action queue, time slider), host plug-ins (OpenClaw extension, ClawHub skill, Claude Code, Codex, Cursor, Hermes), chat approvals, doctor and migrations, installer. Build step 14b.
- Headless first: webhook and MCP interfaces; the console is for the approval queue and the proof view (D-019).


## Integration revision (2026-10-13)

Source: `99-integration-register.md` (pass 2). Applied in place; sections the register does not touch are unchanged.

**Applied (where):**
- INT-001: verifier verdicts `PASS | FAIL | INDETERMINATE | NOT_APPLICABLE` (`verify.*`) and certificate outcomes `VALID | INVALID | INCONCLUSIVE` (`cert.*`) are separate status families; `INVALID` removed from verdicts. C3, C9, C12, C16 `verify_bundle`, C18 exit codes.
- INT-002: why-kind badge set is `rule`, `computed`, `model_reported`, `human_reported`; `human.approval.<code>` shown as a recorded "Human decision"; `decider` shown in the feed. C6, C10.
- INT-003 (consistency): chip hashes are `RawHash` (PDF, layer, span; no JCS for the layer), `factSetHash` is `DocHash`, MCP `Hash` pattern covers the three prefixes. C8, C9, C16.
- INT-004: chip slices by `byteStart`/`byteEnd` and cross-checks the code-point `start`; mismatch is `V5.LOCATOR_UNIT_MISMATCH`, shown as `quote_absent`. C8.
- INT-007: fifth cell state `silent` with its own glyph, grammar and copy; status count about 46 becomes about 48 with the chip additions. C1, C2, C3, C7, C13, C16, C19.
- INT-008: scopes are capabilities, not roles (tokens map to `SiloRole: agent`); console users carry an `RbacRole`; audience preview and CLI use `(audience, disclosure)`. C11, C12, C16, C18.
- INT-011 (consistency): autonomy levels are `AL0` to `AL3`. C10.
- INT-016 (consistency): the card's third column is the `ReleaseBinding` that would be minted. C11.
- INT-020, INT-021 (consistency): intake and run view name the model profile and the disclosure profile and the minimised form of each lookup. C6, C18.
- INT-028, INT-038 (consistency): memory view excludes tainted or unproven permissive-direction precedents, uses M6's four dismissal reasons and `knownShareMin`. C12.
- INT-029: one approval service owned by M13, item semantics from M5, primitives from M8; eight item types, `ApprovalState`, WebAuthn confirm; M10 routes are thin proxies; SEC-W1 sentence. C11, C21, interfaces table.
- INT-030: approval waiting is a case state; A2A `INPUT_REQUIRED` only for in-run questions. C17.
- INT-031: three named clocks; expiry moves the case to HELD (`expired_unapproved`) with re-request; "Extend review" is a re-issue. C11, C13.
- INT-032: banner names the lane (fast lane or full review) and the calibrated region. C10.
- INT-041: upload path hashes in the page, uploads by hash, submits `attachments`; `submit_case` documents map the same way, labelled counterparty and untrusted. C4 API list, C6, C16.
- INT-044: cassette-miss copy prints the exact live command and names the deterministic stages that still run. C6, C13.
- INT-051: browser runs the pinned verifier core in a worker (V0 to V4a, V5 for parser-free locators, V6 to V8 via the recompute module, never V4b); two results shown, disagreement is an alert; chip rule: `mech` state only for mechanical checks the browser actually ran inside the SRI-pinned core with no contradicting report. D-007 amendment (erasable-syntax TypeScript, injected async hash) written out. C4, C8, C12.
- INT-052: chip set is M2's ten (adds `layer_only`, `extractor_disagree`); `chipState` returns a name, M10 owns glyph and hue; raster and quads persistence contract (`evidence/derived/<docId>/`, hashed, display aids). C3, C8, C19.
- INT-054: `UiTraceEvent` is a projection of M7's trace line, no M10-owned fields. C6, interfaces table.
- INT-055: counterparty preview is the signed notice content, unsigned, never delivered; `plumbline notice --preview`. C9, C12, C18.
- INT-056: `ctx.ids.secret` for MCP handles: fresh in `live`, recorded in `record`, the recorded (fixed) value in `replay`. C16.
- INT-059 (consistency): usability pre-registration is publicly committed after the window and before S2; earlier sessions are exploratory. C21, C22.
- INT-063: (a) `TASK_STATE_*` names and policy `reject` as `COMPLETED`; (b) fourth skill `submit-case` adopted (first option); (c) stage commands `reconcile | explain | decide` with inputs and outputs in the CLI list; (d) policy time travel behind the `labs` flag, off by default, absent from navigation, with a "not enabled" state, until the §21a gate (measured benefit, replay-equality test); (f), (h), (i), (j) were already the design and are recorded as such. C5, C12, C13, C17, C18, spec feedback.

**Named but not applied:**
- INT-063 (e): the WCAG 2.2.1 essential-exception argument stays NOT VERIFIED (F7 stays Open); the simulated identity provider is applied.
- INT-063 (g), (k) and the spec halves of (a), (c), (d): spec §14, §19a, §21a and §21b edits belong to the spec; nothing further to change here.
- INT-040 (erased-body chip state) and INT-048 (tenant on the view API): neither names M10, so neither is applied. INT-040 leaves one open question (contradiction 6); the console serves the single tenant `tn_default` on the judge path, so INT-048 loses nothing for now.

**New contradictions found:**
1. M9 component 15 (as read) still returns `green | amber | red` and says the console never imports the verifier and runs it as a separate OS process; INT-051 and INT-052 require the page to run the core in a worker and `chipState` to return a named state. Its `ViewerCheckInput` also lacks the code-point `start`, the extractor state and the layer-only case.
2. The pinned-core rule needs the digest of each emitted browser module to be published with the bundle or build manifest; M9 component 15 publishes digests for `verify.mjs` and the optional modules, not for per-file browser emits.
3. M13 `ApprovalRecord` has no provisional read, `evidenceOpened` keeps only `{evidenceId, at}` (no span id or dwell time), and `requestExpiresAt` sits inside the hashed request, so "Extend review" can only be a re-issue; M13 §5.4 defines no re-issue or claim lock.
4. M2 DI-14 still decides to draw pages with pdf.js and lists no raster export; it also requires the report to PASS for a green chip, while this blueprint allows `browser_only` for a live case that has no bundle yet (labelled "No bundle report").
5. M7 trace line v2 has `decision.decider` and `decider: human` as `human.<interruptKind>`, but no top-level `phase`, `agent` or `verb`; INT-002 changes the human rule id to `human.approval.<code>` for approvals, which V6 cannot recompute (M9 contradiction 6). M5 and M10 treat it as a recorded decision, not an explanation.
6. An erased (tombstoned) body has no state among M2's ten: `unavailable` is the closest, while M9 reports `V5.ERASED` as INDETERMINATE (INT-040); the register does not say which the chip shows. Not applied here until decided.

Status: design blueprint (2026-10-13). Nothing here is built. Every design claim is a hypothesis with a named test; whatever is unmeasured is marked **NOT VERIFIED**. Template, shared types and reference rules are those of `00-conventions-and-shared-types.md`. This module refines spec v3.1 section 14 (with 9a, 13, 1a and 21 F-A11Y) and gives M10 the labelled acceptance gate the adversarial review found missing (review item OPS-02).

## 1. Scope and contract

**Job.** M10 is the only place where a person, another agent or a script meets Plumbline. It has four adapters over one core and no logic of its own: the **decision console** (static files, no bundler), the **MCP server**, the **A2A server** and the **CLI**. Anything an adapter shows or returns is rendered from a typed value that M3, M4, M5, M6, M9 or M13 produced; a view never computes a fact, a verdict or a status that the core did not (D-044 in the demand matrix: UI polish over a weak system is discounted, so every view is rendered from the trace stream, ledger or decision record, never from mock data).

**Inputs.** Typed view models from M3 (truth table, link judgements), M4 (claim ledger, spans, flips, MRS, gaps, certificates), M5 (decision record, reason codes, allowed set, autonomy level), M6 (precedents, counter-precedents, rule proposals), M9 (ledger, bundle, verifier verdicts, audience tiers), M13 (case state, approval items, capabilities, receipts), M1 (doctor report, egress manifest), M2 (visible text layer, quads, page rasters, visibility findings), and the JSONL trace of M7. **Outputs.** Pixels and DOM for people; MCP and A2A messages for agents; exit codes and files for scripts; approval decisions written back to M13 through the authenticated approval API only.

**Depends on.** M7 (ports: clock, ids, effects), M8 (trust labels on every field, CSP and rendering rules, session and scope model), M9 (verifier core shipped to the browser), M5 (policy engine shipped to the browser for the flip panel), M13 (case lifecycle). **Depended on by.** M11 (UI tests, the usability study, visual QA matrix), the submission kit (screenshots, demo video).

**What the spec already fixes (kept).** Static files, no bundler; three lenses; evidence viewer with browser-side hashing; minimal-flip panel from the shared policy engine; MCP tools `reconcile_vendor`, `explain_claim`, `verify_bundle`, `submit_case`, `get_decision` with no approve, promote, rule-edit or memory-write tool; one A2A Agent Card; CLI; light and dark, desktop and mobile; WCAG 2.2; zero console errors; the persistent decision-support banner (F-POSTURE); friction only at the approval gate.

**What this blueprint adds.** A design for the evidence viewer that never parses a vendor PDF in the console (section C8); an evidence-first approval card with a measured arm (C11); a visual grammar that separates mechanical checks from recorded judgements (C3); a safe-rendering runtime with strict CSP and Trusted Types (C4); a scope-varying MCP tool list and a corrected A2A state mapping (C16, C17); the M10 gate (C21); a mockup set and a pre-registered usability study (C22).

## 2. Component list

C1 Experience principles and decision-support posture · C2 Visual directions compared, and the decision · C3 Design system (tokens, type, colour, density, motion, icons, status vocabulary) · C4 Console runtime and view API · C5 Information architecture, navigation and the three lenses · C6 Intake and live run view · C7 Truth table with as-of control · C8 Claim ledger and evidence viewer · C9 Minimal-flip panel · C10 Decision banner and reason codes · C11 Approval queue and approval card · C12 Memory and precedent, ledger and bundle, doctor, policy time travel, settings · C13 State catalogue and copy · C14 Accessibility (WCAG 2.2) · C15 Performance budgets · C16 MCP server · C17 A2A server · C18 CLI · C19 Visual QA matrix · C20 Hero-flow demonstration constraints · C21 The M10 acceptance gate · C22 Clickable mockups and the usability study.

## 3. Reference register (all verified 2026-10-13 unless marked)

Repositories were read with `gh api repos/OWNER/NAME` (stars, SPDX licence, last push; none archived unless noted). Pages were fetched. Product claims come from the README or docs page named, not from running the product. Components cite these ids; "what it does not show" is stated where it matters.

| Id | Reference | Facts verified | Read depth and limits |
|---|---|---|---|
| R01 | WCAG 2.2, https://www.w3.org/TR/WCAG22/ and Understanding pages for 2.5.8, 2.2.2, 4.1.3, 1.4.13 | New in 2.2: 2.4.11 Focus Not Obscured (Minimum) AA, 2.5.7 Dragging Movements AA, 2.5.8 Target Size (Minimum) AA (24 by 24 CSS px, spacing, inline and equivalent-control exceptions), 3.2.6 Consistent Help A, 3.3.7 Redundant Entry A, 3.3.8 Accessible Authentication (Minimum) AA; 4.1.1 removed. 2.2.2 (A): auto-updating information that starts automatically and is presented in parallel needs a mechanism to pause, stop, hide or control frequency. 4.1.3 (AA): status messages programmatically determinable without focus (`status`, `alert`, `log`). 1.4.13 (AA): dismissible, hoverable, persistent | Normative text, not conformance practice. Automated tools cover a part of it |
| R02 | WAI-ARIA Authoring Practices patterns index (https://www.w3.org/WAI/ARIA/apg/patterns/) and `w3c/aria-practices` (1,357 stars, NOASSERTION, push 2026-09-30); MDN live-region roles | Pattern list incl. table (static), grid (interactive), dialog, alert, disclosure, tabs, toolbar. `log` implies polite, atomic false; `status` polite, atomic true; `alert` assertive. The live region must exist in the DOM before content is injected | The pattern index page does not state screen-reader test coverage; behaviour differs across AT (NOT VERIFIED per pattern) |
| R03 | IBM Carbon status indicator pattern, `carbon-design-system/carbon` (9,541 stars, Apache-2.0, push 2026-10-13) | Status uses four elements (symbol, shape, colour, type); "at least three of these elements must be present"; labels mandatory for shape-only indicators; 3:1 contrast between status colours | One pattern page read, not the component code |
| R04 | GOV.UK Design System notification banner and error summary, `alphagov/govuk-frontend` (1,470 stars, MIT, push 2026-10-13) | Banner sits immediately before the h1, use sparingly ("people often miss them"), success banner `role=alert`, neutral `role=region`, one banner per page, never alongside an error summary; error summary at top of main, focus moved to it, links to fields, wording identical to field messages | Two component pages read |
| R05 | Radix Colors scale (https://www.radix-ui.com/colors/docs/palette-composition/understanding-the-scale), `radix-ui/colors` (1,696 stars, MIT, push 2025-12-17) | 12-step semantic scale; steps 11 and 12 are guaranteed Lc 60 and Lc 90 APCA on a step 2 background | APCA is not the WCAG 2.2 metric (1.4.3 uses ratios, R01); we use the scale idea, not its values |
| R06 | MDN: `light-dark()` (Baseline 2024, "newly available"), `forced-colors` (widely available since Sept 2022; `box-shadow` forced to none), Trusted Types (Baseline 2026, newly available), import maps (widely available since Mar 2023; `integrity` supported in the map), server-sent events (widely available; no custom headers; 6 connections per origin on HTTP/1.1), `SubtleCrypto.digest` (secure contexts only, no streaming input) | As listed | MDN summaries; behaviour on `file://` not stated (NOT VERIFIED) |
| R07 | pdf.js, `mozilla/pdf.js` (53,996 stars, Apache-2.0, push 2026-10-13); npm `pdfjs-dist` 6.4.299, 34.9 MB unpacked | Security advisories listed by `gh api`: GHSA-wgrm-67xf-hhpq (CVE-2024-4367, high, 2024-05-06) and GHSA-hq66-cqwq-w95j (CVE-2026-16633, high, 2026-07-28), both "Arbitrary JavaScript execution upon opening a malicious PDF" | Advisory titles only; exploit conditions not read |
| R08 | `gpt-researcher` static frontend, local clone `research/track-2-agent-that-can-explain-why/gpt-researcher/frontend` (Apache-2.0 per the clone index) | Read in code: `scripts.js` 2,488 lines; model and web-derived HTML goes through `sanitizeHtml` (DOMPurify, text-escape fallback) and then `innerHTML` (function `addAgentResponse`); `index.html` and `scripts.js` contain zero `aria-` attributes and no `aria-live` or `role=log`; `styles.css` has no `prefers-color-scheme` or `prefers-reduced-motion` | One frontend, not a census of agent UIs |
| R09 | Inspect log viewer (https://inspect.aisi.org.uk/log-viewer.html), `UKGovernmentBEIS/inspect_ai` (2,993 stars, MIT, push 2026-10-13); Langfuse docs, `langfuse/langfuse` (35,769 stars, NOASSERTION); Arize Phoenix (11,819 stars, NOASSERTION, metadata only) | Inspect: sample list, drill into messages, scoring and metadata tabs, static file serving and live viewing of running evals with incremental metrics. Langfuse: nested observations with timing, inputs, outputs, cost | Docs pages only; no screenshots inspected; Phoenix not read |
| R10 | Marble, `checkmarble/marble` (615 stars, NOASSERTION, push 2026-10-08) | README: decision engine and rules builder, sanctions and PEP screening, a Case Manager "for exploring alerts, annotating findings, and taking action without context switching", continuous monitoring | README only. This is the closest open-source relative of a risk-review console; its UI was not seen |
| R11 | Microsoft Responsible AI Toolbox, `microsoft/responsible-ai-toolbox` (1,844 stars, MIT, push 2026-10-08) | Dashboard components: model overview, error analysis, data explorer, interpretability, counterfactual and what-if (DiCE-powered; example "would have received the loan if their income was higher by $10,000") | README only. What-If Tool (`PAIR-code/what-if-tool`, 1,023 stars, Apache-2.0) and DiCE are in `14` B4 |
| R12 | Magentic-UI (`microsoft/magentic-ui`, 10,094 stars, MIT, push 2026-09-23) and `12` §5.1 | README line read: "stops and checks in before taking critical actions"; "Steer, approve, or take over at any point" | The fetched README text did not describe co-planning or action-guard mechanics; no UI detail beyond that line |
| R13 | OpenSanctions matching docs (https://www.opensanctions.org/docs/api/matching/), `opensanctions/yente` (181 stars, MIT) | Docs advise "a process for human review" and tuning thresholds; an advanced screening search page exists | The docs do not describe per-feature explanations; the UI was not examined |
| R14 | Human-AI decision studies. Bansal et al., https://arxiv.org/abs/2006.14779 (CHI 2021): explanations "increased the chance that humans will accept the AI's recommendation, regardless of its correctness". Fogliato et al., https://arxiv.org/abs/2205.09696 (19 veterinary radiologists): those who gave a provisional response before seeing the AI were "less likely to agree with the AI" and found it "less useful", with no longer task duration. Poursabzi-Sangdeh et al., https://arxiv.org/abs/1802.07810 (N=3,800): a clear model made participants "less able to detect and correct for the model's sizable mistakes, seemingly due to information overload". Akhawe and Felt, USENIX Security 2013 (over 25 million warning impressions): behaviour varied across warnings (Firefox users dismissed about 90% of malware and phishing warnings, Chrome users about 75%), so warning design changes behaviour. Also from `14` §B3.2 and B4: Ding et al., PaperTrail, Vasconcelos et al., Buçinca et al., Wachter et al., Ustun et al. | Abstract pages read. Other tasks and populations; none is a procurement setting. Transfer is **NOT VERIFIED** |
| R15 | Nielsen, "Why You Only Need to Test with 5 Users" (nngroup.com, 2000) | Model N(1-(1-L)^n), L=31%; five users per round; 3 to 4 per group when there are 2 groups, 3 per group for 3 or more; iterate across rounds | A formative-testing heuristic; not a basis for comparative claims (C22 uses a separate sample-size argument) |
| R16 | Core Web Vitals (https://web.dev/articles/vitals) | Good thresholds: LCP 2.5 s, INP 200 ms, CLS 0.1, assessed at the 75th percentile | Field metrics for sites; our budgets are lab budgets |
| R17 | MCP specification 2026-07-28 (tools page; `schema.ts` read through the GitHub API), `modelcontextprotocol/typescript-sdk` v2 line (13,571 stars, LICENSE: Apache-2.0 for new code, MIT for not-yet-relicensed contributions, push 2026-10-13, release 2.3.1 on 2026-10-05), `modelcontextprotocol/inspector` (11,064 stars, NOASSERTION), `modelcontextprotocol/conformance` (132 stars, NOASSERTION, push 2026-10-12) | See C16 | `ToolAnnotations` fields read in code; the conformance framework README read (client and server scenarios, `npx @modelcontextprotocol/conformance server --url ...`); no scenario list read |
| R18 | A2A 1.0.0: `a2a.proto` read in `a2aproject/A2A` (26,135 stars, Apache-2.0); `a2aproject/a2a-js` (639 stars, Apache-2.0, README: v1.0 stable, opt-in v0.3 compatibility); `a2aproject/a2a-tck` (54 stars, Apache-2.0); `a2aproject/a2a-inspector` (500 stars, Apache-2.0); discovery page | See C17 | Spec section 8.4 (card signing) and the REST binding details were not readable through the fetch; NOT VERIFIED |
| R19 | Tooling: `dequelabs/axe-core` (7,638 stars, MPL-2.0), `@axe-core/playwright` 4.13.0 (MPL-2.0), `microsoft/playwright` (97,623 stars, Apache-2.0), `guidepup/guidepup` (575 stars, MIT; README: drives VoiceOver on macOS and NVDA on Windows, not JAWS), `GoogleChrome/lighthouse-ci` (7,110 stars, Apache-2.0, push 2026-03-27), `pa11y/pa11y` (4,574 stars, **LGPL-3.0**, not adopted) | As listed | Not run |
| R20 | Fonts: `IBM/plex` (11,691 stars, OFL-1.1), `rsms/inter` (19,968 stars, OFL-1.1, push 2024-11-19), `JetBrains/JetBrainsMono` (13,080 stars, OFL-1.1) | Licences only | Subset sizes unmeasured |
| R21 | View-layer candidates, metadata only: `lit/lit` (21,842 stars, BSD-3-Clause), `preactjs/preact` (38,926 stars, MIT), `developit/htm` (9,049 stars, Apache-2.0, push 2024-02-01); mockup tool `penpot/penpot` (61,002 stars, MPL-2.0); ledger-viewer reference `sigstore/rekor-search-ui` (51 stars, Apache-2.0; README gives no entry layout) | As listed | Code not read; the C4 decision is argued from the trust boundary, not from their code |
| R22 | Local prior art: `14` Part B (B1 to B6, §11), `12` §10, `08` §C and §G, `15` §3, §7B, §7C, `04-practitioner-validation-plan.md`, spec §18 | Cited by section where used | Verified in those files |

**Not examined, so not used as design authority:** Scite, Elicit and Perplexity (a Scite help page failed on a TLS error; the others were not fetched), Quantexa, OneTrust, Trustpair and Grep AI interfaces (`15` §3.1 read claims only), Aleph, Penpot's prototype player, and the uncertainty-visualisation literature (searches and arXiv lookups returned nothing usable; the search budget is exhausted). Consequence: uncertainty is shown only as the ordinal tags the spec defines (spec §9), never as a probability or interval chart, and that restriction is itself a hypothesis in the usability study (H-UI6).

---

## C1. Experience principles and the decision-support posture

**Best references.** R14 (what explanations do to reliance), R22 (`14` B3.2 and B5.4), `15` §7B (measure oversight), R04 (restraint with banners), R03 (status).

**What they actually do.** The evidence says four uncomfortable things. Citations, even random ones, raise trust and checking them lowers it (Ding et al., `14`). Explanations raise acceptance of the recommendation whether or not it is right (Bansal et al.). More transparency can make people worse at spotting errors through overload (Poursabzi-Sangdeh et al.). Forcing functions reduce over-reliance but are disliked (Buçinca et al.), and a provisional human judgement before the AI answer reduced agreement with the AI without lengthening the task in one clinical study (Fogliato et al.). None was run on payment release, so each design response below is a hypothesis with a study arm (C22).

**Decision: own.** The principles are ours because the combination is: an interface whose job is to make a reviewer's verification cheap and its absence visible, not to make the system look trustworthy.

**Implementation design.** Twelve principles, each testable.

1. **Computed, never asserted.** A badge, chip, label or colour appears only if code computed it from stored values in the page or in the bundle. No decorative "verified". Test: every status component takes its state from a pure function (`chipState`, `statusOf`); a lint rejects status markup without a state argument.
2. **Mechanical, judged, absent are three different things and look different** (C3 visual grammar). Hash-matched quotes are solid; model judgements are outlined and labelled "judged"; unchecked or missing items are dashed.
3. **Absence is a first-class screen element.** `not_checked`, `unavailable`, `blocked_by_policy`, `rate_limited`, `stale`, `unresolved`, `silent` (checked, nothing says) render as cells and rows with their own glyph and sentence, never as blanks or zeros (spec principles 3 to 5).
4. **One click from any claim to its highlighted source** (Vasconcelos), and one more to its proof drawer. Browsing has no friction.
5. **Friction only at the approval gate** (Buçinca; spec §14a), and it is justified on the card in one sentence ("We ask you to open these three passages because removing any of them changes the outcome").
6. **Few things first.** The default case view shows at most five "attention items" (C10), ordered by decision relevance (membership in a minimal flip, then gap severity); the rest is one disclosure away. Five is a hypothesis (H-UI4), chosen against information overload, not a derived number.
7. **The recommendation does not anchor the approver.** The approver-of-record sees the evidence and records a provisional read before the recommendation is revealed (C11). Configurable only by policy with an ADR, never by a user setting.
8. **No bulk approve, no auto-advance, no "approve and next".** Each approval is a separate act on a separate card.
9. **Say whose fault it is.** Errors name the failing party (our server, the registry, your file, the policy) and the next action (C13), per the QA guide's rule on honest failure.
10. **Words are linted.** The documentation lint of spec §9a applies to UI copy: "proved", "guaranteed", "tamper-proof", "safe", "clear(ed)", "compliant" need a cited 9a row or are rejected. A sanctions non-match reads "No match found in list version X, retrieved T. This is not a clearance."
11. **Decision support, always visible.** The persistent banner (F-POSTURE): "Decision support. Not a sanctions determination or legal advice. A non-match is not clearance. Internal data in this demo is synthetic." It is a landmark (`role=region`, labelled), sticky, 1 line at desktop, collapsible to an icon with an accessible name but never removable.
12. **Nothing the viewer sees depends on trusting the vendor's text.** Vendor-authored strings are data (C4 rendering rules).

**Tests and acceptance.** Principle lints (1, 2, 10) run in CI; principles 4, 5, 7, 8 have scripted flows; 3, 5, 6, 7 have usability-study arms (H-UI1 to H-UI6). **Risks.** Friction at the gate may be disliked and may push reviewers to the phone or to workarounds; we measure completion and abandonment, not only catch rate. **Build notes.** Write the lints first; they constrain every component.

---

## C2. Visual directions compared, and the decision

**Best references.** R03, R04, R05, R09 to R11 (what comparable products foreground), R08 (a representative agent UI: it has no live region, no theme or motion handling), R22 (`14` B5 layout).

**What they actually do.** Inspect and Langfuse centre a **list-then-drill** transcript with scores (R09); Marble's pitch is a **case manager** that keeps investigation in one place (R10); the Responsible AI dashboard is a **tabbed analysis workbench** with a worked what-if sentence (R11); GOV.UK and Carbon are **plain, label-first** systems whose status and banner rules are written for accessibility (R03, R04). None of those fetched pages shows a document viewer with computed hash state; that part is ours.

**Criteria (weights are my judgement, to be revised by the mockup study).**

| Id | Criterion | Weight |
|---|---|---|
| K1 | Evidence legibility: long quoted text, ids and hashes, highlighted spans | 5 |
| K2 | Status clarity without colour: about 48 distinct states (9 fetch, 10 chip, 8 claim label, 5 cell, 5 action, verdict, case and approval states) | 5 |
| K3 | Table density: truth table of about 12 attributes by 5 sources plus a resolved column | 4 |
| K4 | Tone: calm, accountable; does not manufacture trust (Ding) or alarm | 4 |
| K5 | Contrast and accessibility headroom in light and dark with few colours | 4 |
| K6 | Static-site weight (fonts, icons, no framework) | 3 |
| K7 | Demo legibility at 1080p video compression and on a phone screenshot | 3 |
| K8 | Distinctiveness a judge remembers without gimmicks | 2 |
| K9 | Mobile adaptation of the evidence viewer and approval card | 3 |

Scores are 0 to 3 per criterion, assigned from design reasoning and reference reading. **They are not measurements**; the mockup study (C22, round 1) replaces K4, K7, K8 with participant data.

**Direction A, "Ledger" (document-first, editorial).** Warm paper background (`#FAF8F4`) and cool ink text; a serif (IBM Plex Serif) for case titles, decision text and every quoted passage, a humanist sans (IBM Plex Sans) for controls and tables, a mono (IBM Plex Mono) for ids and hashes. Layout: a centred reading column (max 72ch) for the case narrative with a right-hand "margin" holding chips and the proof drawer, like annotations in a legal document; the truth table is full width with ruled rows and no zebra stripes. The brand mark is a hairline plumb line with a bob; section dividers are hairlines; there are no shadows (they vanish in forced-colors anyway, R06). Status: shape language with solid, outlined and dashed outlines; accent used sparingly. Motion: minimal fades. Mood: a well-kept case file.

**Direction B, "Control room" (dense, dark-first, trace-forward).** Charcoal surfaces, a single sans (Inter) plus JetBrains Mono for labels, 13 px base, 28 px rows, a persistent three-column grid (stage rail, workspace, inspector), colour reserved for state, tabular numbers everywhere, keyboard command palette. The live run view is the home screen. Mood: an operations console; the density of Inspect and Langfuse (R09) applied to the whole product.

**Direction C, "Case file" (calm, card-based, mobile-first).** System font stack (zero font weight), light-first, large type (17 px base), one primary column of cards with progressive disclosure and a sticky action footer, tabs for lenses, plain-language labels in the GOV.UK manner (R04). Evidence opens as a full-screen sheet on every viewport. Mood: a service for occasional users.

| Criterion (weight) | A Ledger | B Control room | C Case file |
|---|---|---|---|
| K1 evidence legibility (5) | 3: serif quotes, 72ch, margin chips | 1: mono labels and small type compress long text | 2: big type, sheet viewer, little context |
| K2 status clarity (5) | 3: three-fill grammar fits the print metaphor | 2: dense, relies on small glyphs | 2: large chips, but cards hide siblings |
| K3 table density (4) | 2: ruled rows, comfortable | 3: built for it | 1: cards fight tables |
| K4 tone (4) | 3 | 1: risks reading as alarm or toy-terminal | 3 |
| K5 contrast headroom (4) | 3: light-first with computed pairs (C3) | 2: dark-first is easy, light variant is second-class | 3 |
| K6 weight (3) | 1: three families, about 6 font files | 2: two families | 3: none |
| K7 demo legibility (3) | 3 | 1: small type compresses badly | 3 |
| K8 distinctiveness (2) | 3 | 2 | 1 |
| K9 mobile (3) | 2: margin collapses to a sheet | 1 | 3 |
| Weighted total (max 99) | **86** | 55 | 77 |

**Decision: own, Direction A "Ledger" as the identity, with two borrowings.** From B: its density becomes the **compact density mode** (C3) and its run view layout is used for the live run screen only. From C: its progressive disclosure and large-target mobile patterns. The weights are mine and the totals are arithmetic on my scores; A leads on K1 and K2 (weight 5 each: evidence legibility and status clarity, the criteria this product is judged on) and on K8; C is close (77 against 86) and beats A on weight and mobile, which is why its disclosure and touch-target patterns are borrowed. If round 1 of the mockup study (C22) shows participants finish seeded-defect tasks faster or more accurately on B or C, the decision is reopened by an ADR; preference is recorded but is not the deciding measure. **Rejected:** a framework-styled default theme (no identity, no status grammar), and a fourth "dashboard of tiles" direction (the product is a case file, not a monitoring wall).

**Tests.** Mockups A, B, C for six hero screens with identical content and identical tokens for contrast (C22). **Risks.** Three families of fonts may breach the weight budget (C15); fallback is system serif and sans stacks with Plex only for hashes. **Build notes.** Direction choice gates C3 token values but not C4 to C18.

---

## C3. Design system

**Best references.** R03 (status), R05 (semantic scale), R01 (1.4.1, 1.4.3, 1.4.11, 2.5.8, 2.3.3), R06 (`forced-colors`, `light-dark()`), R20 (fonts), R04 (banners), `14` B6.

**What they actually do.** Carbon requires at least three of symbol, shape, colour and type for a status and labels on shape-only marks; GOV.UK success banners carry a "Success" heading so meaning is not colour-only; Radix assigns each of twelve steps a job (backgrounds 1 to 2, interactive 3 to 5, borders 6 to 8, solids 9 to 10, text 11 to 12). `forced-colors` mode removes `box-shadow` and replaces colours with system keywords, so any state carried by shadow or hue alone disappears.

**Decision: own the tokens, status vocabulary and icon set; adapt the 12-step role idea; adopt the OFL fonts.** Reason: the status vocabulary is product-specific (about 48 states), and no library has it. Alternatives rejected: Carbon or GOV.UK components as a dependency (both ship build-step packages; we would import their look and still write the vocabulary); `light-dark()` as the only theming mechanism (Baseline "newly available"; a user toggle needs a `data-theme` attribute path anyway).

**Implementation design.**

*Token pipeline.* `tokens.json` (the single source) is turned into `tokens.css` by a 60-line deterministic script (not a bundler) that emits `:root` light values, `@media (prefers-color-scheme: dark) { :root:not([data-theme="light"]) { ... } }` and `:root[data-theme="dark"] { ... }`, plus `color-scheme`. A boot script `theme-boot.js` (an external 300-byte classic script in `<head>`, so CSP needs no inline hash) sets `data-theme` from `localStorage` (inside try/catch) before first paint, so there is no flash of the wrong theme. A test script computes the WCAG 2.2 contrast ratio of every foreground-background pair in both themes from `tokens.json` and fails the build below the stated minimum; the same pairs are re-checked in the browser by axe-core as a differential.

*Colour, computed.* The following values were run through the WCAG relative-luminance formula in this session (Node script, ratios shown are the minimum over the pairs named; every pair passed after the border token was darkened once from `#8A9099`):

| Role | Light | Dark | Used for | Checked pairs (ratio light / dark) |
|---|---|---|---|---|
| `bg` / `raised` / `sunken` | `#FAF8F4` / `#FFFFFF` / `#F0EDE6` | `#14171B` / `#1C2026` / `#0F1215` | page, cards, wells | n/a |
| `text` | `#1B1F24` | `#ECEEF1` | body | on bg 15.61 / 15.47; on raised 16.56 / 14.07 |
| `muted`, `faint` | `#4A525C`, `#5B636D` | `#B4BBC4`, `#9AA2AD` | secondary text, meta | muted on sunken 6.77 / 9.70; faint on bg 5.74 / 6.97 |
| `border` (component boundary, 1.4.11) | `#7D848E` | `#7C8591` | inputs, chips, table frames | on bg 3.56 / 4.81; on sunken 3.23 / 5.03 |
| `link` = `accent` = `focus` | `#0B4F8A` | `#8DBDF0` | links, primary buttons, focus ring | on bg 7.92 / 9.13; white-on-accent 8.40, ink-on-accent 9.55 |
| `mech` (mechanical pass) | `#0B6B4A` on `#E3F2EB` | `#6FD3A6` on `#10291E` | hash-matched states | 5.65 / 8.50 on its tint |
| `judge` (recorded judgement) | `#0B4F8A` on `#E4EEF8` | `#8DBDF0` on `#13263A` | model-judged labels | 7.15 / 7.81 |
| `warn` | `#8A5200` on `#FBEED6` | `#F2B655` on `#33260E` | partial, stale, caution | 5.57 / 8.14 |
| `crit` | `#A12622` on `#FBE5E3` | `#FF9D96` on `#3A1613` | mismatch, blocked, reject | 6.19 / 8.06 |
| `unk` (unknown or absent) | `#4A525C` on `#ECEAE4` | `#B4BBC4` on `#23272D` | not checked, unavailable | 6.58 / 7.75 |

Body text on every tinted background is at least 12.68. These are starting values that pass; they are not a claim of colour-vision accessibility, which is tested by emulation (C19). APCA is reported as a secondary column only (it is not the WCAG 2.2 metric, R01, R05).

*Typography.* Faces (Direction A): IBM Plex Serif 400/600 (case titles, decision text, quoted evidence), IBM Plex Sans 400/500/600 (UI), IBM Plex Mono 400 (ids, hashes), self-hosted woff2, `font-display: swap`, latin subset, OFL text shipped. Scale (rem, root 16 px): 0.8125 (meta, 13), 0.875 (UI, 14), 1 (reading, 16), 1.125, 1.375, 1.75, 2.25. Quote text 1.0625 rem at line-height 1.6, `max-inline-size: 72ch`. Numbers in tables use `font-variant-numeric: tabular-nums`; hashes use the mono face with `font-variant-ligatures: none`. Hash display: first 8 and last 4 hex characters, full value on expand with a copy button (spec-aligned, `14` B5). Minimum body size 14 px; nothing below 13 px; no text in images.

*Density.* Two modes, a setting (C12): comfortable (row 44 px, the default, and the only mode on touch) and compact (row 32 px, a Direction B borrowing). Interactive targets are at least 24 by 24 CSS px in compact (WCAG 2.5.8, R01) and 44 px on touch (the QA guide's mobile bar); spacing unit 4 px.

*Motion.* Three durations (0, 120, 200 ms), two properties (opacity, transform), standard easing. `prefers-reduced-motion: reduce` sets all to 0 and replaces the live-stream scroll-follow with a "new events" button. No autoplay animation longer than 5 seconds; the only continuously moving element is the run-progress bar, which is a determinate bar with a text percentage, not a spinner.

*Iconography.* An owned inline SVG sprite of about 40 geometric glyphs on a 16 px grid with 1.5 px strokes and `currentColor`, every icon `aria-hidden="true"` next to visible text, icon-only buttons carry `aria-label` and a 24 px minimum target. Forced-colors: icons use `currentColor`, outlines use `CanvasText`/`Highlight`, and `forced-color-adjust` stays `auto` (R06).

*Visual grammar for trust.* Solid fill with a check-seal or cross glyph = a **mechanical result** the page or the verifier recomputed (hash match, quote slice equal, rule fired). Outlined shape with a speech-mark glyph and the word "judged" = a **recorded judgement** (model entailment label, link judgement). Dashed outline with a dash-circle glyph = **absent** (not checked, unavailable, unresolved). Green hue (`mech`) is never used for anything a model judged, which enforces spec §9a's distinction between "integrity established" and "attribution judged".

*Status vocabulary (the contract).* Every status is a `StatusKey` with label text, glyph, grammar and an ARIA phrase; colour is a fourth channel and is never the only one (R03: at least three elements; R01 1.4.1).

```ts
type Grammar = "mechanical" | "judged" | "absent" | "policy";   // fill style, see above
interface StatusSpec { key: StatusKey; label: string; glyph: GlyphName; grammar: Grammar; role: "mech"|"judge"|"warn"|"crit"|"unk"|"neutral"; aria: string }

type StatusKey =
  // fetch states (spec §6), never collapsed
  | `fetch.${FetchState}`
  // evidence chip: M2's ten states (INT-052); M9's chipState returns the name, M10 owns glyph, hue and wording
  | "chip.verified_exact" | "chip.verified_ocr" | "chip.layer_only" | "chip.relocated" | "chip.hash_mismatch"
  | "chip.extractor_disagree" | "chip.hidden_text_finding" | "chip.quote_absent" | "chip.not_checked" | "chip.unavailable"
  // claim label (spec §9)
  | `claim.${Label}`
  // truth-table cell (spec §8): five values, `silent` = every required channel checked, nothing says (INT-007)
  | `cell.${CellStatus}`
  // action, ordered most to least permissive (spec §10)
  | `action.${Action}`
  // verifier verdict and certificate producer outcome: two vocabularies that never share a word (INT-001)
  | `verify.${Verdict}`        // PASS | FAIL | INDETERMINATE | NOT_APPLICABLE
  | `cert.${CertOutcome}`      // VALID | INVALID | INCONCLUSIVE
  // lifecycle (M13) and approval
  | `case.${CaseState}` | `approval.${ApprovalState}`;
```

Examples of the contract (the full table is generated from `status-specs.ts` and reviewed as a table in the QA matrix, never hand-copied): `fetch.rate_limited` = label "Rate limited", glyph clock-with-bar, grammar absent, aria "Source rate limited, not retrieved; retry after the stated time"; `chip.verified_exact` = "Verified, exact", glyph check-seal, grammar mechanical, aria "Document, text layer and quoted span all match their recorded hashes"; `cell.silent` = "Silent", glyph empty-page-with-check, grammar absent, aria "Every required source was checked and none says anything about this attribute; this is not the same as not checked"; `chip.layer_only` = "Verified on text layer only", glyph check-seal-half, grammar mechanical, role warn, aria "The stored text layer matches its hash and contains the quote; the source file is not shipped, so the layer is not tied to a file in this page"; `claim.entailed` = "Supported (judged)", glyph speech-check outline, grammar judged, aria "A model judged this passage supports the claim; a recorded judgement, not a proof"; `claim.fabricated_quote` = "Quote not in source", glyph broken-quote, grammar mechanical, role crit; `action.escalate` = "Escalate", glyph up-arrow-in-ring, with a five-step ladder glyph where the active rung is filled and its position is also given as text "3 of 5, most to least permissive". The test `status-contract.test` asserts: every `StatusKey` has a unique (glyph, label) pair, a non-empty ARIA phrase, at least three of {glyph, shape/grammar, hue, label}; and that no two keys in the same screen group share a glyph.

**Tests and acceptance.** `tokens-contrast` (all pairs, both themes); `status-contract`; `no-colour-only` (a Playwright run with `forcedColors: "active"` and a greyscale filter screenshot diff that must still allow a reviewer to distinguish all states in the catalogue page; the catalogue page `/design/status` lists every key and is itself in the QA matrix); `reduced-motion` (all durations compute to 0); `forced-colors` (no state conveyed by box-shadow alone). **Risks.** Plex file weight (C15); the grammar is unproven for comprehension (H-UI5 and a recognition test in round 1: 12 icons, 5 participants, show label-less glyph and ask meaning; target 80% correct for the core set, otherwise the label stays mandatory next to every glyph, which it already is). **Build notes.** Token script and contrast test first; then the status contract; then the glyph sprite; then the catalogue page.

---

## C4. Console runtime and view API

**Best references.** R08 (what a typical agent UI does with untrusted text), R06 (Trusted Types, import maps, SSE, WebCrypto), R07 (pdf.js advisories), R21 (view-layer candidates), R17 (the same core behind MCP).

**What they actually do (read in code).** The `gpt-researcher` frontend passes agent output through `sanitizeHtml` (DOMPurify, with a text-escape fallback) and assigns the result to `innerHTML` (`scripts.js`, `sanitizeHtml` and `addAgentResponse`); its own comment states the content is "derived from untrusted sources". That is a sanitiser-as-boundary design: safe while the sanitiser and its configuration are right. It also ships zero ARIA, no live region and no theme or reduced-motion handling (R08). pdf.js has had two high-severity advisories for arbitrary JavaScript execution on opening a malicious PDF, the latest published 2026-07-28 (R07).

**Decision.** *Own a minimal view layer (about 600 lines) over native ES modules; adopt nothing at runtime except an optional sandboxed pdf.js.* Reason: in this product the vendor's text is the attacker's channel (spec §5, principle 7). A structurally text-only builder removes the sink instead of sanitising it, and the whole console (about 40 modules) stays reviewable by the `security-reviewer` and by a reader. Lit, Preact and htm (R21) are credible and small; their template systems also have raw-HTML escape hatches that we would have to ban by lint, and Preact needs a JSX or `htm` convention. This is a **bake-off candidate, not a closed question**: add "console view layer" to the D-011 bake-off list with the criteria (zero HTML sinks by construction, bytes shipped, lines owned, keyboard and ARIA ergonomics); until it runs, the owned builder is the default. Rejected: sanitising HTML from models at the boundary (R08's approach), and any markdown rendering of model or vendor text.

**Implementation design.**

*Languages and the shared core.* Console code is plain ES modules with JSDoc types, checked by `tsc --checkJs --noEmit` (no emit, no bundler). The policy engine and the verifier core must also run in the page (flip panel, chips), so they are authored in erasable-syntax TypeScript and emitted **one file per module** by `tsc` into `web/vendor/core/` (1:1 transpile, deterministic, no bundling or tree shaking); each emitted file's SHA-384 goes into the page's import map `integrity` table (R06), generated at build, so the browser refuses a module that differs from what the server's manifest recorded. **D-007 amendment (INT-051; register section 5 notes; spec feedback F1):** `tsx` alone cannot produce browser modules, so D-007 gains this clause: server and tooling TypeScript runs under `tsx`; every module that also ships to the browser (the policy engine of M5a, the verifier core of M9, the chip function) is authored in erasable-syntax TypeScript (no enums, namespaces or parameter properties; enforced with the `erasableSyntaxOnly` compiler option, TypeScript 5.8 and later), imports no `node:` module, takes its host services (SHA-256, clock) as injected parameters, and is emitted 1:1 per file. The in-page SHA-256 is asynchronous (`SubtleCrypto.digest`), so the injected hash is `(bytes: Uint8Array) => Promise<Uint8Array>`; M9's `chipState` already has that shape (component 15), M5a's interpreter and M9's V6 to V8 recompute module must too (NOT VERIFIED against their code, which was not written).

*Safe DOM builder.*

```ts
// dom.js: the only way views create nodes. No innerHTML, outerHTML, insertAdjacentHTML, document.write, eval, Function, setAttribute("style").
type Child = Node | string | null | undefined | false;
declare function h<K extends AllowedTag>(tag: K, attrs: AllowedAttrs<K>, ...kids: Child[]): HTMLElementTagNameMap[K];
// strings become text nodes; attribute allowlist per tag; href only from route builders or from externalLink(); event handlers by addEventListener only
declare function untrusted(u: UntrustedText): HTMLElement;   // <bdi dir="auto"> text node; control and bidi-override characters rendered as visible escapes (U+202E shown as "<U+202E>"); mixed-script flag shown as a chip
declare function externalLink(url: string): HTMLElement | HTMLElement[];  // http/https only; shows origin as text; rel="noopener noreferrer"; never auto-follows
```

A lint (`no-html-sinks`) fails the build on any use of the banned sinks; a Playwright test injects a corpus (script tags, `javascript:` URLs, `onerror`, SVG with script, bidi overrides, homoglyph vendor names, 1 MB strings, null bytes, Zalgo text, an `UntrustedText` with `</script>`) into every vendor-derived field of every screen and asserts: no script runs, no new network request, no layout overflow, the rendered text equals the input, bidi and control characters are visibly escaped.

*Headers and policy.* `Content-Security-Policy: default-src 'none'; script-src 'self'; style-src 'self'; img-src 'self' blob:; font-src 'self'; connect-src 'self'; worker-src 'self'; base-uri 'none'; form-action 'self'; frame-ancestors 'none'; require-trusted-types-for 'script'; trusted-types plumbline-static; frame-src <viewer-origin>`, plus `X-Content-Type-Options: nosniff`, `Referrer-Policy: no-referrer`, `Cross-Origin-Opener-Policy: same-origin`, `Permissions-Policy` denying everything. Trusted Types (Baseline 2026, newly available, R06) turns any stray HTML sink into a TypeError; the single policy `plumbline-static` only wraps worker URLs. Dynamic geometry (highlight rectangles, bars) uses SVG attributes or CSSOM property assignment, never inline `style` attributes; that CSSOM assignment is permitted under `style-src 'self'` is **NOT VERIFIED** and is test CSP-1.

*Session and API.* The server binds `127.0.0.1` by default. A session cookie (`HttpOnly; SameSite=Strict; Secure` when served over https) authenticates the console; mutating requests carry a per-session CSRF token header; EventSource cannot set an `Authorization` header (R06), which is why the console uses cookies and the MCP and A2A adapters use bearer tokens. The view API is JSON over HTTP; every response is a view model validated against a JSON Schema document shared with the server, and any view-model validation failure renders the "unexpected data" error state (C13), never a partial screen.

```
GET  /api/v1/cases                         list      POST /api/v1/cases              intake
GET  /api/v1/cases/{id}                    CaseView (header, banner model, attention items)
GET  /api/v1/cases/{id}/truth?valid=&known=   TruthTableView (two time axes)
GET  /api/v1/cases/{id}/claims             ClaimLedgerView        GET .../flips   FlipView
GET  /api/v1/evidence/{evId}/bytes | /layer | /raster/{page} | /quads/{page}   (content-addressed, immutable, long cache)
GET  /api/v1/runs/{runId}/events           text/event-stream; id = trace seq; resumable with Last-Event-ID
PUT  /api/v1/blobs/{rawHash}               intake upload by hash (server recomputes the hash; M13 intake caps apply)
POST /api/v1/approvals/{id}/provisional | /evidence-opened | /extend | /decision   (authenticated approver only; thin routes over M13's approval service)
GET  /api/v1/bundles/{id} | /doctor | /policy/timetravel | /memory/{caseId}
```

*Live stream protocol.* SSE with `id: <trace seq>` per event so the browser resumes after a drop (the `id` sets the last event ID, R06); event types `trace`, `state`, `budget`, `end`, plus `retry:` hint. The server replays from `Last-Event-ID` out of the JSONL trace, so refresh mid-run is lossless and never shows a half row as finished. A page opens at most one stream (the HTTP/1.1 limit is six connections per origin, R06); other tabs share it through a `BroadcastChannel` leader election, or fall back to polling `/events?after=seq`.

*Pages and state.* Top-level sections are separate HTML documents (native navigation, back/forward and focus reset for free); the **case workspace** is one document whose panel state lives in the URL fragment, `#claim=cl_…&span=sp_…&valid=…&known=…&policy=…&lens=…`, so every claim, span, as-of date and policy version is a deep link, and MCP resource links open the right view. Client state beyond the URL is limited to ephemeral UI (open drawers); preferences are in `localStorage` with try/catch (page renders correctly without it).

*Hashing and verification in the page.* A module worker `verify-worker.js` receives `ArrayBuffer`s and runs the pinned verifier core (INT-051): V0 to V4a and V5 for the parser-free locator kinds (`bytes`, `json-pointer`, `csv-cell`, `textlayer`), and V6 to V8 through the recompute module when it is loaded with the policy engine. V4b (anchors) is a separate file and does not run in the page. `crypto.subtle.digest` needs a secure context and the whole input in memory (no streaming, R06), so the console caps the in-page hash at 64 MB and shows `chip.unavailable` ("file too large to check in the browser; use `plumbline verify`") beyond it. A secure context holds for `http://127.0.0.1` and `localhost`; behaviour on `file://` is **NOT VERIFIED** (test FS-1).

*Offline dossier viewer.* `plumbline view <bundle>` serves the console read-only from the bundle on localhost. A single-file export (`dossier.html`, produced by a deterministic inliner, not a bundler) is a stretch goal gated on test FS-1 (module scripts from `file://` are expected to be blocked by origin rules, **NOT VERIFIED**, so the export would inline the modules as one classic script).

**Tests and acceptance.** `no-html-sinks` lint; hostile-string corpus (above); CSP-1 (CSSOM style assignment allowed, inline style attribute blocked, a Trusted Types violation listener reports zero in the whole QA run); SRI test (flip one byte of an emitted module and assert the page refuses it); SSE drills (drop, resume, duplicate id, server restart, 10,000-event run); API contract tests that each view model validates; `no-static-fixtures` (D-044): the console contains no data literals and every test run populates it through the server from a recorded run. **Risks.** The owned builder is a reinvention that could be less ergonomic than Lit; the bake-off decides. The in-page policy engine must match the server's byte for byte (differential test over all hero ledgers; mismatch renders "recompute mismatch", C9). **Build notes.** Order: tokens, `dom.js` and lint, CSP/boot, API contract and SSE, `verify-worker`, then screens.

---

## C5. Information architecture, navigation and the three lenses

**Best references.** R09 (list-then-drill), R10 (case manager), R11 (tabbed workbench), R04 (task-focused pages), spec §14 and F-STAGES.

**Decision: own.** Two audiences share one IA: the **analyst** works a case; the **approver** works a queue. The hero path is short; depth screens exist but are not on the demo path (spec §1a presentation rule, D-044).

**Implementation design.**

*Sitemap.*

```
/                         Home: three lenses + recent cases + sample scenarios (SAMPLE_MODE)
/cases                    Case list (filter by state, vendor, owner)
/cases/new                Intake
/cases/{id}               Case workspace (one document; panels by fragment)
    #overview             decision banner, attention items, narrative
    #truth                truth table with as-of
    #claims               claim ledger, evidence viewer, proof drawer
    #flips                minimal-flip panel
    #memory               precedents and counter-precedents
    #ledger               case ledger, bundle, verifier, audience preview
/runs/{runId}             Live run view (also embedded as the first step of a new case)
/lens/reconcile | /lens/explain | /lens/decide     standalone lenses
/approvals                Approval queue          /approvals/{id}   Approval card
/memory                   Memory and precedent browser, rule proposals
/ledger                   Ledger and bundle browser
/policy                   Policy versions and time travel (labs flag, off by default, until its roadmap gate passes; spec §21a)
/doctor                   Doctor and egress manifest
/settings                 Settings
/design/status            Status catalogue (test target)
```

*Navigation.* A top bar with landmark `nav` (Cases, Lenses, Approvals, Memory, Ledger, Policy only when the `labs` flag is on, Doctor, Settings); the Approvals link carries a text count ("Approvals, 3 waiting"), never a coloured dot alone. A "Skip to main content" link and a "Skip to decision banner" link; breadcrumbs on case sub-panels. Mobile: the bar collapses to a labelled menu button; the case workspace panels become a segmented control above the content. Consistent Help (WCAG 3.2.6, R01): a "How to read this screen" link sits at the same place on every page and opens a page-specific explainer; it is documentation, not chat.

*Lenses as standalone entry points* (F-STAGES). Each lens page has an input panel, an output panel, the equivalent CLI command and the output hash, so a reader sees that the stage alone produces the same artefact as the full pipeline.

| Lens | Input accepted | Output rendered | CLI | MCP |
|---|---|---|---|---|
| Reconcile | vendor identifiers (name, LEI, registry id), source selection, as-of | truth table, conflicts, link judgements, identity robustness | `plumbline reconcile` | `reconcile_vendor` |
| Explain | a frozen reconcile output (hash) or pasted claims plus documents | claim ledger, evidence viewer, flips, gaps | `plumbline explain` | `explain_claim` |
| Decide | a frozen fact set (hash) plus a policy version and as-of | allowed set, decision, reason codes, precedents, flips | `plumbline decide` | `get_decision` (read only; no decide tool) |

**Tests and acceptance.** `lens-equivalence`: for each lens, the output hash from the lens equals the in-pipeline hash for the six recorded scenarios (F-SAMPLE); every route is reachable by keyboard from the top bar; every deep link round-trips (reload restores the same panel, claim, span, as-of). **Risks.** A dozen screens over a young system is the pattern the organizers discount; C20 keeps the demo to the hero path. **Build notes.** Case workspace skeleton and the banner first; lenses are thin wrappers over the same view models.

---

## C6. Intake and live run view

**Best references.** R04 (error summary), R09 (live viewing of running evals, nested observations), R02 and R01 (4.1.3, 2.2.2), `12` §9 (role view), spec §21 F-BUDGET, F-SAMPLE, F-REPLAN.

**What they actually do.** Inspect shows live samples with incremental metrics and drill-down into messages and scoring; Langfuse shows nested observations with timing and cost (R09). GOV.UK moves focus to an error summary and links each message to its field (R04). The `gpt-researcher` page appends streamed output to a div with no live region (R08).

**Decision: own**, borrowing the nested-observation idea for the effect tree and the swim-lane idea from the five-visible-agent roster (spec §1a).

**Implementation design.**

*Intake form.* Fields: lens; request type (release payment, onboarding); vendor name, registry id or LEI (optional, validated by format), payee id from the ERP picker, amount and currency, requested release date (UTC date), bank account (picked from the vendor master, shown masked `…9921`; free entry is possible only in lenses that do not release), documents (file picker; drag-and-drop is an enhancement, never the only path: WCAG 2.5.7), or "use a recorded scenario" (six recorded scenarios: clean, conflicted, unresolved, sanctions hit, poisoned document, stale certificate). *Document path (INT-041):* a chosen file is hashed in the page (`RawHash`, the 64 MB cap of C4), uploaded to the content store by hash (`PUT /api/v1/blobs/{rawHash}`; the server recomputes the hash and refuses a mismatch) and submitted as `attachments {name, mediaType, size, bodyHash}` to M13's `submitCase`. The form states the labels the document will receive: "Uploaded by you: treated as written by the counterparty and as untrusted, unless your pack declares otherwise." Count, size and type caps are M13's intake caps and are displayed from its response; content checks are M2's and run after submission, so a refused document appears as a finding on the case, not as a form error. Live mode shows a **pre-run egress notice** naming, per source, what leaves in its minimised form ("LEI 5493… to GLEIF; the name only to CourtListener, because no identifier exists for it"), classified internal-sensitive, and that lookups disclose that a relationship exists (spec §5, §9a; INT-021). It names the two profiles of INT-020: the model profile (`sponsor`, `evaluation` or `local`, for example "Nemotron sponsor profile, same-family") and the disclosure profile (`public_lookup`, `identifier_only` or `offline`); a stricter profile than the pack default is always selectable, a looser one is not a user setting. Both are recorded in the run header. Then a Run button. Validation follows the GOV.UK pattern: an error summary at the top of main receives focus, each item links to its field, message text identical to the field message, no validation in a banner (R04). Redundant entry (3.3.7): the vendor identifiers resolved by the ERP picker are never asked again.

*Run view layout.* Left rail: the seven F-BUDGET phases as a vertical list, each with status glyph, elapsed and budget ("Retrieval and analysis, 41 s of 120 s"). Centre: the **event feed** (`role="log"`), one row per trace event, grouped by visible agent lane (Planner, Evidence Retriever, Domain Reasoner, Safety and Risk Evaluator, Recommendation); a row shows time, agent, the verb phrase from M7's closed `verb` registry, the `decider` (`code`, `model` or `human`), the `why_kind` badge (`rule`, `computed`, `model_reported`, `human_reported`; INT-002), the structured reason codes, and a disclosure for fact ids, effect key and cassette hit or miss. A `model_reported` rationale is placed in a collapsed block titled "Model's account, not an explanation" (spec §13); a `human_reported` note is placed in a collapsed block titled "Approver's note, not an explanation" (C10). Right: budget meters (tokens, wall clock, effects, retries) as text plus bars, the active model and disclosure profiles ("rule brain" is labelled and never mixed with LLM metrics), `Mode` (live, record, replay) with "Replayed from recorded cassettes; not a live run" in replay, and re-plan counters (`coverage.replan` visits, spec F-REPLAN). When the run ends, the stop reason (completed, budget, policy, error class) is the first line and a "Go to case" link receives focus.

*Live-region policy (WCAG 4.1.3 and 2.2.2, R01, R02).* The feed element exists in the DOM at load; it is `role="log"` with `aria-relevant="additions"`; rows are appended in batches at most every 2 s; announcements are restricted by a three-level control, **Announce: milestones (default) | all | off**, where milestones are phase changes, gate decisions, re-plans, error-class events and the stop reason. Because the stream starts automatically and updates in parallel with other content, there is a **"Pause updates" button** (2.2.2): while paused, events queue and a count is shown ("14 new events"), "Resume" flushes them; focus is never moved by a streamed row. Terminal states use `role="status"` ("Run complete: decision escalate") and failures `role="alert"`.

*Reconnect and gaps.* A dropped stream shows a `role="status"` line "Connection lost; resuming from event 482" and resumes by `Last-Event-ID`; a gap that cannot be filled shows "Events 483 to 497 could not be recovered from the trace" and marks the run `partial` rather than hiding it.

**Tests and acceptance.** Hostile and drill cases: kill the server mid-run, drop the stream, duplicate ids, a 10,000-event run (feed window of 500 rows with "load earlier"), cassette miss mid-run (the message prints the exact command that runs this input live and says which stages are deterministic and can still run on any input, INT-044, F-SAMPLE), budget exhaustion (shows partial result and the gap that remained), a `model_reported` rationale containing instructions (rendered as text in the collapsed block). Screen-reader pass: milestones only are spoken; pause works by keyboard. **Risks.** Event volume may overwhelm announcements even at milestones; the 2 s batch is a hypothesis tested with NVDA. **Build notes.** Trace event view model and the SSE endpoint first (the run view doubles as the debugging tool for every later screen).

```ts
// A read-only projection of M7's trace line (M7 component 14, v2). M10 defines no trace field of its own (INT-054).
// M7 owns: seq, at, run, mode, type, phase (1 to 7, the F-BUDGET phases), agent lane, verb (closed registry),
// decider, why (kind rule | computed | model_reported | human_reported), error, budget snapshot, prevLineHash, tenant, semconv_version.
type UiTraceEvent = Pick<TraceLine, "seq" | "at" | "run" | "mode" | "type" | "phase" | "agent" | "verb" | "decider" | "why" | "error" | "budget">
  & { kind: UiKind };          // derived in the console from `type` and `effect.port`; never sent; hash-only content by default
```
A line that lacks `phase`, `agent` or `verb` renders in the `system` lane under the "unexpected data" state (C13); the console parses no free text to recover them.

---

## C7. Truth table with as-of control

**Best references.** `07` §1 to §4 (mention-level assertions, provenance semirings), R02 (table versus grid), R01 (1.3.1, 2.5.8), `14` B5.5, spec §8.

**What they actually do.** No fetched product shows a truth table with per-cell provenance; Marble and Quantexa pitch unified views of an entity (R10, `15` §3.1) without evidence of conflict-as-data. The APG separates `table` (static) from `grid` (interactive); the pattern page does not state assistive-technology support per pattern (R02).

**Decision: own.** Semantic `<table>` with a real `<button>` inside each cell, not `role="grid"`. Arrow-key navigation is offered as an opt-in "grid keys" mode and becomes the default only if the manual screen-reader pass shows it is not worse than Tab navigation (NOT VERIFIED either way).

**Implementation design.**

*Structure.* Rows: attributes of the pack (legal name, registration number, LEI, address, status, ownership edges, sanctions screening, bank account, tax id, ...). Columns: one per source channel (with an authority-tier chip in the header: authoritative, regulated register, self-declared, secondary, synthetic), then **Resolved value**, **Status** (`CellStatus`), and **Decided by** (the rule: "most recent authoritative", "authority order", or "no rule can choose"). Each source cell shows the normalised value, the raw value on disclosure, observed time, validity interval, fetch state glyph when no value, and the independent-origin count ("2 origins: GLEIF, ERP"). A cell button opens the **cell inspector** (a panel beside the table, never a hover tooltip: WCAG 1.4.13, R01) showing the provenance expression in words, the assertions with ids, trust and confidentiality labels, evidence links to the viewer (C8), and "what would change this cell" linking to the flip panel.

*Two time axes.* Two date controls, labelled in plain words and tied to the bitemporal model: **"World as of"** (valid time) and **"We knew as of"** (recorded time). Both are `<input type="date">` with a UTC time field and an explicit "UTC" suffix; quick buttons "Now", "At decision time". Changing either re-queries the server, re-renders, and shows a **diff against the previous setting** at cell level (changed value, appeared, disappeared, status change), as text list and as a marked border pattern (not colour alone); the diff is computed on typed cells by code, not by text diffing (jsdiff in `14` B4 is therefore not needed in the core). A "Compare with the decision snapshot" toggle holds the frozen as-of of the decision.

*Statuses* (the five-valued shared `CellStatus`, INT-007). `resolved`, `unresolved` (repair-semantics conflict: both sides stored, the rule that could not choose is named), `silent` ("we checked every source required for this attribute and none says anything"; for a required positive fact M5 treats it as level 0 plus a gap, so the cell links to the gap), `not_checked` ("we did not query this source"), `unavailable` ("we tried; the source failed" with fetch state and retry time). "Silent" and "not checked" are never the same sentence, glyph or grammar: the first is a computed finding about absence, the second is the absence of a check.

*Identity robustness strip.* Above the table: `stable` or `identity_dependent` (with `completeness: partial` when capped), the possible links, and the minimal link judgements whose reversal changes the verdict; `identity_dependent` states "this verdict depends on whether X and Y are the same entity; escalation is forced".

*Large tables.* Up to about 1,000 cells render directly with `content-visibility: auto` on row groups; above that a windowed rendering keeps all rows in the accessibility tree through `aria-rowcount`/`aria-rowindex`.

**Tests and acceptance.** For each hero ledger: DOM text of every cell equals the serialised `TruthTableView`; cell diff test (mutate one assertion, expect exactly the predicted diff list); keyboard: every cell button reachable, inspector opens on Enter and returns focus on Escape; SR: row and column headers announced with each cell (NVDA pass); 200% zoom and 320 px reflow keep a usable table (horizontal scroll inside the table container is allowed by 1.4.10's table exception, to be confirmed against the text in the build, **NOT VERIFIED**). **Risks.** Wide tables on mobile; the fallback is a per-attribute card list with the same data. **Build notes.** Needs M3's `TruthTableView`; stub it from recorded scenarios, not hand data.

---

## C8. Claim ledger and evidence viewer

**Best references.** `14` B1 to B6 (W3C Web Annotation, RFC 8118, Text Fragments, Hypothesis anchoring, react-pdf-highlighter's `ScaledPosition`, pdf.js layers, the Anthropic Citations pattern), R07 (pdf.js advisories), R14 (Ding, PaperTrail, Vasconcelos), R01 (1.4.1, 1.4.11, 1.4.13), R08.

**What they actually do.** Hypothesis stores three selectors and falls back to fuzzy matching, which `14` §11.2 rejects as verification because it hides drift; react-pdf-highlighter stores scaled coordinates so highlights survive zoom (`14` B2.1); PaperTrail presents supported, unsupported and omitted categories and lowered trust while reliance continued (`14` B3.2). pdf.js draws pages and a text layer for selection; a canvas is invisible to assistive technology (`14` B2.2, B6).

**Decision: adapt `14` B5 and own the verification chips; change one thing: the console does not render vendor PDFs with pdf.js by default.** Reason: R07 lists two high-severity "arbitrary JavaScript execution upon opening a malicious PDF" advisories, 2024 and 2026, and the vendor's PDF is the attacker's file (spec §5, §7: PDF as an attack surface, isolated parser). M2 already renders pages to pixels for the visibility channel (spec §7) and owns the text layer and glyph quads. So the viewer shows **server-rendered page rasters produced inside M2's isolated process, with an overlay drawn from stored quads and the owned text layer**; the console never parses the PDF, and hashing the raw PDF bytes needs no parsing. An opt-in "Original PDF" view loads pdf.js (self-hosted, version-pinned, `enableScripting` off) inside an **`<iframe sandbox="allow-scripts">` on a separate origin** (a second localhost port), with a CSP that denies network and a `postMessage` channel carrying only bytes in and a "ready" message out; it is labelled "Renders the vendor's file in your browser. The file may be hostile." and is off for the sponsor demo.

**Implementation design.**

*Layout* (desktop, three panes, as `14` B5; mobile: ledger list, then a full-height sheet).
1. **Claim ledger** (left): rows rendered from the typed ledger (prose is derived from it, spec §9, so every sentence maps back). A row has the claim text, kind, `claim.<Label>` status (mechanical results L0 are solid; entailment is outlined "judged"), the ordinal confidence tag with the gap that caps it, a "decision-relevant" marker when the claim is in a minimal flip or an MRS set, and one **chip per cited span**: source name, page, `chip.<state>`. Filters: label, kind, decision-relevant, has finding. Sort: relevance (default) or document order. A "Narrative" view renders the dossier text where every sentence is a link to its claim id; a sentence that maps to no claim is shown with the status `claim.unattributed` and cannot be copied into an exported dossier.
2. **Source viewer** (centre): tabs **Page image**, **Text layer**, **Findings**. Page image: raster `<img>` with `alt` "Page 12 of the audit report, image of the page; the text of this page is in the Text layer tab" and an SVG overlay for quads (one rectangle per line box; scaled coordinates so zoom does not break them; outline plus tint, with a `Highlight` system-colour outline in forced-colors). Text layer: the owned visible text, `<mark>` around the verified span with visible prefix and suffix in muted text, and visually hidden bracket text "start of verified span" and "end of verified span" so assistive technology announces it. Findings: hidden-text findings, signature record (present, valid, unchanged since signing, kept as three fields), OCR confidence.
3. **Proof drawer** (right; a disclosure that opens on click or Enter, persistent and dismissible: 1.4.13): `docSha`, `layerSha` (`textLayerHash`) and `spanSha` (all `RawHash`: reproducible with `sha256sum`, INT-003), the offsets in both units (code points `start`/`end`; UTF-8 `byteStart`/`byteEnd`, INT-004), extractor version, deep link, visibility verdict and findings, signature record, L1 to L4 results, and the digest of the verifier core build that ran in this page; hashes shortened to 8 and 4 with expand and copy.

*Chip state, computed in the page.* On open, a module worker runs M9's browser hash-recheck contract (component 15, `ViewerCheckInput`) through the pinned verifier core, on the bytes this browser fetched: (0) when a bundle report exists, hash the manifest bytes and require equality with `report.input.manifestDigest` (the bytes shown are the bytes verified); (1) hash the PDF bytes (`RawHash`; absent when rights-gated); (2) hash the text-layer bytes (`RawHash` of the UTF-8 page text, reproducible with `sha256sum`; no JCS or domain tag, INT-003); (3) the span, by the `textlayer` resolver of V5 (INT-004): slice the page text by `byteStart`/`byteEnd`, require both ends on code-point boundaries, require the code-point count before `byteStart` to equal `start`, require the slice to equal `quote.exact`, and hash it against `spanSha`. A byte and code-point disagreement is `V5.LOCATOR_UNIT_MISMATCH` and renders as `chip.quote_absent` with that code in the drawer.

```ts
interface ChipInputs {
  manifestDigestMatch: boolean | "no_report" | "unavailable";
  docHashMatch: boolean | "source_not_shipped" | "unavailable";   // "source_not_shipped": rights-gated, layer-only
  layerHashMatch: boolean | "unavailable"; spanHashMatch: boolean | "unavailable";
  sliceEqualsQuote: boolean | "unavailable";                       // byte slice, boundary check and code-point cross-check
  located: "exact" | "relocated" | "absent"; extractors: "agree" | "disagree" | "single";   // LV3 as recorded by M2
  ocr?: { confidence: "low" | "medium" | "high" }; visibility: "visible" | "hidden_finding";
  core: { ran: boolean; pinned: boolean };                          // did the SRI-pinned core execute these checks in this page
  bundleReport?: { spanVerdict: Verdict; implementations: ("A" | "B")[] };   // from the bundle's verifier report
}
// pure; the name comes from M9's chipState, M10 maps it to a StatusKey and never to a colour first
declare function chipState(i: ChipInputs): { primary: StatusKey; finding?: "chip.hidden_text_finding"; agreement: "both_pass"|"browser_only"|"report_only"|"disagree"|"none" };
```
Precedence: `hash_mismatch` > `quote_absent` > `relocated` > `extractor_disagree` > `layer_only` > `verified_ocr` > `verified_exact`; `not_checked` while computing, when inputs are absent or when the core is not pinned; `unavailable` when the bytes cannot be loaded or exceed the cap. A hidden-text finding on the page is an orthogonal flag shown beside the primary state (an exact quote can sit on a page with a hidden-text finding). `relocated` is displayed as such and never silently accepted (reject fuzzy re-anchoring as verification, `14` §11.2).

*Chip rule (INT-051, INT-052).* The solid `mech` state (`verified_exact`, `verified_ocr`; the only states drawn with the `mech` hue) renders only when (a) the browser actually ran every mechanical check the state names (none of those inputs is `unavailable`; `no_report` is the absence of a second opinion, not a failed browser check); (b) those checks ran inside the pinned verifier core, meaning the emitted module whose SHA-384 is in the import map and equals the digest listed in the build manifest (published with the bundle when one exists; contradiction 2 in the revision block) (a page that cannot show a matching digest renders `not_checked`, "verifier core not pinned"); and (c) no recorded report contradicts them. `layer_only` is drawn solid in the `warn` role: the layer and quote checks are mechanical, but without the file the layer is not tied to a document in this page.

*What "the standalone verifier agrees" means in the browser (INT-051).* The offline verifier is a separate program; the page cannot run it. The page runs the pinned verifier core in a worker (implementation A) and the bundle carries a verifier report from the CLI run of **both** independent implementations (spec §13). The chip shows two lines, "Checked in this browser: pass" and "Bundle verifier report: both implementations pass", and `agreement` is `disagree` if they differ, which renders `role="alert"`: "Verifier disagreement. Do not rely on this chip." A disagreement is an alert, never a green chip (spec feedback F2). With no bundle report (a live case before a bundle exists) `agreement` is `browser_only` and the second line reads "No bundle report"; a report PASS with no browser result is `report_only` and never verified. V4b anchors and signatures are not checked in the page (browser Ed25519 support is NOT VERIFIED, M9); with no pins the chip text reads "hashes match; signer not authenticated". The browser check proves only that the bytes in this page equal the recorded hashes; it says nothing about who published them or whether they are true (spec §9a, integrity row); the drawer states this in one sentence.

*Highlight source.* Quads come from M2 (`Locator` with `start`, `end`, `byteStart`, `byteEnd`, `textLayerHash`); the console draws what is stored and does not recompute geometry from pdf.js text items (`14` B2.2).

*Export.* W3C Web Annotation target (`FragmentSelector` `page=N`, refined by `TextPositionSelector` and `TextQuoteSelector`) with our hashes as declared extension properties, RFC 8118 deep links, and PROV-O for the provenance graph (`14` B1, §11.1 item 10). The console's own viewer never relies on the `highlight` fragment parameter (browser support unchecked).

**Tests and acceptance.** *Differential:* the chip state equals the CLI verifier core on all tamper-corpus mutations (spec §13): flip a byte of the PDF, of the layer, of the span; swap an evidence blob; edit the quote; drop a page; relocate the text; expect `hash_mismatch`, `hash_mismatch`, `hash_mismatch`, `hash_mismatch`, `quote_absent`, `unavailable`, `relocated`. Added rows: remove the PDF member of a rights-gated item (`layer_only`); plant an LV3 extractor disagreement (`extractor_disagree`); alter the manifest after the report was produced (`hash_mismatch`, manifest digest); quotes with astral and combining characters (byte and code-point positions agree, else `quote_absent` with `V5.LOCATOR_UNIT_MISMATCH`; M2 DI-W01); serve a core module that differs from its SRI entry (`not_checked`, "verifier core not pinned"). *Visual:* seeded-defect screens (swapped quotation, hidden-text page, stale list). *Security:* a PDF with JavaScript, embedded files and a malicious font must never reach the console process (the corpus of spec §7 fuzzing); opt-in sandbox iframe: `sandbox` lacks `allow-same-origin`, network denied, assert no cookie access and no `parent` DOM access. *Trust:* chips never green without both lines; a snapshot test fails if `chip.verified_*` renders without `agreement ∈ {both_pass, browser_only}`, `core.pinned` and a stated reason. *Accessibility:* each chip is a `<button>` with accessible name "Audit report 2025, page 12, verified exact"; arrow keys move between chips on a page (as `14` B6); Escape returns focus to the chip. **Raster persistence contract (INT-052; spec feedback F3).** M2 DI-14 exports `pages/<n>.png` (144 dpi, deterministic PDFium render) and `layer.geo` (quads); M9 stores them as derived members under `evidence/derived/<docId>/` beside `spans.json`, `findings.json` and `manifest.json` (the text layer is the blob with role `textlayer`), each with its own hash in `bundle.json`. They are display aids outside the verified chain: a wrong raster can mislead the eye but cannot make a false quote verify, because chips hash the text layer and never the raster. The console checks each raster and quads file against `bundle.json` and shows "display aid, not part of verification" beside the page image; the opt-in Original PDF view lets a person compare. **Risks.** M2 DI-14 as written still draws pages with pdf.js; the raster export and the removal of that default are the two M2 edits this blueprint depends on. Rasters of scanned documents may be large (budget in C15); line-level highlights only where M2's measured accuracy supports them, otherwise page-and-paragraph with the label "approximate location". **Build notes.** Needs M2 quads, rasters and layer; build the chip function and its differential test before any pixels.

---

## C9. Minimal-flip panel

**Best references.** Spec §9 (MRS, MF, certificates), `08` §1 and §C, `14` B4 and B5.3, R11 (what-if sentence), R14 (Wachter, Ustun via `14`), DiCE and What-If Tool (`14` B4).

**What they actually do.** The Responsible AI dashboard states a counterfactual as one sentence about a person ("would have received the loan if their income was higher by $10,000"), computed approximately for statistical models (R11). Our decision is a deterministic function, so the panel recomputes exactly (`14` B4). DiCE contributes the idea of a few **diverse** counterfactuals (`08` C2).

**Decision: adapt** `14` B5.3 and `08` C2: exact recomputation in the page, diverse selection from the full enumeration, with the spec's fixed wording.

**Implementation design.**

```ts
interface FlipView {
  snapshot: { policyVersion: string; asOf: Iso; factSetHash: DocHash; vStar: Action };
  mrs: Array<{ evidence: Id<"ev">[]; certificate: Hash }>;                 // minimal robustly sufficient sets ("what the decision rests on")
  flips: Array<{
    id: string; removes: Id<"ev">[]; corrects: Array<{ field: string; from: Json; to: Json }>;
    result: Action; class: "vendor_correctable" | "internal_correctable" | "immutable"; certificate: Hash;
  }>;
  completeness: "complete" | "partial"; enumeration: { total: number | "at_least"; shown: number };
  gapRelevance: Array<{ source: string; wouldChangeVerdictForSomeValue: boolean; certificate: Hash }>;
  noFlipsDefect?: true;   // V does not depend on the evidence: reported as a defect, never as a strong explanation
}
```

*Layout.* Top: the fixed sentence, always present: "Under this fixed case snapshot and policy version, removing evidence E changes the computed verdict from A to B. This is a sensitivity test, not a claim about real-world causation." (spec §9). Section 1, **What this decision rests on**: each MRS set, as a list of cited evidence with chips. Section 2, **What would have to be true for a different decision**: up to five flips, selected greedily to differ in attribute and authority tier (diversity, `08` C2), ordered by cost class: vendor-correctable (ask the vendor to fix), internal-correctable (we can re-fetch or correct), immutable (a sanctions hit); the full count is shown ("7 minimal flips exist; showing 5"). Each row has a **Try it** toggle: a Web Worker runs the shared policy engine on the frozen snapshot with the edit applied and shows the verdict, the changed truth-table cells and the changed reason codes; toggling back shows a "round trip" confirmation (original verdict recovered), which doubles as a self-check on the recomputation. Section 3, **Sources not checked that could change this**: the decision-relevant gap analysis, worded "some value this source could return would change the verdict" and never as an expected value (spec §9).

*Self-checks and honesty (INT-001).* Two vocabularies are shown separately. The certificate's own outcome (`cert.VALID`, `cert.INVALID`, `cert.INCONCLUSIVE`, what the producer claims about the flip) and the re-check verdict (`verify.PASS`, `verify.FAIL`, `verify.INDETERMINATE`) from the in-page recompute (browser V6 to V8 if shipped, else the bundle report). A re-check that agrees with the producer's outcome is `verify.PASS` even when that outcome is `cert.INVALID`, and the row then reads "Certificate says the flip does not hold; re-check agrees". `verify.FAIL` shows `role="alert"` "recompute mismatch"; `verify.INDETERMINATE` shows the budget that was hit; a `cert.INCONCLUSIVE` outcome shows the budget the producer hit. `completeness: partial` is shown in the section header, not in a footnote. `noFlipsDefect` renders "No evidence change alters this decision. That means the decision does not depend on the evidence shown, which is a defect to investigate, not a strong explanation."

*Correctable versus immutable.* The class comes from the pack's attribute table (`correctableBy`), not from the UI. Immutable items carry a lock glyph and the text "cannot be corrected by the vendor or by us (for example a list hit)". A flip involving only vendor-correctable edits generates, in the Decide lens, a **"request to vendor" draft** that contains reason codes only (tipping-off safe; the counterparty notice, audience `counterparty` with disclosure `notice`, spec §13 and INT-055); whether to show even that is a LAWYER item, and nothing is sent: the draft is a preview.

**Tests and acceptance.** Browser result equals server result on every flip of every hero ledger (differential); round-trip for every toggle; a mutated certificate renders `verify.FAIL`; wording lint (the sentence appears verbatim); keyboard: toggles are checkboxes with labels that state the edit and the resulting verdict. Usability arm H-UI2. **Risks.** The in-page engine adds weight and a second place the policy can diverge; mitigated by shipping the one compiled module (C4) and the differential test. For ledgers over the brute-force bound the panel shows `partial` and the number of oracle calls. **Build notes.** Depends on M4 `FlipView`; before M4 exists, develop against flips generated from planted ground truth (M11).

---

## C10. Decision banner and reason codes

**Best references.** R04 (one banner, before the h1, role rules), R03 (status), spec §10 (allowed set, ceilings, autonomy, `Why`), `15` §7B.

**Decision: own**, following the GOV.UK banner discipline: one decision banner per case, immediately before the h1, a region landmark with a label, a heading inside it, and no meaning by colour (R04).

**Implementation design.** Banner anatomy, left to right and top to bottom:

1. **Action** `action.<Action>` with the ladder glyph and text "Escalate (3 of 5, from most to least permissive)". Release is not drawn in green; no action uses red or green as its only mark.
2. **Why**: reason codes as a list, each `code`, a plain-language sentence from the pack vocabulary, the `why_kind` badge, and links to the fact ids. The badge set has four members (INT-002): `rule` and `computed` (recomputable by the verifier, counted by `explanationCoverage`), `model_reported` (separated under "Model's account (not an explanation)") and `human_reported`. A structured human decision is a `rule` reason with `ruleId "human.approval.<code>"`: it carries the extra qualifier "Human decision", links to the signed approval record, and is shown as a recorded decision, not as a recomputed explanation (M9 counts it apart from `explanationCoverage`). Free text from a person is `human_reported`: collapsed under "Approver's note, not an explanation", rendered as untrusted text, never counted.
3. **Limits on this recommendation**: confidence as an ordinal tag with the gap ledger items that cap it ("Capped by 2 gaps"), `completeness`, and `judge_skipped: single_allowed_action` when applicable.
4. **Autonomy and approval**: autonomy level AL0 to AL3 (INT-011) with the cap reason ("capped at AL2: irreversible action"), the lane in words ("fast lane: one confirmation" for `release`, "full review: N approvers" for `release_with_approval`; INT-032), the `ApprovalState`, and the approver's queue link. Where the banner states that a case sits in the certified fast lane, the sentence names the calibrated region and the stated alpha and delta, and that the statement is about synthetic data and the calibrated region only (spec §9a, selective-release row).
5. **Frozen snapshot**: policy version, as-of, fact-set hash short, sanctions list version and age.
6. **Attention items** (at most five): the next things a reviewer should open, each a link into the viewer or panel, ordered by flip membership then gap severity; "Show all 14 items" discloses the rest (H-UI4).

The banner never shows a number that looks like a probability. A change to the underlying snapshot (list update, stale approval) replaces the banner content under `role="status"` and adds "Superseded" text, never silently.

**Tests and acceptance.** Banner text for each of five actions and each autonomy cap rendered from the decision record; lint for banned words; axe passes with the banner as `region` labelled "Decision"; one banner per page test (R04). **Risks.** Attention-item ordering may leak the recommendation to an approver who should not be anchored; for the approver-of-record the banner is replaced by the evidence-first card (C11). **Build notes.** Needs M5 `DecisionRecord` and M4 gap ledger.

---

## C11. Approval queue and approval card

**Best references.** Spec §10 and §14a (approval queue item types, default deny on timeout, friction at the gate, SoD data, identity binding, TOCTOU re-validation), R14 (Bansal, Fogliato, Buçinca, Poursabzi-Sangdeh, Akhawe), R12 (check in before critical actions), R04, R01 (2.2.1 note below, 3.3.7, 3.3.8), `15` §6 and §7B, `14` B5.4.

**What they actually do.** Magentic-UI's README says the agent "stops and checks in before taking critical actions" (R12): a confirmation, not a measure of whether the human checked. The studies in R14 say a plain explanation raises acceptance regardless of correctness (Bansal), a provisional first judgement lowers agreement with the AI at no time cost in one clinical study (Fogliato), and warning design changes compliance (Akhawe). Our approval is not a click-through; it is the gate whose catch rate feeds autonomy promotion (spec §18).

**Decision: adapt `14` B5.4 and add an evidence-first sequence, as a measured arm, default on for the approver-of-record.** Alternatives: show the recommendation first and require span opening (the spec's current text, `14` B5.4); I keep it as arm V0 and measure both. The default is a hypothesis with a pre-registered reversal rule (C22).

**Implementation design.**

*Ownership (INT-029).* There is one approval service. M13 owns storage, WebAuthn verification, step-up, the expiry clocks and the queue API; M5 owns item semantics as policy data (item types, slots, eligibility, what expiry means per type, the digest binding rule); M8 owns the principal and identity primitives. M10 renders `ApprovalItem` and its routes are thin proxies; it stores nothing and enforces nothing the service does not also enforce.

*Queue.* Item types are the eight of the shared `ApprovalItemType` (spec §10; M5 generalises them): `action`, `memory_write`, `rule_proposal`, `ladder_promotion`, `judge_loosening`, `dispensation`, `roster_change`, `emergency_ratify`. Columns: type, subject (case or proposal; `caseId` is optional for non-case items), exposure (amount and currency, money-moving types only), requester, SoD status (text), expires (`requestExpiresAt` as relative text and absolute UTC time), state (`ApprovalState`: pending, approved, rejected, expired_denied, superseded, invalidated). Sort: soonest expiry then exposure. Filters: type, state. There is **no select-all, no bulk action, no keyboard shortcut that approves**. Claiming an item (an M13 operation, separate from the request clocks below) locks it for 15 minutes (extendable) so two approvers do not review the same item by accident. Empty state: "Nothing is waiting for approval. Items appear here when a case needs a person's decision." Items the signed-in user may not approve (they are the requester or the vendor-master editor) appear with the control `aria-disabled` and a visible sentence naming the rule ("You requested this payment; approval must come from a different person (SOD-2)").

*Card for an `action` item, six steps, one per screen section, keyboard order matching visual order.* Other item types use the same frame with their own content from M5's item data: step 1 shows what changes (the diff the item binds), step 2 the evidence it names, and the confirm summary is typed per item. Which types get the evidence-first sequence (steps 3 and 4) is **Open**: a pack setting with an ADR, decided after the study (C22). Approving a `memory_write` or an attestation records `approvedBy` / `attestedBy` and never changes a trust label; the confirm text says so (SEC-W1).

1. **Facts** (no recommendation): payee, amount, release date, the release fields (payee id, account last four, amount) shown **three ways** (the request, the vendor master now, the `ReleaseBinding` that would be minted if you approve) as an ERP-versus-claim diff, any difference marked with text "differs" and a glyph; the sanctions list version and age; the SoD view (requester, editor, approver, past-approval pattern).
2. **Open the critical passages.** The spans marked critical by L4 (members of any minimal flip) are listed with chips; the reviewer opens each in the viewer (C8); each open is logged (`evidence-opened`: span id, opened-at, time visible) via the approval API; M13's `ApprovalRecord.evidenceOpened` currently keeps only `{evidenceId, at}`, so span id and dwell time are an open request to M13 (see the revision block). The sentence on the card: "Removing any one of these passages would change the outcome."
3. **Your read first.** A required choice of provisional action (release, escalate, hold, reject, or "I need more information") and an optional one-line reason, recorded before reveal (`approvals/{id}/provisional`).
4. **Reveal.** The system recommendation, reason codes and the allowed set appear with the diff from the reviewer's read. If the reviewer's read differs from the recommendation, the reason field becomes required; if the reviewer overrides toward more permissive than the ceiling, the control is not offered (the ceiling is a code rule).
5. **Decide.** Approve (only offered if the rule engine's allowed set contains release or release_with_approval and all critical passages were opened), Reject, or Escalate. A rejection asks which passage failed (`14` B5.4, a data source for the study). A confirm summary states the action in the reviewer's own words ("Release 48,200.00 EUR to Vendor X (LEI …) to account …9921, verified by attestation att_…") with a single "Confirm" button; no typed-confirmation puzzles (3.3.8). Confirm performs a WebAuthn assertion whose challenge M13 derives from the exact request digest, so the approval is bound to what this card showed (M13 §5.4); a passkey is also the 3.3.8-compliant path.
6. **Receipt.** After confirmation the card shows the broker state from M13 (`approved`, `executing`, `exec_unknown` as "outcome not known yet, not treated as a failure", `confirming`, `executed`, receipt hash, or `invalidated`).

*Dual approval.* If policy needs two approvers, the second sees only "1 of 2 approvals recorded, window closes at T" and does not see the first approver's identity or reason until they submit their own (an anchoring and collusion hypothesis from the ACFE finding in `15` §1, **NOT VERIFIED** as an effect; arm in C22).

*Expiry, invalidation and the three clocks (INT-031).* Approvals expire quickly and a list update invalidates pending ones (spec §14a). The card names three clocks in words: `requestExpiresAt` (how long this request may wait), the approval window (`approvalWindowSec`: with several approvers all must record inside it, or earlier approvals lapse), and the capability lifetime (`capabilityTtlSec`: after approval the release must execute within it, else the broker refuses and a new request is needed). Time remaining is shown as text with `role="status"` messages at stated thresholds. **"Extend review"** before expiry asks M13 to re-issue the request: the expiry is inside the hashed request (M13 §5.4), so an extension is a new request with a new nonce and challenge, issued only after the snapshot hash is re-validated; the old request becomes `superseded`, approvals already recorded on it lapse, and the card says so (the re-issue operation is an open request to M13). After expiry the item is `expired_denied` and the case moves to HELD with disposition `expired_unapproved` and a review timer (M13 T22: a queue, not a graveyard), not to CLOSED; the card becomes read-only with "Expired. The default is deny, and the case is on hold. Request approval again to start a new review", keeps the reviewer's notes, and offers **Request again** to those who may. WCAG 2.2.1 (Timing Adjustable, A) requires adjustable, extendable or removable limits unless essential; the expiry here is a security control, so we claim the essential exception only for the validity window and provide the extension within it. That exception is **NOT VERIFIED** (the text of 2.2.1 beyond a summary was not read); it is a named item for the accessibility review. If the world changes mid-review (list update), the card shows "Invalidated: sanctions list updated at T" with the two changed items as a diff, preserves notes, and requires a fresh pass limited to the changes.

*Authentication.* Approver identity is bound to an identity-provider subject (spec §14a), and the approval itself is a WebAuthn assertion verified by M13. The authentication UI follows 3.3.8: no cognitive function test, paste allowed, a passkey or IdP redirect available. The demo uses a clearly labelled **simulated identity provider** with distinct subjects for requester, vendor-master editor, approver 1 and approver 2, each enrolled with its own credential (a real passkey or a test authenticator; M13 §5.4 says both go through one verifier); the label is visible on every page where the identity appears. Signed-in users carry an `RbacRole` (INT-008), shown in settings and in "Forbidden" copy; `SiloRole` is internal and never displayed. Real IdP integration is outside the demo.

**Tests and acceptance.** *Scripted flows:* approve without opening critical passages (control absent, with the reason); approve as requester (refused by UI and by the API: the UI is never the only enforcement); reuse of an expired card (case HELD, `expired_unapproved`, re-request creates a new item); "Extend review" supersedes the old request and lapses its recorded approvals; list update mid-review; double-click confirm (one approval, idempotency key); network drop at confirm (state resolves by querying the broker, not by re-posting); two tabs on one item (lock). *Keyboard:* the entire card operable in the listed order, focus visible and never obscured by the sticky action bar (WCAG 2.4.11). *Study:* arms V0 (recommendation first), V1 (evidence-first with provisional read), with seeded-defect dossiers (swapped quotation, stale list version, unresolved conflict marked resolved; spec §18); primary metric: catch rate of seeded defects; secondary: agreement with a wrong recommendation, time on card, abandonment, perceived workload. **Risks.** Reviewers may find the provisional step slow; the pre-registered reversal rule (C22) makes the default conditional on the data. Evidence-first may be unsuitable for low-risk items; the policy can map exposure bands to V0 or V1 (a pack-level setting, with an ADR). **Build notes.** Needs M13 approval items and the broker state machine; build the card against M13's recorded scenarios.

---

## C12. Memory and precedent, ledger and bundle, doctor, policy time travel, settings

**Best references.** `05` and `11` (precedent, counter-precedent, trust), spec §11 and §13, R09 (list-then-drill), `rekor-search-ui` (R21; layout unread), R03, spec §6 (doctor), `13` (tiers).

**Decision: own**, as plain list-and-detail screens built from the same status vocabulary.

**Implementation design.**

*Memory and precedent* (`#memory` in a case; `/memory` as a browser). For a case: precedents ranked by the published score, each with outcome, **the evidence for the outcome label and its trust level**, rule-version validity (`stale_rule_diff` shown as text), and distance reasons. A separate section, **"Cases that went the other way"**, always renders: it lists the counter-precedents the counter-query returned, or states "No opposite-outcome precedent exists in memory (searched N cases)". A tainted or unproven precedent whose direction would permit is never shown in a set (INT-038): it is listed under "Excluded, not used as support" with the reason; a tainted restrictive-direction precedent is shown labelled "counter only". Judge dismissals of a counter-precedent use M6's four reasons (`rule_changed`, `fact_differs: <feature>`, `outcome_unverified`, `tainted`; INT-028). When survivorship is not corrected, or `knownShare` is below `knownShareMin`: "Weakly informed: no governed audit sample behind this outcome." The pinned retrieval snapshot id and time are shown. A "This decision used" panel lists the fact, precedent and rule-version ids (the dependency graph) and an impact preview for a retraction ("retracting this fact would change the allowed set of 3 decisions and the judge input of 5", from M6). `/memory` also lists rule proposals with their certificate (temporal-holdout precision, recall, Wilson lower bound, mutation results, trust non-amplification) as approval items.

*Ledger and bundle* (`#ledger`, `/ledger`). Case ledger entries (sequence, time, type, `why`, short hash, checkpoint marker); Merkle checkpoint and inclusion status; **verifier verdict** as `verify.PASS | FAIL | INDETERMINATE` with reason codes (`NOT_APPLICABLE` appears per level, never as a bundle verdict), and any certificate's own outcome apart as `cert.VALID | INVALID | INCONCLUSIVE` (INT-001); the unambiguous message when pins are missing, "INDETERMINATE: no relying-party pins supplied; this check used the bundle's own keys" (spec §13), and with pins a signer that is not among them is FAIL (`V2.SIGNER_NOT_PINNED`); rights-gated bodies without `--evidence-dir` say INDETERMINATE, never PASS. A **"What this does not prove"** section renders the relevant rows of the 9a table. **Audience preview** (INT-008, INT-055): the selector offers M9's four tiers as `(audience, disclosure)` pairs, Reviewer (full), Auditor (full), Auditor (redacted) and Counterparty (notice), with the table of verifier levels that survive each tier. The counterparty preview is the signed notice's content, a reason-code class and nothing else; it is unsigned, labelled "Preview. Delivery to a counterparty is not part of this release (legal review)", and tested for leakage (no list name, no source detail, no value; a planted `internal-sensitive` value never appears). "Verify in this browser" lets a person drop a bundle and a pins file onto a file input (a button path exists) and runs the pinned core in the worker (V0 to V4a and V5, plus V6 to V8 when the recompute module is loaded; never V4b); the result is presented with the same tri-state, and the page says this is implementation A only.

*Doctor* (`/doctor`). From the M1 doctor report: per channel the canary probe, last success, fetch-state counts, rate budget, credential-redaction check; environment checks (Node version with the fix text, free disk space, the engine conformance state, cassette manifest hashes); model profile; Zetaris state (**NOT VERIFIED** until a trial exists; shown as `not_checked` with that sentence); MCP tool-surface pin status for outbound MCP clients; and the **egress manifest** (every external call with its data class, for the current run, per profile). Each failing row shows a "Fix" command with a copy button. Exit codes of `plumbline doctor` map one-to-one to the page summary.

*Policy time travel* (`/policy`, behind a `labs` flag that is off by default; in spec §21a it is roadmap, and the flag stays until its gate passes: a measured benefit and a replay-equality test. With the flag off the navigation item is absent and the route and API answer with the "not enabled" state). Choose a past decision, a policy version and an as-of date; the server re-runs the deterministic stage (pure) and the page shows the allowed-set diff and a certificate status; "Proposed rule: which past decisions would change" lists each decision with before and after action and the tightening or loosening class from M5's SMT classification. It is labelled as sensitivity, not as outcome value (spec §10).

*Settings* (`/settings`). Theme (system, light, dark), density, reduced motion (system, force reduce), time display (UTC default; local time shown with UTC alongside), "show full hashes", developer mode (raw JSON of any view), labs features (off by default). Read-only: signed-in identity and `RbacRole`, model profile, disclosure profile, policy and ladder state. **Nothing in settings can weaken a safety behaviour**: approval friction, banner and autonomy caps are not user preferences.

**Tests and acceptance.** Each screen: render from recorded scenarios, a state matrix (C13), keyboard-only completion of the main task, axe, no static fixtures. Counter-precedent section present in every precedent test, including the "none exist" state. Audience-preview leakage test with a planted list hit. **Risks.** Breadth; these screens are depth, not demo, and are built after the hero path. **Build notes.** Doctor and ledger first (they are needed to debug everything), then memory, then settings, then time travel.

---

## C13. State catalogue and copy

**Best references.** R04 (error summary, banner rules), QA guide §5.11 and §5.22 (blame the right party, no raw JSON, honest empty states), spec §6 (fetch states), §9a.

**Decision: own** the state grid and a copy deck written to the principles in C1.

**Implementation design.** Every screen defines these states, each with a designed render and a test: **empty** (nothing yet, with the action that fills it), **loading** (skeleton with the same geometry, `aria-busy`, no layout shift), **ready**, **partial-evidence** (some sources missing; header states which), **degraded** (a dependency failed but the product continues: rule brain instead of model, cassette instead of live, source unavailable), **error** (this screen cannot be shown), **stale** (the underlying snapshot changed), **forbidden** (role cannot see this), **offline** (the server is unreachable), and, for screens behind the `labs` flag only, **not enabled**. Loading never exceeds one second without a text message; no infinite spinner (timeouts show the error state with a retry).

Copy deck, representative entries (all strings live in one file and are linted):

| State | Copy |
|---|---|
| Empty case list | "No cases yet. Submit a case, or run a recorded scenario to see the full flow." |
| Source not checked | "Not checked. We have not queried this source for this case." |
| Source unavailable | "Unavailable. We tried {source} at {time} and it failed ({reason}). This is not evidence about the vendor. Retry after {time}." |
| Source rate limited | "Rate limited by {source}. Retry after {time}." |
| Source blocked by policy | "Not queried. Policy {id} blocks this lookup for this case." |
| Sanctions non-match | "No match found in {list} version {v}, retrieved {t}. This is not a clearance." |
| Unresolved cell | "Unresolved. {A} and {B} disagree and no rule can choose: both authorities are equal." |
| Silent cell | "Silent. We checked {sources} and none of them says anything about {attribute}. This is not the same as not checked." |
| Partial evidence | "Partial evidence: {n} of {m} planned sources returned. Confidence is capped at {tag} by {k} gaps." |
| Degraded: rule brain | "Running without a model: the deterministic rule brain produced this. It is labelled and excluded from model metrics." |
| Cassette miss (replay) | "This input was not recorded. Run it live with `plumbline run --live --case {file}` and a model key; Doctor lists what is missing. The rule engine and the verifier can still run on any frozen fact set: use the Decide lens." |
| Hash mismatch | "The document does not match its recorded hash. Do not rely on this passage. The stored file may have been altered." |
| Verifier disagreement | "Verifier disagreement. The browser check and the bundle report differ. Do not rely on this chip." |
| Stale approval | "This approval is no longer valid: {what changed}. Review the changes and confirm again." |
| Expired approval | "Expired. The default is deny, and the case is on hold. Request approval again to start a new review." |
| Unexpected data | "We received data this screen cannot show safely. This is a fault on our side, not in your input. Reference {id}." |
| Forbidden | "Your role cannot open this. Ask {role} if you need access." |
| Offline | "Cannot reach the server. Nothing you entered is lost; we will retry." |
| Truncated flips | "Showing 5 of at least 7 flips. The search stopped at its budget; more may exist." |
| No flips | "No evidence change alters this decision, which means it does not depend on the evidence shown. Investigate." |
| Pins missing | "INDETERMINATE: no relying-party pins supplied. This used the bundle's own keys." |
| Signer not pinned | "FAIL (V2.SIGNER_NOT_PINNED): this bundle's signer is not among the keys you pinned." |
| Not enabled (labs) | "Not enabled. This feature is behind the labs flag until its checks pass." |

**Tests and acceptance.** A state matrix per screen is a generated test list (C19); the copy lint (banned words, no "OK" with no object, every error names a party and a next step); a screenshot of each state is reviewed (C19). **Risks.** Copy drift between console, MCP and CLI; one shared string table. **Build notes.** String table and lint first.

---

## C14. Accessibility (WCAG 2.2)

**Best references.** R01 (2.4.11, 2.5.7, 2.5.8, 3.2.6, 3.3.7, 3.3.8, 4.1.3, 2.2.2, 1.4.13), R02 (APG, live regions), R06 (forced-colors), R19 (axe-core, Playwright, Guidepup), R03, R04, `14` B6, QA guide §5.26.

**What they actually do.** axe-core is a rules engine for automatable checks; the `@axe-core/playwright` package runs it in Playwright; Guidepup drives NVDA (Windows) and VoiceOver (macOS) from code, not JAWS (R19). The APG pattern index does not promise screen-reader behaviour (R02). The gpt-researcher UI has no ARIA at all (R08), which is the baseline that "accessible" must clear.

**Decision: adapt.** Own the conformance plan; adopt axe-core (MPL-2.0, dev dependency, not shipped) and Playwright for automation; Guidepup for scripted NVDA runs; a recorded manual pass with a human using NVDA and keyboard. `pa11y` is not adopted (LGPL-3.0, R19).

**Implementation design.**

*Conformance targets.* WCAG 2.2 level AA for every page, plus these AAA behaviours we choose to meet: 2.3.3 Animation from Interactions (reduced motion removes non-essential motion), 2.4.13 is not claimed (AAA).

*Keyboard map.* Native controls first (links, buttons, inputs, `<dialog>` for modals with focus return). No single-character global shortcuts (this avoids needing to satisfy Character Key Shortcuts, whose text was not fetched in this session). Case workspace: Tab order = banner, attention items, panel switcher, active panel; in the evidence viewer: Tab moves between chips, Arrow keys between chips on a page, Enter opens the proof drawer, Escape closes it and returns focus to the chip (`14` B6); `Alt+Shift+` combinations are avoided because browsers and screen readers use them. Approval card: the six steps in DOM order; the sticky action bar never covers the focused element (2.4.11): scroll-padding equals the bar's height, tested with focus at every control.

*Structure.* One `h1` per page, landmarks (`banner`, `nav`, `main`, `region` for the decision banner and the persistent posture banner, `complementary` for the proof drawer, `contentinfo`), headings that follow the visible hierarchy, lists for ledgers, `<table>` with `scope`, `<caption>`, and `aria-describedby` for provenance. Route change: set `document.title`, move focus to `h1[tabindex="-1"]`, announce through `role="status"` ("Truth table, 14 attributes, 5 sources").

*Live regions.* Exactly four, all present at load and empty: the trace `log` (C6), a polite `status`, an assertive `alert`, and a per-card `status` for approval timers. No region announces more than once per 2 s; a streamed row never moves focus.

*Targets and touch.* 24 by 24 CSS px minimum at every viewport (2.5.8), 44 px on touch by our own bar; undersized inline links rely on the inline exception only in prose. Dragging has a button alternative (2.5.7). Identity entry follows 3.3.8; entered vendor data is carried between steps (3.3.7).

*Contrast and non-text.* Pairs are computed in the token test (C3); focus ring is 2 px `focus` with a 2 px offset, at least 3:1 against both neighbours in both themes (computed: 7.92 / 9.13 on `bg`); status never colour-only; forced-colors mode tested.

*Zoom and reflow.* 200% zoom and 320 CSS px width (1.4.10) keep every task possible; text-spacing overrides (1.4.12) do not clip. The truth table scrolls inside a labelled, focusable region when it cannot reflow.

*Authentication and time.* 3.3.8 as above; approval expiry per C11 (the 2.2.1 exception is a named review item).

**Tests and acceptance.** (1) axe-core through Playwright on every page and state in the matrix, both themes, zero violations at serious or critical; the exemptions list is empty by default and any exemption needs an ADR. (2) A scripted keyboard-only run of the hero flow with focus assertions. (3) `forcedColors: "active"`, `reducedMotion: "reduce"`, 200% zoom and 320 px width runs. (4) A **recorded manual pass** on NVDA with the keyboard, covering intake, run view, case banner, truth table, one claim to evidence, the flip panel, the approval card; VoiceOver is covered only if a macOS machine is available (not currently known; it is listed under "not covered"). (5) Guidepup scripts for NVDA announcements of the live regions where the harness works. (6) A human accessibility reviewer from outside the build signs off. **Risks.** Automation cannot judge reading order or whether a live announcement is useful; screen-reader behaviour of APG patterns varies (R02); no user with a disability has used this design. **Build notes.** Accessibility tests are part of each screen's definition of done, not a final phase.

---

## C15. Performance budgets for the static console

**Best references.** R16 (Core Web Vitals thresholds), R06 (digest, import maps), QA guide §5.25, `GoogleChrome/lighthouse-ci` (R19), spec F-RUN.

**Decision: own the budgets; use Lighthouse CI for enforcement.** All figures are budgets to be met or the design is revised; none is a measurement.

| Budget | Value | Basis |
|---|---|---|
| Case page JS (gzip), excluding verify-worker and policy engine | ≤ 90 KB | hypothesis: about 40 modules, no framework |
| Policy engine + verifier core (lazy, worker) | ≤ 150 KB gzip | loaded on first evidence open or flip toggle |
| CSS | ≤ 30 KB gzip | tokens + components |
| Fonts | ≤ 180 KB woff2 total, `font-display: swap`, subset; if exceeded, system serif and sans with Plex Mono only for hashes | NOT VERIFIED sizes |
| Page raster | ≤ 400 KB per page at 144 dpi, lazy | M2 produces |
| LCP | ≤ 1.5 s on the reference laptop profile (threshold 2.5 s, R16) | stricter than the 75th-percentile threshold |
| INP | ≤ 100 ms for chip open, panel switch, flip toggle (threshold 200 ms) | the flip recompute runs in a worker |
| CLS | ≤ 0.05 (threshold 0.1) | skeletons share final geometry |
| Hash 20 MB PDF in the page | ≤ 400 ms | NOT VERIFIED; cap 64 MB (digest has no streaming, R06) |
| Flip toggle recompute (ledger ≤ 14 items) | ≤ 250 ms | the spec's brute-force bound |
| Truth table 1,000 cells render | ≤ 100 ms | `content-visibility` |
| Live feed | batches ≥ 250 ms, window 500 rows, 10,000-event run without freezing | C6 |
| Server API p95 on the reference laptop for view models | ≤ 150 ms (cached evidence bytes immutable, `Cache-Control: immutable`) | content-addressed |

*Enforcement.* `lighthouserc` with budgets and assertions on a throttled profile in CI; a performance trace for the three worst interactions in each release; the QA matrix records cold and warm load times per page. Content-addressed evidence is served with long cache lifetimes and `ETag` equal to its hash. No third-party requests ever (CSP denies them); fonts, icons and workers are self-hosted. **Risks.** Plex and the raster volume are the likely breaches; the fallbacks are named. Lighthouse CI's last push was 2026-03-27; if it stalls, Lighthouse itself via Playwright is the fallback. **Build notes.** Budgets are tests from day one (the first case page already has a Lighthouse assertion).

---

## C16. MCP server

**Best references.** R17 (MCP 2026-07-28 tools page, `schema.ts`, TypeScript SDK v2, inspector, conformance framework), `12` §10.1 and §10.4 (CaMeL, MCPTox), spec §14 and §5 (restrict-only, quarantine), `10` (SEC tests).

**What they actually do (read in the spec and schema).** The 2026-07-28 revision is stateless: every request carries `_meta` with `io.modelcontextprotocol/protocolVersion` and `.../clientCapabilities` as required keys; there are no protocol sessions. `tools/list` "MAY vary by the authorization presented on the request", MUST NOT vary per connection, SHOULD be in deterministic order, and carries `ttlMs` and `cacheScope` (`"public" | "private"` in `schema.ts`). A tool has `name` (1 to 128 chars from `[A-Za-z0-9_.-]`), optional `title`, `description`, `inputSchema`, optional `outputSchema` (default dialect JSON Schema 2020-12), `icons` and `annotations`; `ToolAnnotations` is `title?`, `readOnlyHint?`, `destructiveHint?`, `idempotentHint?`, `openWorldHint?`, and clients "MUST consider tool annotations to be untrusted unless they come from trusted servers". If `outputSchema` is present, servers MUST return conforming `structuredContent` and clients SHOULD validate; a tool returning structured content SHOULD also return it as serialised text. Protocol errors (unknown tool, malformed request) are JSON-RPC errors (`-32602` in the spec's example); tool execution errors, which a model can act on, are results with `isError: true`. A result may be `resultType: "input_required"` (multi round trip). Stateful tools use explicit handles; "for authenticated servers, a handle is a name, not a capability" and must be checked against the caller on every call, be opaque, have a stated lifetime and fail with a tool execution error on expiry. Servers MUST validate inputs, rate-limit and sanitise outputs; clients SHOULD show inputs, validate results and log. The TypeScript SDK `main` is v2 (`@modelcontextprotocol/server`), "implementing the 2026-07-28 MCP spec"; the v1.x line is maintained in parallel. The conformance repository runs client and server scenarios (`npx @modelcontextprotocol/conformance server --url ...`).

**Decision.** *Adopt the v2 TypeScript SDK for transport and protocol handling; own the tool contracts, scope model, handle store and output typing.* Reason: the protocol is moving fast and the SDK tracks it; the part that is ours is what the tools mean. The SDK licence is a transition from MIT to Apache-2.0 (both permissive; record in the dependency review). Alternative rejected: a hand-written JSON-RPC server (more owned code, more drift from a fast-moving spec). Stateless HTTP is the primary transport; stdio is offered for local clients; both serve the same tool set.

**Implementation design.**

*Principle: one core, four adapters.* Each tool body is `core.<fn>(principal, args)` with the same function the console API and CLI call; the adapter only maps types. `tools/list` is generated from the registry of `(name, requiredScope, inputSchema, outputSchema, annotations)`.

*Scopes, and why there is no approve tool on the wire.* Scopes: `case:read`, `case:submit`, `vendor:reconcile`. The scope registry contains no approval, promotion, rule-edit or memory-write scope, and no such tool exists in the registry at all, so the sentence "no tool can approve" is enforced by absence, not by a check. `tools/list` returns only tools the presented token's scopes allow (allowed by the spec), in alphabetical order: `case:read` lists `explain_claim`, `get_decision`, `verify_bundle`; adding `case:submit` lists `submit_case`; adding `vendor:reconcile` lists `reconcile_vendor`. Calling an unlisted tool returns the protocol error for an unknown tool (it does not confirm existence). `cacheScope: "private"` with a short `ttlMs` (values NOT VERIFIED against client behaviour). Scopes are capabilities of an external client, not roles (INT-008): a token maps to the data-access identity `SiloRole: agent` and never to an `RbacRole`, which only console users carry. Tokens are OAuth 2.0 bearer tokens audience-bound to the Plumbline resource; no token passthrough; the approval API listens on a different path and audience, requires an interactive IdP session, CSRF protection and step-up, and rejects bearer tokens (test: the approval route with an MCP token returns 401).

*Shared definitions.*

```json
{
  "$schema": "https://json-schema.org/draft/2020-12/schema", "$id": "urn:plumbline:schema:common:1",
  "$defs": {
    "UntrustedText": { "type": "object", "additionalProperties": false, "x-plumbline-untrusted": true,
      "required": ["untrusted", "trust", "origin", "text"],
      "properties": { "untrusted": { "const": true }, "trust": { "enum": ["EXTRACTED", "UNTRUSTED"] },
        "origin": { "type": "string", "pattern": "^ev_" }, "text": { "type": "string", "maxLength": 4000 } } },
    "Handle":  { "type": "string", "pattern": "^h_[a-z2-7]{26}$" },
    "CaseId":  { "type": "string", "pattern": "^case_[A-Za-z0-9_-]{8,64}$" },
    "Action":  { "enum": ["release", "release_with_approval", "escalate", "hold", "reject"] },
    "RawHash": { "type": "string", "pattern": "^sha256:[0-9a-f]{64}$" },
    "DocHash": { "type": "string", "pattern": "^jcs:[0-9a-f]{64}$" },
    "Hash":    { "type": "string", "pattern": "^(sha256|jcs|com):[0-9a-f]{64}$" },
    "Iso":     { "type": "string", "format": "date-time" },
    "Error": { "type": "object", "additionalProperties": false, "required": ["ok", "error"],
      "properties": { "ok": { "const": false }, "error": { "type": "object", "additionalProperties": false,
        "required": ["class", "code", "message", "retryable"],
        "properties": { "class": { "enum": ["transient", "validation", "budget", "policy", "fatal"] },
          "code": { "type": "string" }, "message": { "type": "string" }, "retryable": { "type": "boolean" },
          "fix": { "type": "string" }, "example": { "type": "object" } } } } }
  }
}
```

The three hash definitions follow INT-003: the prefix says which digest kind a value is, and each field uses the narrowest one (document, layer and span hashes are `RawHash`; `factSetHash` is `DocHash`). Vendor-derived strings (names, quotes, registry remarks, claim text built from documents) appear **only** as `UntrustedText` objects, never as bare strings, so a consuming agent cannot treat them as plain text by accident; the `x-plumbline-untrusted` keyword marks them for tools that read the schema, and the structural shape means a validator that ignores unknown keywords still sees a different type (annotations are untrusted by spec, so the structure carries the guarantee). No tool `description` or `title` contains vendor-derived text.

*The five tools.* Output schemas are `oneOf` of the success object and `$defs/Error`, discriminated by `ok`, so the MUST-conform rule is unambiguous for error results (whether an `isError` result must also match `outputSchema` is not stated in the pages read; **NOT VERIFIED**, and the `oneOf` makes both readings valid).

1. `reconcile_vendor`: scope `vendor:reconcile`; annotations `readOnlyHint:false, destructiveHint:false, idempotentHint:true, openWorldHint:true`. Starts a reconcile (the Reconcile lens) and returns a handle.
```json
{ "name": "reconcile_vendor", "title": "Reconcile a vendor",
  "description": "Collect what internal systems and public registries say about one vendor and report where they agree, disagree or are unchecked. Performs outbound lookups that disclose the vendor identifier to the listed sources. Handles expire after 24 hours of inactivity. Does not decide, approve or release anything.",
  "inputSchema": { "type": "object", "additionalProperties": false, "required": ["vendor", "idempotencyKey"],
    "properties": {
      "vendor": { "type": "object", "additionalProperties": false, "anyOf": [{"required":["name"]},{"required":["lei"]},{"required":["registryId"]}],
        "properties": { "name": {"type":"string","maxLength":300}, "lei": {"type":"string","pattern":"^[A-Z0-9]{20}$"},
          "registryId": {"type":"object","required":["jurisdiction","id"],"properties":{"jurisdiction":{"type":"string","pattern":"^[A-Z]{2}$"},"id":{"type":"string","maxLength":64}}} } },
      "asOf": { "$ref": "urn:plumbline:schema:common:1#/$defs/Iso" },
      "sources": { "type": "array", "items": {"type":"string"}, "maxItems": 12 },
      "idempotencyKey": { "type": "string", "minLength": 8, "maxLength": 128 } } },
  "outputSchema": { "oneOf": [ { "$ref": "#/$defs/ReconcileOk" }, { "$ref": "urn:plumbline:schema:common:1#/$defs/Error" } ] } }
```
`ReconcileOk` = `{ ok:true, handle, state:"working|complete|partial|failed", completeness:"complete|partial", identity:"stable|identity_dependent|not_computed", rows:[{ attribute, status:"resolved|unresolved|silent|not_checked|unavailable", decidedBy, value: UntrustedText|number|boolean|null, factIds:[...], origins:int, fetchStates:{...} }], gaps:[...], resource: resource_link }`. A call with no name and no identifier returns a validation error with `fix` and a working `example` (the "careless caller" case); nothing is fetched.
2. `explain_claim`: scope `case:read`; `readOnlyHint:true, openWorldHint:false`. Input `{ caseId | handle, claimId }`; output `{ ok:true, claim:{ id, text: UntrustedText, kind, label, confidenceTag, capBy:[gapId] }, citations:[{ evidenceId, spanId, quote: UntrustedText, hashes:{ doc, layer, span } (each RawHash), locator (with `unit:"codepoint"` and `byteStart`/`byteEnd`), checks:{ L0, L1, L2 }, serverVerifier: "pass|fail|not_checked" }], flips: resource_link, gaps:[...] }`. The quote is the code-supplied text; the model never produced it.
3. `verify_bundle`: scope `case:read`; `readOnlyHint:true`. Input `{ bundle: { hash } | { handle }, pins?: [{ keyId, publicKey }], evidenceMode?: false }`. Output `{ ok:true, verdict:"PASS|FAIL|INDETERMINATE", levels:{ <level>: "pass|fail|indeterminate|not_applicable|skipped" } (keyed V0 to V8 including V4a, V4b and V6a), reasonCodes:[...], implementations:["A"] | ["A","B"], doesNotProve:[<fixed 9a rows>] }` (INT-001: the verifier's vocabulary, with no `INVALID`). Without caller-supplied `pins` the verdict can only be `INDETERMINATE`; with pins, a signer outside them is `FAIL` (`V2.SIGNER_NOT_PINNED`). The tool never fetches a bundle from a URL the caller gives (SSRF).
4. `submit_case`: scope `case:submit`; `readOnlyHint:false, destructiveHint:false, idempotentHint:true`. Input `{ idempotencyKey, lens, requestType, vendor, amount:{ value:"decimal string", currency }, payeeId?, requestedReleaseDate?, documents?:[{ name, mediaType, contentBase64 }] }`. The adapter writes each document's bytes to the content store by hash and passes M13 `submitCase` the `attachments {name, mediaType, size, bodyHash}` (INT-041); the documents are labelled counterparty-authored and untrusted unless the pack says otherwise. Count, size and type caps are M13's intake caps (placeholder defaults here: 5 documents, 10 MB each, to be confirmed by M13); content checks are M2's and never run in the adapter. Output `{ ok:true, caseId, handle, state:"queued", humanApproval:{ required:true, via:"console" } }`. It creates a case and a **human review item**; it never executes a release and returns no capability.
5. `get_decision`: scope `case:read`; `readOnlyHint:true`. Input `{ caseId | handle }`. Output `{ ok:true, caseId, state, decision?:{ action, reasonCodes:[{ code, ruleId, whyKind }], autonomy, approvalState, confidenceTag, completeness, policyVersion, asOf, factSetHash }, links:[resource_link] }`. There is no `decide` tool; the decision is read, not requested.

*Handle semantics.* A handle is `h_` plus 26 base32 characters (128 random bits), opaque, stored server-side with the owning principal (token `sub`, `aud`, client id), the scope used, the idempotency key and an expiry (24 hours of inactivity, stated in the tool description as the spec advises). Every call re-checks principal and scope. Unknown, expired and other-principal handles return the same `HANDLE_NOT_FOUND_OR_EXPIRED` execution error, so there is no existence oracle. A retry with the same `idempotencyKey` and equivalent arguments returns the same handle; the same key with different arguments is `validation`. Because the effect layer's `ctx.ids` is deterministic in replay, handles need an unguessable source: M7 adds the secret-random port `ctx.ids.secret(bytes)` (base64url, OS CSPRNG; register section 2.2, INT-056). In `live` it is fresh randomness; in `record` the value is generated and written to the cassette; in `replay` it returns the recorded value, a fixed value and never fresh randomness, so replayed traces and handle ids are byte-equal (spec feedback F11). Handles are names, not capabilities and expire, so a published cassette discloses no usable access; handle values never enter the normalised trace.

*Errors.* `validation` becomes `isError:true` with `fix` and `example`; `transient` adds `retryable:true`; `budget` and `policy` are execution errors with the class named; `fatal` is a protocol `INTERNAL_ERROR` carrying an opaque reference id only. Messages are system text, never echoing vendor strings.

*Pinned surface.* The hash of the sorted list of `(name, description, inputSchema, outputSchema, annotations)` is published in the server card and the doctor page; a change fails the `surface-pin` test (the same pinning Plumbline applies to servers it calls, `12` §10.1).

*`input_required`.* The server never returns it: approvals and step-up authentication are out-of-band human steps in the console, not elicitations a model can answer.

**Tests and acceptance.** MCP-01 protocol-version negotiation and a missing required `_meta` key return the protocol errors; MCP-02 `tools/list` is deterministic and identical across repeated calls; MCP-03 the list varies with scope exactly as above; MCP-04 an automated search finds no tool, scope, route or schema field containing approve, promote, rule edit or memory write reachable with MCP or A2A credentials; MCP-05 unknown tool and malformed arguments give protocol errors, semantic problems give `isError`; MCP-06 every output (success and error) validates against `outputSchema` across a fuzzed input set; MCP-07 handle drills (wrong principal, expired, replay from another principal, guessed handle, same key different arguments) with identical error shape; MCP-08 **canary propagation**: plant a unique marker string in a vendor document, a registry remark and a source name, run every tool, and assert the marker appears only inside `UntrustedText` objects and never in a description, title, error message or log line; MCP-09 an injection document asking the "client" to call `submit_case` with release semantics yields no release and no capability in any output; MCP-10 `submit_case` idempotency and the broker receipt count staying zero; MCP-11 audience-mismatch and passthrough tests; MCP-12 rate limits and size caps; MCP-13 `surface-pin`; MCP-14 the official conformance server scenarios and the MCP Inspector against both transports, the Inspector run recorded as a manual check. **Risks.** The v2 SDK and spec are weeks old (v2 released 2026-07-27); client behaviour with `outputSchema` plus `oneOf` is unproven; `x-plumbline-untrusted` is a convention of ours, not protocol. **Build notes.** Registry and schemas first (they are also the contract for the console API's view models), then the handle store, then the five bodies.

---

## C17. A2A server

**Best references.** R18 (`a2a.proto`, a2a-js, TCK, inspector, discovery), `12` §10.2 and §10.4, Habler et al. on A2A threats (`12`, abstract not fully read), spec §14 and §5.

**What they actually do (read in `a2a.proto`).** `AgentCard` has required `name`, `description`, `supported_interfaces` (each `url`, `protocol_binding` open string with `JSONRPC`, `GRPC`, `HTTP+JSON` as core, optional `tenant`, `protocol_version`), `version`, `capabilities` (`streaming`, `push_notifications`, `extensions`, `extended_agent_card`), `security_schemes`, `security_requirements`, `default_input_modes`, `default_output_modes`, `skills` (`id`, `name`, `description`, `tags` required; `examples`, `input_modes`, `output_modes`, per-skill `security_requirements`), optional `provider`, `documentation_url`, `icon_url` and `signatures` (JWS: `protected`, `signature`, `header`). `TaskState` is `UNSPECIFIED, SUBMITTED, WORKING, COMPLETED, FAILED, CANCELED, INPUT_REQUIRED, REJECTED, AUTH_REQUIRED` (JSON spelling `TASK_STATE_*`); the proto comments define `REJECTED` as "the agent has decided to not perform the task" and call `INPUT_REQUIRED` and `AUTH_REQUIRED` interrupted states. A `Task` has `id`, `context_id`, `status` (`state`, `message`, `timestamp`), `artifacts`, `history`, `metadata`; a `Part` is one of `text`, `raw`, `url`, `data` plus `metadata`, `filename`, `media_type`; an `Artifact` has `artifact_id`, `name`, `description`, `parts`, `metadata`. Methods: `SendMessage`, `SendStreamingMessage`, `GetTask`, `ListTasks`, `CancelTask`, `SubscribeToTask`, push-notification config methods, `GetExtendedAgentCard`; `SendMessageConfiguration` includes `return_immediately`. The recommended discovery location is `https://{domain}/.well-known/agent-card.json`. The a2a-js README states v1.0 stable with an opt-in v0.3 compatibility layer.

**Decision.** *Adopt `a2a-js` v1.0 for the protocol surface; own the card, the state mapping and the artifact contracts.* Alternatives: hand-rolled JSON-RPC (drift); the gRPC binding (extra dependency, not needed). We expose `JSONRPC` and `HTTP+JSON`. A2A client use stays on the roadmap (spec §21a).

**Implementation design.**

*Agent Card (illustrative; every bracket is filled at build, nested security field spellings are taken from the proto).*
```json
{ "name": "Plumbline", "description": "Reconciles what internal systems, public registries and documents say about a vendor, verifies cited passages against stored source text, and returns evidence for a release decision. Decision support; it does not release payments.",
  "supportedInterfaces": [ { "url": "https://<host>/a2a", "protocolBinding": "JSONRPC", "protocolVersion": "1.0" },
                           { "url": "https://<host>/a2a/rest", "protocolBinding": "HTTP+JSON", "protocolVersion": "1.0" } ],
  "provider": { "organization": "<org>", "url": "<url>" }, "version": "<semver>", "documentationUrl": "<url>",
  "capabilities": { "streaming": true, "pushNotifications": false, "extendedAgentCard": true },
  "securitySchemes": { "oauth": { "oauth2": "client credentials; scopes case:read case:submit vendor:reconcile" } },
  "defaultInputModes": ["application/json", "text/plain"], "defaultOutputModes": ["application/json"],
  "skills": [
    { "id": "reconcile-vendor", "name": "Reconcile a vendor", "description": "...", "tags": ["vendor","reconcile"], "examples": ["..."] },
    { "id": "explain-claim",   "name": "Explain a claim", "description": "...", "tags": ["evidence","explain"] },
    { "id": "verify-bundle",   "name": "Verify a decision bundle", "description": "...", "tags": ["audit","verify"] },
    { "id": "submit-case",     "name": "Submit a case for human review", "description": "...", "tags": ["case","submit"] } ],
  "signatures": [ { "protected": "<JWS protected header>", "signature": "<JWS signature>" } ] }
```
`pushNotifications` is **false** on purpose: push configuration makes the server call a caller-supplied URL, an SSRF and egress risk the egress manifest cannot allow. The signing procedure (JCS canonicalisation and JWS profile, spec section 8.4) could not be read through the fetch and is **NOT VERIFIED**; the card is signed by a dedicated card key whose public hash is published out of band and pinned in documentation, never only inside the card.

*State mapping (corrects `12` §10.2; INT-063 a, b; INT-030).* The JSON spellings of A2A 1.0.0 are `TASK_STATE_*`; the table abbreviates them. Approval waiting is a case state held by M13, not a task state: a decision run ends at `decision.final`, and the A2A task ends with it. `INPUT_REQUIRED` is therefore used only for in-run questions.

| Plumbline condition | A2A state (`TASK_STATE_…`) | Detail |
|---|---|---|
| request accepted, queued | `SUBMITTED` | task id returned immediately when `return_immediately` is set |
| pipeline phases 1 to 6 running | `WORKING` | `status.message` carries the phase name from the closed vocabulary; streamed updates mirror the trace |
| input missing or ambiguous (for example only a name that matches three entities) | `INPUT_REQUIRED` | the reply may supply an identifier; it is `UNTRUSTED`, may narrow a lookup and never selects a release field |
| caller needs a higher scope or the extended card | `AUTH_REQUIRED` | |
| analysis finished, any action including `reject`, `hold`, `escalate` | `COMPLETED` | **a policy `reject` is a completed task with an artifact**, not an A2A `REJECTED` |
| `submit-case` run finished; the case now awaits a person | `COMPLETED` | artifacts `decision-record` and `case-receipt` (`caseId`, case state, console link, `humanApproval: required via console`). No message part can approve; an approve-like request is answered with a typed refusal and changes no approval state |
| analysis finished but budget-capped with a usable result | `COMPLETED` | artifact `completeness: partial`, gap list in metadata |
| request refused before work: out of scope, intake guard failure, caller not permitted | `REJECTED` | A2A defines it as the agent declining the task |
| unrecoverable error, or budget exhausted with no usable result | `FAILED` | `ErrorClass` and a system-text reason |
| caller cancels before a release capability exists | `CANCELED` | cancel never revokes a capability once issued; that is a console action |

Artifacts: `decision-record` (a `data` Part, `media_type: application/json`, metadata with the schema hash and `completeness`), `truth-table`, `claim-ledger` (data Parts), `case-receipt` (a data Part, `submit-case` only), `dossier-bundle` (a `url` Part to an authenticated bundle download with `filename` and `media_type: application/zip`; bundles are large). Vendor-derived text appears only as the same `UntrustedText` object shape, and any text Part carrying vendor text sets `metadata["plumbline.untrusted"] = true`. History is hash-only for model content, as in the trace.

**Tests and acceptance.** A2A-01 the card validates against the proto-derived schema and is served at the well-known path; A2A-02 the card signature verifies with the published key and tampering fails; A2A-03 state-machine property test (no illegal transition, terminal states final, `INPUT_REQUIRED` resumable); A2A-04 a policy `reject` case ends `COMPLETED` with action `reject` (state names checked in their `TASK_STATE_*` spelling); A2A-05 an intake-guard refusal ends `REJECTED`; A2A-06 approve-like message content never changes approval state (prompt-injection corpus); A2A-07 untrusted marking and canary propagation (as MCP-08); A2A-08 push-notification methods return the documented unsupported error and no outbound request is made; A2A-09 `a2a-tck` and `a2a-inspector` runs (what they cover was not read; **NOT VERIFIED**); A2A-10 `submit-case` ends `COMPLETED` with a `case-receipt`, creates a human review item and no capability, and needs scope `case:submit`. **Risks.** A2A hides internal state ("opaque"), right for a boundary and wrong inside (`12` §10.2), so roles never talk A2A internally; card signing details unread; the fourth skill, `submit-case`, is adopted here for parity with the MCP tool and changes spec §14's skill list (F12); `get_decision` has no A2A skill, so an A2A caller reads the decision from the completed task's artifacts. **Build notes.** Card, state machine and artifacts after MCP, reusing the same core and error taxonomy.

---

## C18. CLI

**Best references.** Spec §6 (doctor exit codes), §14, §21 F-RUN and F-STAGES, QA guide §5.11 (honest failure), R17 and R18 (conformance runners).

**Decision: own.** One executable, subcommands over the same core functions, human text and `--json` output that validates against the same JSON Schemas as MCP outputs, no colour-only meaning (a text token precedes every status; the standard `NO_COLOR` convention is honoured).

**Implementation design.**
```
plumbline run <scenario|--case file> [--live] [--lens full|reconcile|explain|decide] [--profile sponsor|evaluation|local|baseline] [--disclosure public_lookup|identifier_only|offline]
plumbline reconcile --vendor <name|--lei|--registry> [--as-of T] [--sources ...]     writes reconcile.json, prints its hash
plumbline explain   --from <reconcile-hash> | --claims <file> --docs <dir>            writes claims.json and flips.json, prints hashes
plumbline decide    --facts <hash> --policy <version> --as-of T                      writes decision.json, prints its hash
                    (the three stage commands each read a typed hashed input, write their own artefact and trace, and print the equivalent MCP call; F-STAGES, INT-063 c)
plumbline replay <trace|bundle> [--strict]                 plumbline status <caseId>
plumbline verify <bundle> --pins <file> [--evidence-dir <dir>] [--impl a|b|both] [--json]
plumbline bundle <caseId> [--audience reviewer|auditor] [--disclosure full|redacted] --out <file>
plumbline notice <caseId> --preview                        (counterparty notice preview only: unsigned, never delivered; INT-055)
plumbline doctor [--json]                                  plumbline eval [suite]       plumbline conformance [meterless|mcp|a2a]
plumbline serve [--port N]   plumbline view <bundle>       plumbline mcp [--stdio|--http]   plumbline a2a
```
There is no `approve`, `promote`, `edit-rule` or `memory write` command (the same absence as MCP). Exit codes: 0 success; 1 internal fault; 2 usage error; 3 a required dependency is down or a required check failed (doctor); 4 stopped by budget or policy with a partial result written; 10 verify `FAIL`; 11 verify `INDETERMINATE`; 12 certificate outcome `INCONCLUSIVE` (the producer's `CertOutcome`, INT-001; a re-check of a certificate exits with the verify codes). `run` prints the seven phases as they complete, ends with the decision banner as text (action, reason codes, limits, the caveat line) and writes the trace path. A cassette miss prints the F-SAMPLE message naming the live command and the missing credentials. `serve` prints the exact local URL and the posture line; it binds `127.0.0.1` and refuses `0.0.0.0` without an explicit flag and a warning. `doctor` output equals the console doctor page row for row (shared view model).

**Tests and acceptance.** Exit-code table test per command; `--json` outputs validate; golden transcripts of the six recorded scenarios; no ANSI codes when not a TTY; the lens commands produce output hashes equal to the pipeline's (F-STAGES). **Risks.** Surface growth; each command is a thin wrapper. **Build notes.** `run`, `doctor`, `verify` first, because they are what a judge runs.

---

## C19. Visual QA matrix

**Best references.** `QA_MASTER_GUIDE.md` (kept outside the repository; parts 4, 5.11, 5.20, 5.21, 5.22, 5.25 and 5.26 read for this section: the rendering matrix, the 1-to-5 screen scoring on layout, typography, copy, motion, state handling and honesty, desktop and mobile in both themes, Chromium plus WebKit plus Firefox for the core flow, zero console errors), R19 (Playwright, axe), R06 (`forced-colors`), R16.

**Decision: own** the matrix and protocol, built on Playwright; screenshots are reviewed by a person or agent other than the author.

**Implementation design.**

*Pages and states (112 states from the page groups in C5).* Home 3; case list 5 (empty, ready, 1,000 cases, loading, error); intake 6 (empty, validation errors, live egress notice, submitting, guard refusal, cassette miss); run view 8 (running, paused, reconnecting, complete, budget stop, replay, error, gap in events); case overview and banner 9 (each of 5 actions, autonomy cap, superseded, partial, degraded); truth table 10 (ready, unresolved, silent, not-checked and unavailable mix, identity-dependent, as-of diff, loading, empty, 1,000 cells, error); claims and evidence 14 (each of the ten chip states in context, hidden-text page, large document, raster failure, sandboxed original view, verifier disagreement); flip panel 6; memory 5; approval queue 5; approval card 10 (six steps in both V0 and V1 flows, stale, expired, SoD refusal, double confirm, receipt); ledger and bundle 7 (PASS, FAIL, INDETERMINATE, three audience previews, tamper); doctor 5; policy time travel 5 (the four states plus "not enabled"); settings 3; lenses 6; status catalogue 1; error pages 4 (404, 500, forbidden, offline).

*Axes.* 112 states × 2 themes × 2 viewports (desktop 1440×900, mobile 390×844, device scale factor 2) = **448 screenshots in Chromium**. The hero flow (about 20 states) repeats in Firefox and WebKit: 20 × 2 × 2 × 2 = **160**. Mode runs: `forcedColors: "active"`, 200% zoom, 320 CSS px width and `reducedMotion: "reduce"` on the hero flow and the status catalogue, about **100**; colour-vision-deficiency emulation (Chromium's DevTools protocol offers it; method names to verify at build) on the catalogue and the hero flow, about **60**. Total about **770 images per full pass**. These counts are arithmetic on the lists above; the page-state lists are generated from each screen's declared states so the matrix cannot silently shrink (a CI check fails if a declared state has no test).

*Capture protocol.* A browser context per party and run; `console`, `pageerror`, `requestfailed`, `securitypolicyviolation` and Trusted Types violation listeners attached at context creation; clock fixed through `ctx.clock`; fonts awaited (`document.fonts.ready`); animations at reduced motion except in motion tests; data from recorded scenarios through the real server (no static fixtures); output name `page.state.theme.viewport.browser.png` plus a manifest line with DOM hash, console counts, axe result and load timing. Images for the submission come only from scripted capture under `SAMPLE_MODE` with an empty credential environment (F-IMAGES).

*Console-error budget.* Zero `console.error`, zero `pageerror`, zero failed requests, zero CSP or Trusted Types violations, zero `console.warn` not on an ADR-approved allowlist, zero 4xx/5xx except the exact ones a failure drill injects and the test asserts.

*Automated pre-filters (cheap, run first).* axe-core per state; a horizontal-overflow and clipped-text detector (`scrollWidth > clientWidth` on every container); a bounding-box overlap detector for interactive elements; a target-size check (24 px, 44 px on touch); contrast recomputed from computed styles; a focus-visible check that tabs through every control and asserts a visible outline of at least 2 px.

*Screenshot review protocol.* A reviewer other than the author opens each image (not a thumbnail sheet) and scores layout, typography, copy, motion (from the run-view video), state handling and honesty from 1 to 5; anything at 3 or below is a finding; "anything that makes you hesitate" is a finding. Honesty means: no status without a computed source, no overstated wording, absence shown as absence. A finding has an id, state, severity and image path; fixes are re-shot and the earlier image is kept as evidence. After the first full review, regression uses Playwright screenshot snapshots on the 20 hero states plus structural accessibility-tree snapshots on the rest (the snapshot assertion's exact name to verify at build), so the repository does not carry 770 binary images.

*Failure drills in the matrix.* API down, stream dropped mid-run, malformed view model, raster 404, hash tamper, stale approval, cassette miss, 3G throttling, 10,000-event run, hostile strings (C4), expired session.

**Tests and acceptance.** The matrix is generated; a full pass yields zero console-budget violations, zero serious axe violations, a reviewed image and score table for every state, and no open finding at or below 3. **Risks.** Reviewer fatigue at 770 images, mitigated by the pre-filters, by splitting reviewers, and by never reviewing an image that fails a pre-filter. Cross-engine rendering differences are expected and reviewed once per engine, not pixel-diffed. **Build notes.** The state declaration (a manifest per screen) is written with the screen, not afterwards.

---

## C20. Demonstration constraints (hero flow)

**Best references.** Spec §1a presentation rule, F-DEMO, demand rows D-030 and D-044 in `01-demand-traceability-matrix.md`.

**Decision.** The console has about a dozen screens; the demo shows one path and at most two differentiators on screen (F-DEMO): (1) a claim opens its source with the verified span highlighted and the browser re-hashing; (2) the minimal-flip panel. Path: pick the "conflicted" recorded scenario, watch the run view (one cassette hit and one live-failure drill), land on the case banner, open one claim, open its chip and proof drawer, switch to the flip panel and toggle one flip with its round trip, open the approval card in the evidence-first flow, confirm, then verify the bundle in the CLI with pins. Everything else is depth for the repository and the README, not video. All footage comes from scripted runs of the real console against recorded or live runs, so the on-screen output is the evidence. **Tests.** The hero flow is a single Playwright script that doubles as the keyboard-only test and the recording source. **Risks.** The temptation to show breadth; D-044 is the guard.

---

## C21. The M10 acceptance gate (G-M10)

Spec §21b has no labelled gate for M10 (adversarial review OPS-02). This is the proposed one. M10 is accepted only when all of the following pass, with reports under `eval/reports/` that state what was not covered.

1. **Hero flow by keyboard only**, including the approval card, with focus assertions (scripted and recorded).
2. **Accessibility:** axe-core zero serious or critical on every state in the matrix in both themes; a recorded NVDA-plus-keyboard pass on the hero flow, reviewed by a person who did not build it; forced-colors, reduced-motion, 200% zoom and 320 px runs clean; the list of unexercised assistive technology (VoiceOver unless a Mac is used, JAWS, switch, voice control) published.
3. **Zero console errors, CSP violations and Trusted Types violations** across the matrix.
4. **Rendering safety:** the hostile-string corpus passes on every vendor-derived field; the PDF corpus never reaches the console process; `no-html-sinks` is green; the SRI refusal test passes.
5. **Chips:** the differential against the verifier core agrees on the whole tamper corpus, including the `layer_only`, `extractor_disagree` and unpinned-core rows; no `verified` state renders without its computed inputs and the pinned core; a disagreement with the bundle report renders an alert.
6. **Contracts:** MCP-01 to MCP-14 and A2A-01 to A2A-10 pass, the official MCP conformance server scenarios run, the A2A TCK runs, and the absence of any approve, promote, edit or memory-write surface is asserted (MCP-04).
7. **Design system:** token contrast test, status-contract test, wording lint, `no-colour-only` run.
8. **Truthfulness of data:** `no-static-fixtures`, lens equivalence for all six scenarios, view-model schema validation.
9. **Performance** budgets of C15 met on the reference profile.
10. **Visual QA matrix** fully reviewed, no open finding at or below 3.
11. **Approval enforcement:** every UI restriction (SoD, critical-passage opening, expiry, ceiling) is also enforced by M13's approval service and tested there, and re-run through M10's routes to show they add and remove nothing.
12. **User evidence:** usability rounds (C22) done and reported, or the README and deck state "not evaluated with users" and no usability claim is made.

---

## C22. Clickable mockups and the usability study (specification only; nothing is built here)

**Best references.** R15 (formative testing), R14 (Bansal, Fogliato, Poursabzi-Sangdeh, Buçinca, Ding, PaperTrail, Vasconcelos), `14` §11.3 contribution 3, `15` §7B, spec §18 (oversight efficacy, seeded defects, ethics review open), `04-practitioner-validation-plan.md` (recruitment, consent, interviewer independence, decision rules written before the data), `penpot/penpot` (R21).

**Decision: own.** Mockups are static HTML pages that use the real token file and the real status contract, so contrast and focus order are the product's. A design tool (Penpot is an option) is acceptable for sketching, but its prototype player was not examined and it cannot test keyboard or screen-reader behaviour, which the study needs.

**Mockup set (the specification).** Location `design/mockups/`, outside `src/`; every page carries a non-removable band "MOCKUP: fixture data, not a live run"; the directory is excluded from `no-static-fixtures` and from every submission screenshot. Data comes from synthetic dossiers produced by M11's generator with known planted defects.

| Set | Content | Purpose |
|---|---|---|
| M0 Direction test | For each of Ledger, Control room, Case file: (1) case overview with banner, (2) truth table with one unresolved cell, (3) claim ledger with evidence viewer and four chip states, (4) flip panel, (5) approval card at the reveal step, (6) mobile evidence sheet. 18 pages, same content, same tokens for contrast | choose the direction by tasks, not taste |
| M1 Flows (chosen direction) | F1 intake, run, case (happy); F2 conflicted case with an unresolved cell; F3 poisoned document with a hidden-text finding; F4 approval going stale; F5 seeded-defect review under V0 and V1; F6 verify a bundle and read INDETERMINATE | formative study and the oversight study |
| M2 State sheets | Empty, loading, degraded, error, partial, stale, forbidden, offline for each screen, using the copy deck | copy and state comprehension |
| M3 Status recognition | The glyph set without labels, then with labels | test the grammar |

**Study S1, formative (think-aloud), three rounds.** Round 1 on M0 (direction, glyph recognition), round 2 on M1, round 3 on the revised M1. Five participants per round (R15), 3 to 4 per group when two roles are recruited (accounts-payable approver, vendor-risk analyst); participants are people who do this work (recruited through the validation plan), otherwise informed volunteers, labelled so. Scripted tasks: find why this payment is held; decide whether passage 3 really supports claim 3; say what would change the decision; approve or reject the card. Measures: task success, time, errors, spoken confusion, glyph recognition (target 80% for the core set), comprehension of "capped by gaps" and of the ordinal tags (H-UI6). The facilitator is independent of the builder (the validation plan flags confirmation bias).

**Study S2, comparative oversight study.** Question: does the verified-evidence interface improve a reviewer's detection of planted defects and calibrate reliance, compared with a citation badge? Design: within-participant crossover with counterbalanced dossier sets and order. Interface conditions: C0 citation badge only; C2 computed chips plus flip panel (C1, claim-evidence mapping without computed state, is an optional third arm if participants allow). Approval-flow conditions inside C2: V0 recommendation first, V1 evidence-first with provisional read. Dossiers: realistic prevalence (many clean ones), planted defects from spec §18 (swapped quotation, stale list version, unresolved conflict marked resolved), plus a wrong-recommendation case for reliance. Pre-registered hypotheses:

| Id | Hypothesis | Primary measure | Disconfirmed if |
|---|---|---|---|
| H-UI1 | Computed chips (C2) detect planted wrong citations more often than badges (C0) | catch rate | the interval for the difference includes 0 or favours C0 |
| H-UI2 | The flip panel raises detection of "unresolved marked resolved" | catch rate on that defect | as above |
| H-UI3 | V1 lowers agreement with a wrong recommendation without raising median time on card by more than 25% | wrong-agreement rate; median time | wrong-agreement falls by less than 10 percentage points, or median time rises by more than 50%: the default reverts to V0 by ADR |
| H-UI4 | Five attention items first detect at least as well as the full list and are faster | catch rate; time | catch rate is lower with an interval excluding 0 |
| H-UI5 | Direction A is preferred and no slower than B or C on S1 tasks | descriptive only | no claim is made from preference |
| H-UI6 | Reviewers read ordinal tags and "capped by gaps" correctly | comprehension at or above 80% | below 80%: copy or visuals are redesigned |

**Sample size.** A two-proportion comparison detecting catch rates of 0.40 versus 0.70 (difference 0.30) at 5% two-sided error and 80% power needs about 2 × (1.96 + 0.84)² × p̄(1 − p̄) / Δ² with p̄ = 0.55, which is about 43 per arm. This is my arithmetic, not a cited result. Each participant contributes several dossiers, so the analysis treats participant as a cluster (mixed-effects logistic regression with a participant random intercept) and the figure is a minimum; about 45 to 90 participants are needed for the S2 primary comparisons. The validation plan already doubts that even 15 practitioner interviews are feasible (review item GRT-04d), so S2 with real reviewers is **NOT VERIFIED as feasible**. Fallback: informed volunteers, labelled as such, with wide intervals; the result is then claimed only as a controlled demonstration, not as evidence about practitioners. The "five users" heuristic (R15) applies only to S1; it is not a sample size for S2.

**Pre-registration and analysis.** Hypotheses, measures, exclusions (set before data), fixed n, Holm correction across H-UI1 to H-UI4, intervals as well as p-values, and publication of null and negative results are committed before the first session, publicly and after the commit window opens; hashing the file to an external timestamp service is compatible with the gate but is not assumed (INT-059). Instruments for perceived usability and workload (the System Usability Scale and NASA-TLX are named from memory, not fetched) are cited only after being read. Logged behaviour (evidence-opened events and their duration, provisional-read agreement, abandonment) comes from the approval API.

**Ethics.** Written consent, voluntary participation, withdrawal at any time, synthetic dossiers only (no real vendor or personal data), recordings only with consent, data minimised and stored under the repository's secrets rules, no performance reporting about individuals. Ethics review is an open item (spec §18); no S2 session runs before it is resolved or waived in writing by whoever owns the review.

**Tests and acceptance.** The mockup set exists and passes the token-contrast, status-contract and axe checks; the pre-registration file is publicly committed after the commit window opens (22 Oct 2026 00:00 UTC) and before S2 starts, and a session run earlier is exploratory and reported as such (INT-059); S1 reports are filed with raw findings and the change log they caused. **Risks.** Recruitment; transfer from clinical and scholarly studies to payment review is unverified (R14); participants may not behave as they would with real money; seeded-defect prevalence changes vigilance. **Build notes.** M0 can start as soon as the token file and status contract exist; S2's dossiers depend on M11.

---

## Interfaces table

| Interface | Direction | Contract | Counterpart |
|---|---|---|---|
| View API (`/api/v1/...`) and SSE `/runs/{id}/events` | M10 serves; console consumes | JSON Schema view models; SSE with trace `seq` as event id | server core; M7 trace |
| `UiTraceEvent` | M7 produces; M10 renders a projection | M7's trace line v2 with the INT-054 fields: closed `verb` registry, `agent` lane, `phase` 1 to 7, `decider`, `why` (four kinds), budget snapshot, `prevLineHash`, `tenant`; hash-only content | M7 (F10) |
| `TruthTableView` | M3 produces | cells with raw and normalised value, authority, trust, origins, fetch state, bitemporal axes, identity robustness | M3 |
| `ClaimLedgerView`, `FlipView` | M4 produces | claims, spans, labels, gaps, MRS, flips with class, certificates, `completeness` | M4 |
| `DecisionRecord`, reason codes, allowed set | M5 produces | `Why[]`, autonomy, approval state, ceiling | M5 |
| Policy engine (M5a) and verifier core as browser modules | M5 and M9 provide, one file per module, SRI listed | erasable-syntax TypeScript (D-007 amendment, C4), injected async hash, deterministic 1:1 emit; core digest published with the bundle | M5, M9 (F1) |
| Page rasters, quads, text layer, findings | M2 provides, M9 carries as hashed derived members under `evidence/derived/<docId>/` | `pages/<n>.png` at 144 dpi, `layer.geo` quads, text-layer blob, `findings.json`; display aids outside the verified chain | M2, M9 (F3, INT-052) |
| Approval service and API | console calls; M13 owns (INT-029) | `ApprovalItem` (M5 semantics), `ApprovalRequest`, `ApprovalRecord`; calls `provisional`, `evidence-opened`, `extend`, `decision`; WebAuthn assertion; idempotency keys; IdP subject. `provisional`, span-level `evidence-opened` and `extend` are open requests to M13 | M13, M5, M8 |
| Precedent and proposal views | M6 produces | counter-precedents, trust, `stale_rule_diff`, retraction impact | M6 |
| Ledger, bundle, verifier verdicts, audience tiers | M9 produces | verdicts PASS, FAIL, INDETERMINATE and NOT_APPLICABLE with reason codes, certificate outcomes VALID, INVALID and INCONCLUSIVE, tiers as `(audience, disclosure)`, `chipState` returning a named state | M9 |
| Doctor report, egress manifest | M1 and M8 produce | structured report, exit codes, data classes | M1, M8 |
| MCP server | external agents consume | five tools, `outputSchema`, scopes `case:read case:submit vendor:reconcile` (capabilities, not roles), handles from `ctx.ids.secret` | external; M8 (auth), M7 (`ctx.ids.secret`) |
| A2A server | external agents consume | one signed card, four skills (`submit-case` added), the `TASK_STATE_*` table | external |
| CLI | people and CI consume | commands and exit codes of C18 | M11, judges |
| Mockup set and study protocol | M11 and the submission kit consume | files under `design/mockups/`, pre-registration | M11 |

## Spec feedback

F1. **Browser modules.** Spec §14 and §4 need the shared policy engine and verifier core in the page, while D-007 says TypeScript runs with `tsx` and the UI has no build step. Browsers cannot load TypeScript. Proposed: erasable-syntax TypeScript with a deterministic 1:1 per-file emit and an import map with SRI; say so in §14 and D-007. **Resolved by INT-051 (D-007 amendment written out in C4).**
F2. **"The standalone verifier agrees" (spec §14).** The standalone verifier is a separate offline program; the page can run only the verifier core module. Replace with: the page runs the core in a worker, the bundle carries the verifier report of both implementations, and a disagreement is an alert. Also §14 says a chip "turns green", which conflicts with "status never by colour alone" (§21 F-A11Y); say "shows verified". **Resolved by INT-051 (the page runs the pinned core in a worker, reports two results, a disagreement is an alert; C8). The spec wording "turns green" is a spec edit.**
F3. **Page rasters.** To avoid parsing hostile PDFs in the console (pdf.js has two high-severity script-execution advisories, 2024 and 2026), M2 must persist page rasters and quads as hashed derived artefacts and M9's bundle must carry them (outside the verified chain, as display aids with their own hashes). §7 mentions rendering only for the visibility channel. **Resolved by INT-052 (derived member roles under `evidence/derived/<docId>/`, raster export added to M2 DI-14; contract in C8). M2 DI-14's pdf.js drawing default remains to be removed there.**
F4. **A2A `rejected`.** `12` §10.2 maps "rejected when policy rejects the release". In A2A 1.0.0 `REJECTED` means the agent declined the task; a policy `reject` is a completed task. `12` also uses lower-case state names; the 1.0.0 JSON uses `TASK_STATE_*`. **Resolved by INT-063 (a): a policy `reject` is a completed task; states use the `TASK_STATE_*` spelling (C17).**
F5. **CLI list.** Spec §14 lists run, doctor, replay, eval, conformance, verify. F-STAGES requires `reconcile | explain | decide`; the console and judge path need `serve`, `view`, `bundle`, `status`, `mcp`, `a2a`. **Resolved by INT-063 (c): C18 lists the stage commands and the added ones.**
F6. **Policy time travel** is a console feature in §14 and "roadmap" in §21a (gate: measured benefit and a replay-equality test). Shown behind a `labs` flag until the gate passes; §14 should say so. **Resolved by INT-063 (d): `labs` flag, off by default, until the spec §21a gate passes (C12).**
F7. **Approval expiry and authentication.** "Approvals expire quickly" and "default on timeout is deny" (§10, §14a) meet WCAG 2.2.1 (Timing Adjustable) and 3.3.8 (Accessible Authentication). The essential-exception argument for the validity window is **NOT VERIFIED** and needs an accessibility review. The demo needs a labelled simulated identity provider with distinct subjects; the spec is silent on how the demo authenticates approvers. **Open. INT-063 (e) accepts the labelled simulated identity provider with distinct subjects (C11), but the 2.2.1 essential-exception argument stays NOT VERIFIED until an accessibility review (decision D9).**
F8. **Evidence-first approval** extends §14a's "friction (open the evidence)" with a provisional read before reveal. It is a design hypothesis with a pre-registered reversal rule and needs participants and ethics review (§18). **Resolved by INT-063 (f) as a design hypothesis with a pre-registered reversal rule (C11, C22); the evidence is Open until participants and ethics review exist (D9).**
F9. **M10 gate.** §21b's M10 row lists acceptance items without a labelled gate; G-M10 (C21) is proposed for adoption. **Resolved by INT-063 (k): G-M10 (C21) adopted into §21b.**
F10. **M7 trace fields for the UI:** `phase` (1 to 7), `agent` lane (the five visible agents), a closed `verb` vocabulary and a budget snapshot, so the live run view needs no parsing of free text. Add to M7's trace schema. **Resolved by INT-054: M7 owns one trace schema with `phase`, `agent`, `verb`, `decider`, `why_kind`, budget snapshot, `prevLineHash`, `tenant`; C6 projects it.**
F11. **M7 secret randomness.** MCP handles must be unguessable; `ctx.ids` is deterministic in replay. Add a recorded secret-random port (`ctx.ids.secret`), test-only in replay. **Resolved by INT-056: `ctx.ids.secret` is a port in register section 2.2 (recorded in `record`, the recorded value in `replay`; C16).**
F12. **A2A skills.** §14 lists reconcile, explain, verify; `INPUT_REQUIRED` for a pending approval is reachable only if a case-submitting skill exists. Propose a fourth skill `submit-case` for parity with the MCP tool, or drop approvals from the A2A state table. **Resolved by INT-063 (b), taking the first option: a fourth skill `submit-case`; `INPUT_REQUIRED` is not used for approval waiting (INT-030; C17).**
F13. **View-layer bake-off.** Add "console view layer" to §19a (owned builder versus Lit versus Preact plus htm); criteria: zero HTML sinks by construction, bytes shipped, lines owned, ARIA and keyboard ergonomics. **Resolved by INT-063 (g): the console view-layer bake-off is added to §19a (C4 keeps the owned builder as the default until it runs).**
F14. **The counterparty audience tier has no UI owner.** §13 defines a counterparty view (reason code only); nothing designs delivery to a counterparty. M10 provides only a reviewer-side preview with a leakage test; delivery is outside M10 and subject to LAWYER review. **Resolved by INT-055: a counterparty receives a signed notice (M9); delivery is outside the first release and a LAWYER item; M10 ships the preview with the leakage test (C12).**
F15. **Mobile approval** is implied by "desktop and mobile" (§14) but not decided; this blueprint supports it and tests it in the study; a pack policy may restrict it. **Resolved by INT-063 (h): mobile approval is supported and tested.**
F16. **jsdiff** in `14` B4 is not needed in the core: truth-table diffs are typed cell diffs computed by code. **Resolved by INT-063 (i): `jsdiff` is not needed.**
F17. **Conformance tooling exists** for both protocols (MCP conformance framework; A2A TCK and inspector); §14 says "Inspector and SDK conformance tests"; the gate names these runners explicitly. **Resolved by INT-063 (j): the MCP conformance framework, A2A TCK and inspector are named in the gate (C21).**

## What this blueprint does not cover

- **Nothing is built or measured.** Every budget, performance number, usability hypothesis and sample-size figure is a hypothesis. The colour pairs in C3 were computed with the WCAG formula in a throwaway script; no rendered page exists.
- **Not read or examined:** Scite, Elicit, Perplexity, Quantexa, OneTrust, Trustpair and Grep AI interfaces; Aleph; Penpot's prototype player; the code of Lit, Preact and htm; the UI code of Marble, Inspect and Langfuse (README and docs pages only); the uncertainty-visualisation literature (lookups returned nothing and search is exhausted); the full text of WCAG 2.2.1, 2.1.4 and 1.4.10; A2A spec section 8.4 and the REST binding details; what the MCP conformance scenarios and the A2A TCK assert.
- **Assistive technology:** no user with a disability has been involved; VoiceOver, JAWS, switch and voice control are not planned for the gate and are listed as not covered; screen-reader behaviour of the proposed patterns is **NOT VERIFIED**.
- **Approval variants:** only the `action` card is designed in full; the other seven `ApprovalItemType` values use the shared frame from M5's item data and are untested (NOT VERIFIED). The WebAuthn ceremony in the console and the per-subject credentials of the simulated identity provider depend on M13's verifier and are unbuilt.
- **Browsers:** Safari on iOS hardware and low-end Android are not in the plan; the behaviour of module scripts and `crypto.subtle` on `file://` is **NOT VERIFIED**.
- **Localisation and right-to-left** layout beyond isolating vendor strings with `dir="auto"` (spec §21c item 7).
- **Counterparty-facing delivery**, notifications to approvers by email or messaging (none by design), tenant and role administration consoles (spec §14a "designed now, built after the core"), and any real identity-provider integration.
- **Legal:** whether any explanation tier may be shown to a counterparty, and GDPR Article 22 implications of the approval flow, are LAWYER items (spec §18).
- **Uncertainty visualisation beyond ordinal tags**, and any probability display, which stays off until calibration earns it (spec §9).
- **Native mobile apps, offline editing and print stylesheets for the dossier** (print fidelity is a QA-guide item to consider at build).

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-104.** Chip inputs type `bodyHash`, `textLayerHash` and `spanSha` as `RawHash | Commitment`.
- **INT-109.** The run header shows `modelProfile` (`sponsor | evaluation | local`), `disclosureProfile` and `runKind`; `local-confidential` no longer exists.
- **INT-111.** Where C6 names M5's rule-engine value, use `PolicyVerdict`.
- **INT-124.** The cassette-miss copy for a novel document says document analysis runs live with no credentials and prints the exact live command.
- **INT-130.** Approval routes are thin proxies to M13, which implements M7's `ApprovalPort`; item types come from M5a.
- **INT-131.** Routes `provisional`, `evidence-opened` (now carrying `spanIds` and integer `visibleMs`) and `extend` write the M13 `ApprovalSession` or call `reissue`; "Extend review" invalidates earlier approvals and requires a fresh assertion.
- **INT-136.** The "Human decision" badge is unchanged; coverage figures show `explanationCoverage` and `humanDecisionCoverage` separately.
- **INT-151.** MCP handles are keyed by issue ordinal in page and server state; the state hash covers the ordinal, not the handle text.
- **INT-154.** C4 and C8 load the browser core through an import map with SRI from `verifier/browser-modules.json`; an unpinned core makes every chip `unavailable` ("browser core not pinned").
- **INT-155.** Chip result is `{primary, agreement}`; a live case with no bundle may show `verified exact` only with `browser_only` and the visible label "No bundle report"; it counts toward no independent-verification claim.
- **INT-156.** Add the eleventh chip state `chip.erased` with its glyph, grammar and copy.
- **INT-152.** `UiTraceEvent` is a projection of M7's line (`phase`, `agent`, `verb` already present); any UI-originated event gets a verb in `trace-verbs.json` (lint `TL19`).


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
