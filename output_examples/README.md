# Output examples

- `traces/propose-sample.jsonl`: the decision trace of one `desk propose` run on the sample (recorded replies): the findings the Drafter had to address, each model call with its served model id, each restrict check, the Attacker's evasions and the revisions. One JSON line per decision, with the reason computed by code.
- `card-sample.json`: the machine-readable limit autopsy card for the sample (`desk card --sample`). `figuresHash` lets a shared card be checked against its figures.

A signed dossier is about 6 MB and is not stored here; `npm run desk -- demo` writes one and verifies it, and `docs/verification/` records the run.
