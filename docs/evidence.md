# The evidence, in full

The README carries one line for each of these. Every figure below has a file behind it under `docs/verification/`.

## The evidence

- **A regression, called.** The canary runs a 52-task pack once a day on two arms for 30 assigned days. The primary arm's model is switched on day 15, on purpose. The statistic calls it: **-40.0 points, 99% interval -56.2 to -23.8, control arm flat**. A first recording on 16 tasks measured a 35 point drop and correctly refused to call it (four clusters cannot support a call), so the pack was grown and re-recorded. Both are in the repository: `docs/verification/canary-first-run/`.
- **A head-to-head, published as it came out.** Same Nemotron model, three arms: one call with a summary, a tool-using agent, and the Desk. On the first 60 questions the Desk was 51 exact against the agent's 47 and one call's 12. On a second set of 60 it had never seen, preregistered before it ran: **49 against 41 and 12**, and 77% against 63% when each question is asked three more times at temperature 0.7 (pass^3). Eight questions in sixty is at the edge of what that sample can show, and the Desk was level with the agent on the 7 questions from templates its tools were not built around (2 of 7 each). A defect found by reading that set (a refused plan was handed to the rule planner without telling the Planner why) was then fixed; after the fix the Desk is at 54 of 60 and 85% pass^3, reported as post hoc, beside the first figures and never in place of them. Its first run on the first set was 20 of 40 against the agent's 31. Everything is in `docs/verification/benchmark/` (`RESULTS-v2.md` has the written predictions, several of which failed or held only barely), and `desk prove` replays all 900 recorded runs from the recordings.
- **Held-out replay.** A policy drafted from September meets October, a month it never saw. The headline is the landed work it would have blocked (5 of 333 sessions), not the savings.
- **A verifier a stranger can run.** A signed dossier carries the rows its figures come from; `desk-verify` recomputes them on plain Node with the network off. Change one byte and it names the row. A signature proves the record was not altered after signing and that its figures follow from its rows; it does not prove that the agent logs were truthful.
- **A fuzzed checker.** The restrict-only check (does an edit only narrow a policy?) agrees with an independent oracle on 3,000 random policy pairs, and a checker that always says "narrows" is caught.
- **Its own confidence, measured.** Link confidence is checked against planted truth with Wilson intervals (high 99.2%, medium 98.6%, ordered as named). The wind tunnel's "90%" one-month range held the realized month in **73%** of 48 constructed samples with a regime change planted and **77%** with none (interval 63% to 87%), and its chance of blocking landed work had an expected calibration error of 0.29. Both are stated beside the range on screen: read it as a screen, not a promise.
- **It keeps a record of its own judgement.** When a policy is proposed, the expected range for each option is written down; after the month that followed, each option is replayed and scored, with regret. On the sample, the proposed policy's month fell inside its range and blocked the same 5 landed sessions the held-out replay named.
- **It tries to learn from its mistakes, and says how little it moved.** Nine wrong answers on 120 training questions gave six verified plans; the six lessons moved two held-out questions from wrong to right and none the other way (54 to 56 of 60, 95% interval -8.3 to 0.0 points), so no improvement is claimed. Nothing changed on the 7 new-template questions. A first run of this experiment measured the model's run-to-run noise rather than the lessons; both runs and the correction are in `docs/verification/learning/` and the preregistration.
- **`desk prove`:** 26 PASS, 0 FAIL, 0 NOT RUN on a fresh clone. NOT RUN names a check the spec asks for that is not built or not recorded; it is never counted as a pass.

## One real trace

From `output_examples/traces/propose-sample.jsonl`, the Drafter proposing a policy. The first draft is checked on the training month, the check finds it would pause 81 of 311 sessions whose work landed, the Drafter revises, and the second draft passes:

```
{"seq":3,"event":"desk.policy.check","role":"policy_drafter","detail":{"attempt":1,"narrows":true,"landedBlocked":81,"landedTotal":311,"pausedSessions":138}}
{"seq":4,"event":"revision.applied","role":"policy_drafter","detail":{"attempt":1,"because":"on the training window it would pause 81 of 311 sessions whose work landed; raise the threshold so they are not paused"}}
{"seq":6,"event":"desk.policy.check","role":"policy_drafter","detail":{"attempt":2,"narrows":true,"landedBlocked":0,"landedTotal":311,"pausedSessions":0}}
```

## Against the organizers' red flags

| Red flag in the Approach Guide | Here |
|---|---|
| A private API key you do not have | None needed for the sample; live mode is optional |
| A dataset you cannot access quickly | The sample is generated from a seed on your machine |
| Raw data of many GB with no sample strategy | The 590 MB sample is generated, not shipped; what is shipped is described in `data/README.md` |
| GPU training | None |
| Agents run once in a fixed sequence | Plans that fail a check are revised; the path depends on the question and on what the critic finds (see the trace below) |
| Zetaris or Meterless with no real role | Each has a call site and a switch-off test that changes the output |
| Cannot explain the value | The problem sentence at the top |
| Output mostly generic text | Every figure is computed by code from the ledger and carries its rows |
| Cannot run without internet; fails if an API is down | The sample runs offline; every language role has a rule-based fallback |
| Demo needs manual steps not in the README | `npm run desk -- demo` is the whole demo |
| No sample inputs and outputs | `input_examples/`, `output_examples/`, `data/sample/` |
| Cannot show how the agent reached its output | A JSONL trace per run; a cleaned sample is below |
