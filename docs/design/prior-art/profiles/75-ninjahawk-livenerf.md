# Profile: ninjahawk/livenerf (daily frozen-panel degradation tracker)

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT (gh api, 2026-10-20). Stars 1,537; pushed_at 2026-10-18T00:18:54Z (used as last-commit date). Paths relative to the repository root. Not cloned; nothing was executed. Its own numbers below are the author's claims, re-read from the repository, not reproduced.

## 1. What it is
A pre-registered, append-only benchmark that asks whether a hosted model gets worse after launch. One frozen 78-question panel is run once a day on the measured model and a 12-question control arm on another model (`README.md:30,42-50`; `livenerf/daily.py:1-16`). Built on Inspect (profile 74).

## 2. Architecture map
`daily.py` is the cron entry. `schedule.py` is an hourly alternative with a fixed shuffled rotation (`:46-61`). `providers/claudecode.py` serves a model through a hermetic `claude -p` call: no tools, no memory file, fixed working directory, scrubbed environment (`:1-21`, `:48-60`). `scorers/checks.py` holds pure-function graders: "same input, same score, forever" (`:1`). `analysis/__init__.py` reads Inspect logs and applies the decision rule. `usage.py` reads the plan's usage meter.

## 3. Features and how each behaves
- Refuses to run if the CLI version differs from the pin, or the panel lock is missing or changed (`daily.py:84-94`).
- Budget guard: skips when the weekly meter is at or above 75 percent or the 5-hour meter at or above 60 (`:77-78,99-101`), retries hourly, and runs once per UTC day (`:10-13,41-49`). Meter reads are cached 5 minutes, stale reading allowed 30 minutes, and unknown means skip (`usage.py:1-14,23-24`; `daily.py:96-98`).
- Every attempt appends a line to `logs/daily.jsonl` with meters before and after (`daily.py:33-38,107-108`).
- Harness hash: sha256 over only the files that shape a sample (provider, tasks, graders, prompts, CLI pin, lockfile), recorded in every run (`schedule.py:68-95`).

## 4. How people use it
Clone, `uv sync`, pin the CLI, schedule `scripts/daily.sh` or the Windows task (`README.md:99-120`). Results are posted to a Discord (`README.md:32`); no alerting code was found in the repository (NOT VERIFIED beyond the files listed). Adoption beyond the 1,537 stars: NOT VERIFIED.

## 5. Mechanism for the Desk
Cost of a daily canary. Plan: 78 items once a day plus 12 control items, about 3.6 points of a weekly plan meter, roughly 803,000 output tokens a week; 1 point is about 224,527 output tokens, measured over 657 chunks (`docs/DESIGN.md:7-9`). Cheapness comes from three choices: graders cost nothing (pure functions), the panel is small, and a meter guard defers instead of overspending.

Panel choice and its bias. Items that a strong model only sometimes gets right were chosen, 78 of 2,336 (`README.md:47-50`). Selection bias was measured: items looked 54.7 percent right on screening and 62.0 percent on fresh samples (`README.md:51-53`). Lesson: pick canary tasks by variance, then re-estimate their pass rate on held-out runs.

The regression test (the statistic). Per item: mean score in a window minus mean score in baseline; average over items present in both; cluster-robust standard error by item template with a G/(G-1) correction (`analysis/__init__.py:95-116`, citing Miller arXiv:2411.00640 at `:3-6`). Decision rule: declare a change only if the 99 percent interval excludes zero (|delta| > 2.576 x SE) in two consecutive 10-day windows, same direction, |delta| at least 0.03 in both, harness hash and CLI version equal to the baseline's, and error rate under 5 percent (`:19-21,158-175`; `PREREGISTRATION.md:138-147`). If the control arm moves the same way, call it a harness or platform change (`PREREGISTRATION.md:148-150`). Else report "no change" with the minimum detectable effect.

Power is computed, not hoped for: variance of each item is baseline p(1-p), `Var(delta) = (1/K^2) sum p(1-p)(1/m_window + 1/m_base)`, MDE = (2.576 + 0.842) x SE (`:178-194`). Realized: 6.6 points per 10-day window (`README.md:43`). The earliest call is day 30 (`PREREGISTRATION.md:127-128`).

Cost and tokens as a second signal: per-item log ratio of output tokens against baseline, clustered (`:119-130`). Lower effort moved tokens by minus 62 percent but accuracy only by minus 8.3 +- 4.5 points (`README.md:57-59`). Cheaper-route lesson: a model swap (Opus 5 vs 5.5) gave minus 3.8 +- 6.3 points and minus 23 percent tokens and was not distinguishable at 99 percent; the author says the instrument cannot detect it (`README.md:60-63`). So a replay on a cheaper route can show a token and price drop with high confidence and a quality gap only with a wide interval.

Judge bias: the design avoids judges. It also states a circularity: much of the repo was written with the model family under test (`PREREGISTRATION.md:200-202`).

## 6. Agent patterns
None; single-turn calls. Errors and classifier refusals are bucketed (`analysis/__init__.py:24-35`) and excluded, not scored.

## 7. Model and data layer
A custom Inspect model provider wraps the CLI (`providers/claudecode.py:1-21`). Panel in `data/standard_panel.json`; per-day logs in `.eval` files.

## 8. Hackathon-care checks
Fully pre-registered (`PREREGISTRATION.md`), raw logs kept, deviations log, bad runs excluded by name and left on disk (`analysis/__init__.py:38-46`). Single time of day, so peak-hour behaviour is not measured (`PREREGISTRATION.md:188-190`).

## 9. Traps seen
Needs a logged-in CLI and a plan; the usage endpoint is read with the local OAuth token (`usage.py:41-48,22`), a fragile dependency. The Desk can avoid it by reading the owner's own run logs and the provider's billing data instead. Windows are fixed at 10 days: slow for an owner who wants Tuesday's answer.

## 10. Reuse
MIT: reuse with credit. Python; we rebuild the statistic in TypeScript.

## 11. Verdict: ADOPT the statistic and the harness-hash guard; ADAPT the schedule to short windows
Copy: (1) paired per-item delta with clustered SE and a computed MDE shown beside every verdict; (2) a hash of sample-shaping files and the tool version, so a harness change is never reported as a model change; (3) a control arm plus a meter guard that defers instead of overspending.
Avoid: (1) 10-day windows as the only mode; (2) panel items chosen by variance without re-estimating their rate; (3) reading an undocumented usage endpoint.
