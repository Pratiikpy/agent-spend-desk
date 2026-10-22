# Agent Loop Spec: <system name>

Instructor's 8-line template (`docs/intel/02-how-organizers-propose-we-build-and-plan.md` §9), expanded so it is directly buildable and testable. Copy to `docs/design/agent-loop-spec.md` when the use case is chosen.

**Track:** · **User:** · **Decision supported:** · **Autonomy level (L0–L3):**

## 1. Goal
One sentence. What output, for whom, judged how.

## 2. Plan (at most 5 steps)
1.
2.
3.
4.
5.

## 3. Tools
| Tool | Inputs | Output | Fail mode | Fallback | Timeout | Max retries |
|---|---|---|---|---|---|---|
| | | | | | | |

Sponsor tools are marked: **[Zetaris] [Meterless] [NVIDIA] [Bright Data]**.

## 4. Memory
| Layer | What it holds | Written by | Read by | Lifetime |
|---|---|---|---|---|
| Scratchpad | | | | run |
| Decision log | | | | run |
| Episodic / reusable notes | | | | across runs |

## 5. Rubric (0–3 each)
| Criterion | 0 | 1 | 2 | 3 |
|---|---|---|---|---|
| Accuracy | | | | |
| Appropriateness | | | | |
| Actionability | | | | |

Pass mark: 7 of 9 (organizer default; change only with a reason in `docs/DECISIONS.md`).

## 6. Stop conditions
- Score below pass after one revision: ask human or output with explicit limitations.
- Cap hit (turns / tool calls / wall clock): degrade to fallback, log why.
- Evidence missing for a claim: strip the claim or raise a question; never invent.

## 7. Run log schema
One JSON line per event in `logs/run-<timestamp>.jsonl`:

```json
{"ts":"","run_id":"","agent":"","step":"","decision":"","why":"","inputs_ref":"","result_ref":"","score":null,"next":"","cap_state":{"turns":0,"tool_calls":0,"elapsed_s":0}}
```

## 8. Guardrails
- Step cap:
- Tool-call cap:
- Wall-clock cap:
- Hard stops (what the system must never do):
- Always log *why*.

## Agent roster
| Agent | Pairing | Role | Input | Output | Talks to |
|---|---|---|---|---|---|
| | | | | | |

## Collaboration checklist (need at least three)
- [ ] Planner delegates subtasks  - [ ] Specialist uses data or tools  - [ ] Evaluator critiques
- [ ] Agent revises after critique  - [ ] Risk agent flags unsupported claims  - [ ] Structured messages in shared memory
- [ ] Branch on confidence  - [ ] Fallback if data or API fails  - [ ] Final answer carries traceable evidence
