# Profile: AI4Finance-Foundation/FinRobot

Reader: Haiku (low effort), 2026-10-16, about 120 seconds, 95k tokens, 32 tool calls. Local clone, commit 2717499. Paths relative to `finrobot_desktop/` unless stated.

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); commit 2717499 (confirmed); the retry delays 2, 5 and 10 seconds, the recoverable-error substrings and the fatal-error list (billing, context length overflow, auth and bad-request errors) with a comment explaining why context overflow must not be retried, at `finrobot/engine/pipelines/runner.py:38-76` (confirmed); six audit operators named `currency_caliber`, `ev_bridge`, `narrative_divergence`, `narrative_numeric_grounding`, `sector_sign`, `ttm_period` that check the narrative against the numbers (README line 99, confirmed); a point target withheld when three valuation methods diverge 2.6 times, only the range shown (README line 112, confirmed); an `audit/transcript.py` and `persistence.py` exist (confirmed by listing). The "237 test files", the agent factory details and the provider interface line numbers were not rechecked: NOT VERIFIED. Result: PASS.

## 1. What it is
An equity-research platform (desktop app, command line, web) that produces research artifacts and valuations with a deterministic compute layer and LLM narration. Apache 2.0. The repository also holds older `finrobot_autogen` and `finrobot_equity` folders.

## 2. Architecture map
A Tauri shell and React front end over a FastAPI backend. Nine agents (data, analysis, modeling, synthesis, report, bull, bear, judge, lead). A compute layer of 32 operators plus 6 audit operators. Seven data providers behind a circuit breaker. Artifacts stored in SQLite.

## 3. Features and how each behaves
Research for a ticker, valuations (DCF, dividend model, LBO, comparables), earnings analysis, investment-committee memos. Failed validations degrade with warnings; transient errors retry with growing waits; fatal errors stop at once. A valuation withholds a point target when methods disagree widely.

## 4. How people use it
A desktop build, or `uv sync && finrobot research AAPL`, or `finrobot serve` with a local web UI. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M1 data connectors, M5 workflow, audit)
Providers implement one interface and return data, a timestamp, warnings and structured divergences between sources. Cross-source checks flag differences beyond a tolerance; a circuit breaker skips cooling-down sources; if all fail, the last stored row is returned and marked as stale so it is not stored again as fresh. Numbers come from code; the language model only narrates; audit operators then compare the narrative with the numbers. Lost: a single configured model runs all agents (reader's account).

## 6. Agent patterns
Pipeline of typed steps with validators and retries; a bull, bear and judge debate for contested verdicts; models may correct a bad data-type request by retry. Instructions are Markdown files, not code.

## 7. Model and data layer
Any of several model providers by setting; canonical normalised price and financials with provenance stamps (the contracts file itself not read); raw fetch only for news.

## 8. Hackathon-care checks
Append-only session transcript in JSONL with file mode 0600 and a scrubber that redacts API-key patterns (per the reader; the scrubber's patterns were not rechecked). No Dockerfile for the desktop app; the repository root has one. No sample mode found.

## 9. Traps seen (recorded and fixed by the authors, per the reader)
Two price sources inside one artifact giving different numbers; stale history narrated as recent; stale cache rows re-stored as fresh; context-overflow retried to no purpose and then continuing with no data. These are good test cases for us.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the provider interface with divergences and provenance, the circuit breaker with stale fallback flag, the audit-operator idea, the typed step runner and its fatal-versus-recoverable error classes, the transcript secret scrubber.

## 11. Verdict: ADAPT; one of the best matches for M1 and for the audit layer
Copy: (1) audit operators that check narrative text against computed numbers (our counterpart: every figure in an explanation must match a record); (2) source divergence reported as data, with provenance and a stale flag; (3) retry classes that never retry deterministic failures.
Avoid: (1) equity operators and finance outputs, wrong domain; (2) one model for every role; (3) best-effort continue after a failed data step without a visible gap.
Where we are already ahead: release decisions are certified and replayable; FinRobot's checks end at the report.
