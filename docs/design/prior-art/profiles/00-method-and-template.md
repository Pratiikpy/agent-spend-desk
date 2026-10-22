# Repository profiles: method and template

Purpose: check, repository by repository, what the best projects really do (architecture, features, how people use them, the mechanism for our module, agent patterns, model and data layer, and everything the hackathon scores), so the architecture, feature list and blueprints are updated from evidence and not from summaries. Started 2026-10-16 on Prateek's instruction. Nothing here changes the spec until the synthesis step (a best-of table per module), and then only through a decision entry.

## Rules

- One file per repository: `NN-<owner>-<repo>.md`, written to the template below, at most about 700 words.
- Every factual claim cites `file:line` from the repository, or is marked **NOT VERIFIED**. Usage evidence that is not in the repository (issues, discussions, reviews) is marked NOT VERIFIED unless a source is cited.
- Readers: a cheap model (Haiku, low effort) for small or simple repositories, `agy` (Gemini) for large or judgment-heavy ones. Each profile records the reader and the spot-check result. A profile that fails a spot-check (three cited lines checked against the code) is redone by the other reader.
- Licences: MIT and Apache code may be reused with credit; AGPL and "other" are mechanism-only, rebuilt from the idea. Read the licence file first.
- A star count or a README claim is not evidence of quality.

## Template

1. **What it is.** Two lines, licence, last commit read, reader.
2. **Architecture map.** Modules, data flow, entry points.
3. **Features and how each behaves.** Inputs, outputs, defaults, failure behaviour.
4. **How people use it.** Install and first-run path, common setups, examples, tests; issues and discussions only with a source.
5. **Mechanism for our module(s).** Core logic, state kept, formulas and rules, limits, what is lost.
6. **Agent patterns.** Roles, critic loops, fallbacks, confidence branching, shared state.
7. **Model and data layer.** How models and data sources plug in (OpenAI-compatible seam, adapters, routing).
8. **Hackathon-care checks.** Trace and log format, sample or offline mode, Docker or one-command run, evals and honest numbers, security (secrets, untrusted text), demo path.
9. **Traps seen.** Hardcoded outputs, stubs, sponsor-named-not-used, silent failure, speculation allowed.
10. **Reuse.** Licence class and what may be copied with credit.
11. **Verdict.** Adopt, adapt, reject or already-better, with three things to copy and three to avoid.

## Product context given to every reader

Plumbline is a decision system for releasing irreversible agent actions (for example a vendor payment or bank-detail change). Modules: M1 sources and connectors, M2 document understanding, M3 reconciliation and entity resolution, M4 explanation (minimal evidence, the one fact that flips the answer), M5 decision (policy, precedent, autonomy ladder, override-to-rule learning), M6 memory, M8 intake and trust, M9 ledger and offline verifier, M10 console, M13 approval and one-time release.
