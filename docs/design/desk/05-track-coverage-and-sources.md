# The Desk: what it does in each track, and where each idea comes from

Status: design, 2026-10-20. Nothing here is built. Feature counts and ids are from `02-feature-list.md`; sources are from `01-adoption-register.md` and the repository profiles `57` to `90`. The numbers per track overlap, because one feature can serve more than one track.

## Product, one line

A desk for whoever pays for AI agents. It ties each dollar to work that landed, checks the agent daily on the owner's own tasks, tests a spend policy on a month it never saw, and gives a signed report anyone can verify offline.

## On "copying"

No code is copied and nothing is built. "Taking from" means ideas we adapt. MIT and Apache code is re-implemented with credit. AGPL, Elastic and unconfirmed licences (dedrift, Phoenix, coder, figuard) are ideas only.

## Track 1: Solving fragmented intelligence (28 features)

Features:

- Read Claude Code and Codex logs, OpenTelemetry traces, gateway logs and invoices.
- Join billing, CI, pull requests and seats through Zetaris (the join is not yet verified).
- Price every call from a dated price book. Mark each figure estimated, reported or billed. Never show an unknown price as zero.
- Reconcile to the invoice and show the gap.
- Attribute sessions to commits with a confidence level, then place each dollar on a ladder: committed, merged, checks green, kept N days, reverted.
- Show quota runway across plans.
- Show unlinked spend as "unknowable".
- A doctor screen says what the Desk cannot know.

Repos we take ideas from:

- ccusage, CodexBar, Claude-Code-Usage-Monitor and agentsview (log reading, pace, cost allocation).
- LiteLLM, Opik, Helicone, Portkey and Langfuse (price book, unpriced list, trace schema).
- DevLake, Codelens and SWE-bench (commit and pull-request linking, the landing ladder).
- The OpenTelemetry GenAI conventions, which have no cost field, so the Desk defines its own namespace.

Papers and standards we take from:

- The SWE-bench paper (fail-to-pass and pass-to-pass tests decide whether work landed).
- The OpenTelemetry GenAI standard (still marked "Development").
- Swanson linking, the research method behind joining sources that never cite each other.

## Track 2: The agent that can explain why (25 features)

Features:

- Every number on the bill is clickable and labelled.
- A waste block explains itself with its stop point and rule.
- Ask the Desk answers with claim chips. An Auditor checks every sentence against the exact quote or number.
- Each verdict names the one fact that would flip it.
- Wording is "consistent with, not caused by".
- A signed dossier, which a stranger verifies offline.
- A wording lint blocks "proved" and "caused by".
- A morning brief and a weekly review, which no repository we read has.

Repos we take ideas from:

- The Plumbline core (our own: claim checks, flip fact, dossier, verifier).
- LoopGuard, coding-agent-flight-recorder and agent-bisect (finding the stop point and the cascade).
- CodexBar (the "never a billing receipt" cost label).
- dedrift (attribution wording, ideas only).
- Inspect and Langfuse (scores and judge panels).

Papers we take from (names from our earlier profiles, not re-read when this file was written):

- ALCE, FActScore and Self-RAG (checking each claim against its source text).
- Reflexion (revising after criticism).
- Krippendorff's alpha (judge agreement).

## Track 3: Reasoning architecture (48 features; the submission track)

Features:

- Three loops: the Explainer and Auditor, an evidence-gap re-plan, and the Policy Drafter checked against its own policy test.
- A daily canary on the owner's own tasks with a pre-registered regression rule: a drop of at least 3 points, a 99% interval excluding zero in two windows in a row, and an unchanged harness.
- Replay of last month on a cheaper route, reported with a quality interval and never with a promise.
- A reserve-before-call spend ledger and a spend policy language.
- A check that a policy edit only narrows, with a counterexample if it does not.
- Policy replay on a month the policy was not drafted from, then approval echo.
- Shadow mode, pause with checkpoint, and a rule-brain fallback when the model is down.
- Nemotron through NVIDIA's free API, plus published simulations and ablations.

Repos we take ideas from:

- livenerf, promptfoo and Inspect (canary rule, scoring, judge controls).
- Kitaru and Reenact (replay), with LangGraph as the negative example because its time travel re-runs side effects.
- figuard and LiteLLM (reserve before the call, with their flaws removed).
- Microsoft's agent governance toolkit, NeMo Guardrails, Cedar and Coder's boundary (policy, approval, verdict model).
- Meterless engines (design only).

Papers we take from:

- The Cedar paper (a policy language whose edits can be proved to narrow). Named from memory, not in our profiles: NOT VERIFIED.
- Anytime-valid e-processes (dedrift's documentation) for the early-warning flag.
- Clopper-Pearson bounds for the false-alarm claim.
- Cluster-robust standard errors (Miller, as cited by Inspect).

## Blocked or not done

- Nothing is built.
- The Zetaris join is unverified, the Meterless engines are design only, and the Cursor log is empty.
- Live runs need an NVIDIA key.
- Willingness to pay is NOT VERIFIED.
- The reviews of the first draft were not re-run on the fixed documents.
