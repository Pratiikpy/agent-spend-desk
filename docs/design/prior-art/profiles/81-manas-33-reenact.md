# Profile: Manas-33/Reenact (PyPI "reenact" 0.2.0, records an agent run once, replays it offline)

Reader: Claude Sonnet, 2026-10-20. Search record: PyPI `reenact` 0.2.0 exists, homepage `github.com/Manas-33/Reenact` (PyPI JSON, 2026-10-20). `gh search repos reenact` returned only face-reenactment projects; the repository was found through the PyPI link and `gh search code reenact --filename pyproject.toml`. Remote read only, nothing run. Paths are relative to the repository root; line numbers are from files as fetched on 2026-10-20.

## 1. What it is
A regression gate for LLM agents: it records every model, tool and MCP call into a cassette, then re-runs the *current* agent code against the recorded model replies, offline, and reports what changed (README.md:6-13). Licence: MIT, "Copyright (c) 2026 Manas Dalvi" (LICENSE:1-3), read first. Stars 0, pushed 2026-10-12. Last commit read: 8dac614, 2026-10-12. Young, single author.

## 2. Architecture map
`core/src/reenact/`: `schema/`, `record/` (recorder, hashing, redaction, SDK wrappers), `replay/` (player, policy, divergence, live, nondeterminism), `evals/` (checks, structured criteria, judge, baseline, calibration, rerun), `store/` (JSON cassette, SQLite), `session.py` (the one surface an agent runs in). A composite GitHub Action posts the PR comment (README.md:211-243).

## 3. Features and how each behaves
`record`, `check`, `eval`, `ci`, `suggest` (README.md:263-273). Outcomes `MATCH`, `DIVERGED`, `CRASHED`, `LIVE` (:122-127). Divergence policy `fail` (default), `flag`, `live` (evals/rerun.py:66-86).

## 4. How people use it
One `run(rt)` entrypoint takes clients and tools from the session `rt`; the same function records and checks, "so what is recorded and what is checked cannot drift apart" (README.md:46-48). Usage by others: NOT VERIFIED.

## 5. Mechanism for the Desk

**Recorded-session format.** `Trajectory{schema_version, id, name, created_at, events[], metadata}` (schema/trajectory.py:20-30). Events are `seq`-ordered with `parent_seq` for concurrency (schema/events.py:39-65): `llm_call` (provider, model, verbatim request and response, `request_hash`, `usage`, `cost_usd`), `tool_call` (name, arguments, result, `side_effect`), `graph_node` (LangGraph thread, step, namespace; :78-94). Cassettes are stable JSON that diffs in git (store/cassette.py:1-6). Known keys (api keys, tokens, cookies) are scrubbed before storage and hashing (record/redaction.py:7-43); prompt and tool content is kept (README.md:93-95). `cost_usd` is declared but never filled (grep, 2026-10-20); Anthropic input and output tokens are captured, cache-read tokens are not (record/anthropic.py:16-23).

**What replays deterministically.** Model replies, matched by sha256 of the canonical redacted request (record/hashing.py:8-18; replay/player.py:104-142). LLM and tool calls advance separate cursors (:69-75); tool calls match on name plus arguments, and siblings sharing a `parent_seq` match in any order (:38-66, :243-290). Control flow, prompt assembly and parsing run for real. An early stop or an over-run is itself a divergence (:190-215). Strict raises, lenient collects, and neither invents a reply (:24-35).

**Side effects.** Each tool is `read_only`, `mutating` or `unknown`, and unknown is treated as mutating (events.py:18-27). A mutating tool never runs on replay: its recorded result is substituted and its `run` is not handed to the player (session.py:766-768; replay/policy.py:1-8). After going live, read-only tools run for real and mutating ones run a registered `stub`, otherwise the scenario stops (session.py:776-794). The live world can differ "slightly" from the recorded one (:22-24).

**Swapped-model replay and how it is judged.** The model name is in the request, so a swap changes the hash and diverges (divergence.py:50-52; player.py:132-141). Offline the verdict stops there: once a request diverges "whether the answer got better or worse is out of reach" (evals/rerun.py:10-14). With `live`, the run switches to the real model at the first mismatch, the matched prefix stays free, and the checks read live answers (session.py:18-20, :694-721). Judging is: deterministic assertions; yes/no criteria answered by a model that must cite a real step index or the pass is downgraded to fail, one call for all criteria (evals/structured.py:11-22); a scalar judge at 0.7 (judge.py:27); and a baseline diff with 0.05 tolerance where a removed check also gates (evals/baseline.py:22, :93, :179-180). A criterion blocks only after agreeing with human labels at 0.85; above 0.92 it is flagged suspicious (evals/calibration.py:33-35).

**Honest limits.** One live sample per scenario on three demo issues, "an illustration of the mechanism, not a benchmark" (README.md:156-158); a smaller-model swap passed live (:149-155). `Clock` and `Rng` seams exist (replay/nondeterminism.py:1-9) but are not wired into `Session` (grep of session.py), so an agent stamping the time into a prompt diverges every run. A framework version change can alter fingerprints (README.md:257-259).
The headline "100 runs byte-identical" (:284-285) replays each recorded request through the player and round-trips the file (bench/determinism.py:50-64): a self-consistency test. The recordings are real Anthropic calls (examples/record_corpus.py:1-7).

**Lost for the Desk.** No price table, no dollars per task, no notion of work landed. It answers "did this change break the agent", not "what would a cheaper route have scored, at what price".

## 6. Agent patterns
Evidence-cited criteria that fail closed, plus a judge calibrated against humans (structured.py:11-15).

## 7. Model and data layer
Wrapped SDK clients: `rt.anthropic()`, `rt.openai()`, `rt.litellm()`, `rt.chat_model()`, `rt.mcp()` (README.md:164-171). Judge default `claude-sonnet-4-5` (judge.py:26).

## 8. Hackathon-care checks
Offline, no key for `check`. Live refuses `pull_request_target` and never gets fork secrets (README.md:251-253); `--max-live N` caps spend (:143-145).

## 9. Traps seen
A self-consistency benchmark offered as determinism proof; `cost_usd` declared and empty; time and random left to the user; live is a single sample.

## 10. Reuse
MIT: may reuse with credit.

## 11. Verdict: ADOPT the format and policy, ADAPT the judging
Copy: (1) the cassette with `request_hash`, `parent_seq` windows and per-tool `side_effect` where unknown means mutating; (2) go-live-at-first-divergence with a cap, stubs for mutating tools, divergence shown field by field; (3) evidence-cited criteria calibrated against human labels.
Avoid: (1) calling a replay of recorded requests proof of determinism; (2) an unfilled `cost_usd`; (3) judging a model swap from one live sample.
