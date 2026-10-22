# Agentic Pairings: Design Notes

The instructor's governance pattern (`docs/intel/02-how-organizers-propose-we-build-and-plan.md` §12), written as a design reference for our agents. Source is a slide deck from a different cycle, so treat these as organizer-endorsed methodology, not scored requirements.

## Principle

"Tiny, auditable, swappable pieces -> reliable outputs." Each pairing is two small prompt files with a structured contract between them. Either half can be replaced without touching the other.

## The four pairings

### 1. Planner + Doer
- `planner` turns a GOAL into at most 5 steps, each with inputs, outputs and tool hints.
- `doer` executes step by step, logs each result, and **stops on rubric failure**.
- Contract: `plan = [{step, inputs, output, tool}]` ; `log = [{step, decision, result, next}]`.

### 2. Proposer + Critic
- `proposer` drafts the full output (brief, plan or decision).
- `critic` scores against a rubric. If score is below 7 of 9, it returns **exactly one fix**; the proposer revises **once**.
- Contract: `score = {accuracy, appropriateness, actionability}` each 0–3 ; `fix: string | null`.
- This is the cleanest "critique and recovery" evidence for judges.

### 3. Context-Packer + Actor
- `packer` condenses messy inputs into `BRIEF | CITES[] | RISKS | OPEN_QS`.
- `actor` executes strictly from the BRIEF, must cite CITES, and resolves OPEN_QS or returns TODOs.
- Value: compact payloads between agents, which the organizers advise ("avoid passing full documents between agents; use summaries and shared state").

### 4. Evidence-Weaver + Synthesizer
- `weaver` gathers multi-source facts as `QUOTES[] | SOURCE[] | LIMITS | TIMESTAMP`.
- `synthesizer` produces claims where **every claim maps to a quote and a source**; unmet LIMITS become QUESTIONS.
- Natural fit for the track "The Agent That Can Explain Why" and for provenance in "Solving Fragmented Intelligence".

## How we use them

Pick pairings only where they serve the chosen use case; do not add pairings for show. Each pairing in the final system must have:

- its two prompt files under `src/agents/prompts/` (named `<pairing>.<role>.md`),
- a typed contract in code,
- a trace line per hand-off,
- a test that forces the critic path (a deliberately weak draft must trigger a fix).

## Autonomy level per agent

Record per agent which level it runs at (L0 macro, L1 confirm, L2 loop/stops, L3 free-run). Default L2 with hard caps; L3 only for highly repeatable steps. The slides: "Full autonomy is fragile governance wise."

## Caps and stops (enforced in code, not in prompts)

Maximum turns per run, maximum tool calls per agent, per-call timeouts, bounded retries, a global wall-clock budget (organizer target 5–10 min). On any cap hit, log the reason and degrade to the fallback path.
