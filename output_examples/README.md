# Output examples

- `traces/propose-sample.jsonl`: the decision trace of one `desk propose` run on the sample (recorded replies): the findings the Drafter had to address, each model call with its served model id, each restrict check, the Attacker's evasions and the revisions. One JSON line per decision, with the reason computed by code.
- `traces/ask-sample.jsonl`: the decision trace of one `desk ask --sample "What changed before 2026-10-15?"` run (recorded replies, written by the command to `data/desk/sample/traces/ask-<answer id>.trace.jsonl`): the Risk Router's route, the Planner's model call and the program it proposed (marked `model_reported`, so never shown as the reason for a decision), the four engines and whether each was switched off, the step that ran with its row count and query hash, the Explainer's model call and the Auditor's verdict.
- `card-sample.json`: the machine-readable limit autopsy card for the sample (`desk card --sample`). `figuresHash` lets a shared card be checked against its figures.

A signed dossier is about 6 MB and is not stored here; `npm run desk -- demo` writes one and verifies it, and `docs/verification/` records the run.
