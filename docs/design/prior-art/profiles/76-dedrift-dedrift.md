# Profile: dedrift/dedrift (frozen canary suite for your own agent, drift statistics)

Reader: Claude Sonnet, 2026-10-20. Licence read first: AGPL-3.0 (gh api, 2026-10-20), plus a CLA file. MECHANISM ONLY: we rebuild from the ideas and copy no code. Stars 0; pushed_at 2026-10-09T23:43:13Z (used as last-commit date). Status "pre-alpha" (`README.md:53`). Paths relative to the repository root. Not cloned; nothing was executed; its measured rates are the author's claims.

## 1. What it is
A Python package that runs a frozen canary suite against the owner's own agent several times per cycle, extracts behaviour signatures, and tests the current cycle against a rolling window and a frozen golden baseline (`docs/how-it-works.md:4-30`). Zero ML dependencies in the core (`README.md:87`).

## 2. Architecture map
`src/dedrift/canary.py` (suite loader and N-repetition runner), `schema.py` (record), `signatures/structural.py` (Tier 1), `embeddings.py` and `detectors/mmd.py` (Tier 2), `detectors/` (scalar, fdr, sequential, cyclefx), `check.py` (pipeline, 62 KB), `attribution.py`, `evalues/` and `anytime.py` (lifetime-valid mode), `report.py`, `store.py`.

## 3. Features and how each behaves
- Agent contract: one function `agent_fn(input) -> {text, structured, tool_calls, steps, retries, errors, latency_ms, tokens_in, tokens_out}` (`canary.py:7-15`). dedrift never implements the agent.
- Canaries: frozen YAML, six closed families (happy path, edge case, refusal boundary, tool-heavy, adversarial, long context), stable ids "forever", optional `expected` values (`docs/canaries.md:9-51`). Empty families are reported, not faked (`:53-59`).
- Config block per record (model, prompt hash, tool-schema hash, RAG index version, agent version) hashed into a fingerprint; a fingerprint change becomes a config event (`schema.py:70-85`; `how-it-works.md:5-9`).
- Exit code 2 on drift (`README.md:110`). Non-text agents can declare up to 16 numeric channels (`README.md:66-82`).

## 4. How people use it
`dedrift init`, `sim`, `baseline set`, `check` (`README.md:96-110`). Real users: none visible (0 stars); NOT VERIFIED.

## 5. Mechanism for the Desk
Compare distributions, never single outputs: each canary runs N times per cycle (default 7) and tests compare the cycle with a reference window (`how-it-works.md:41-46`; `docs/configuration.md:11-12`).

Detector battery, one primary test per channel (`docs/statistics.md:13-22`): two-sample KS for location and shape (materiality D at least 0.15); Brown-Forsythe for dispersion (ratio at least 1.5); P95 permutation for the tail (shift at least 10 percent); continuity-corrected two-proportion z for rates (refusal shift at least 2 points); MMD with a seeded permutation null for meaning. Corroboration tests (Anderson-Darling, Welch) never alert. Page-Hinkley localises onset; PSI is a labelled heuristic.

Gating order (`statistics.md:40-57`): collect primary p-values, Benjamini-Hochberg at q 0.05 (`detectors/fdr.py:16-58`; NaN counted as p=1 so family size does not depend on data, `:19-22`), then a materiality gate, and an alert needs both. Optional `alert_persistence` makes a channel alert on consecutive checks (`configuration.md:25`).

Honest numbers it publishes: null alert rate 16/500 (3.2 percent, Wilson upper 5.1) at 12 canaries x 5 repetitions (`statistics.md:76-90`); a power table where a 2 point rate shift at 210 samples is detected 11 percent of the time and 10 points 91 percent (`:103-112`); per-cycle wobble sigma 0.05 raises false alerts to 36.5 percent (`:134-140`). Lesson: hosted models vary within one version alias, so a record-level test over-alerts; use cycle as the unit or require persistence.

Anytime mode: e-processes with e-BH so the chance of ever falsely alerting stays under 0.05 (`docs/anytime.md:3-16`). Measured 2/500 false alerts over 2,000 cycles versus 419/500 for repeated fixed tests by cycle 100 (`:38-41`), at the price of never detecting a 2 point shift and 89/100 detections of 10 points in a median of 50 cycles (`:57-62`). The author says use fixed mode for small shifts (`:75-79`).

Attribution: nearest config event before the estimated onset, worded "consistent with", never "caused by" (`attribution.py:1-7`).

Judge: none. `rubric_id` is provenance only and "no LLM judge is executed" (`README.md:91-92`; `canaries.md:28-30`). So no judge-bias controls exist here.

## 6. Agent patterns
None internal. It is a monitor around someone else's agent.

## 7. Model and data layer
SQLite-style store (`store.py`), a pinned embedder refused on change (`how-it-works.md:48-56`).

## 8. Hackathon-care checks
Deterministic reports with seeds recorded (`how-it-works.md:29-30`); simulator with no keys (`README.md:96-98`); a test that published numbers agree with the docs (`tests/test_published_numbers_agree.py`, file listed, not read).

## 9. Traps seen
Output-length, format and refusal signatures measure style, not whether the work landed; a score that matters (tests passed, claim verified) is not a built-in channel. The headline rate is family-wise and grows with battery size (`statistics.md:24-38`). 0 stars and pre-alpha: calibration claims are unaudited by others.

## 10. Reuse
AGPL-3.0: mechanism only. Rebuild the gating order, the closed families, the config fingerprint and the persistence rule from the idea.

## 11. Verdict: ADAPT the mechanism (fingerprint events, double gate, dual baseline, honest power table); REJECT the code
Copy: (1) a config fingerprint so a regression is shown next to the change that preceded it; (2) significance AND materiality before alerting, with a power table beside each verdict; (3) rolling window plus a frozen baseline.
Avoid: (1) judging by style signatures only; (2) 7 repetitions per task if the owner pays per call; (3) any claim of false-alarm control the owner's own data has not measured.
