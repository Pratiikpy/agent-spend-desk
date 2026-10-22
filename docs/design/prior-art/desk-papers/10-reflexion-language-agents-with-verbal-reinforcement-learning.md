# Paper note: Reflexion: Language Agents with Verbal Reinforcement Learning
Source: arXiv:2303.11366v4 (https://arxiv.org/abs/2303.11366), read 2026-10-20 by agy (Gemini)

****, here is the research note for the Agent Spend and Worth Desk:

### 1. What the Paper Claims
Language agents can learn from trial-and-error without updating model weights by converting environmental feedback into natural language self-reflections. These verbal critiques act as a "semantic gradient" stored in episodic memory to guide subsequent attempts across sequential decision-making, reasoning, and programming tasks.

### 2. Method
Reflexion structures an agent into three modular components alongside an episodic memory buffer:
- **Actor ($M_a$)**: Generates actions and text conditioned on observations and memory buffer state.
- **Evaluator ($M_e$)**: Computes performance feedback (scalar reward, compiler logs, heuristic checks, or self-generated unit test suites).
- **Self-Reflection ($M_{sr}$)**: An LLM that inspects failed trajectories and evaluation signals to write concrete verbal critiques analyzing errors.
- **Episodic Memory ($mem$)**: A sliding-window buffer retaining recent self-reflections as in-context prompts for subsequent trials.

### 3. Key Numbers (Quoting Exact Text)
- **HumanEval (PY) Pass@1**: Baseline `'80.1 (GPT-4)'` vs Reflexion `'91.0'` (Table 1).
- **MBPP (PY) Pass@1**: Baseline `'80.1 (GPT-4)'` vs Reflexion `'77.1'` (Table 1). The paper notes an internal test false positive rate of `'16.3%'` (Section 4.3).
- **HumanEval (RS) Pass@1**: Baseline `'60.0 (GPT-4)'` vs Reflexion `'68.0'` (Table 1).
- **Leetcode Hard (PY)**: Baseline `'7.5 (GPT-4)'` vs Reflexion `'15.0'` (Table 1).
- **HumanEval Rust Ablation (50 hardest)**: Base model `'0.60'`, Reflexion `'0.68'`, Test generation omission `'0.52'` (`'inferior 52% vs 60% (baseline) accuracy'`), Self-reflection omission `'0.60'` (Table 3).
- **Weaker Model (Starchat-beta)**: Baseline `'0.26'` vs Reflexion `'0.26'` (Table 4)—zero gain.
- **ALFWorld**: Solved `'130 out of 134 tasks'` (Section 4.1). ReAct-only baseline halted between trials `'6 and 7'` converging at a hallucination rate of `'22%'` (Section 4.1).
- **HotpotQA**: Reflexion improved accuracy by `'14%'` over CoT (GT) (Section 4.2), and self-reflection produced an `'8% absolute boost over the episodic memory learning advantage'` (Section 4.2). HotPotQA ReAct + gpt-4 rose from `'0.39'` to `'0.51'` (Table 5).

### 4. What the Desk Should Take from It
- **What Revision Loops Gain**: Verbal reflections catch execution traps and synthesize failures into concise operational hints, breaking out of loops where simple retries fail.
- **Where Revision Loops Fail**: When evaluators are ungrounded or flaky, self-reflection causes severe regression. In Table 3, removing unit tests caused accuracy to collapse from 0.60 to 0.52 because the agent performed "harmful edits to the implementation." On MBPP, a 16.3% false positive rate caused Reflexion to underperform baseline GPT-4.
- **Desk Mechanism**: The Desk must meter and audit retry spend. It should flag ungrounded revision loops, require independent verification gates before authorizing paid retries, and enforce loop breaker caps (halting when identical actions persist for `>3 cycles` or `>30` actions).

### 5. Limits & What the Paper Does Not Show
- **Token and Dollar Cost Ignored**: The paper omits total prompt/completion token consumption across trials (up to 12 attempts); economic ROI is unmeasured. Real-world spend impact: **NOT VERIFIED**.
- **Model Capability Bound**: Fails on weaker models (`0.26` to `0.26`); requires expensive frontier LLMs to generate valid critiques.
- **Memory Brittleness**: Constrained to a sliding window (`last 3 self-reflections` or 1 in coding), vulnerable to catastrophic forgetting and local minima.
- **Scope**: Excludes non-deterministic APIs, concurrency, and multi-agent coordination.

### 6. What to Avoid
- **Ungrounded Self-Refinement**: Never allow models to refine outputs without deterministic, external verification.
- **Self-Authored Acceptance Tests**: Do not rely on agent-authored evaluation suites without independent audit.
- **Uncapped Retry Spend**: Avoid paying for unbounded reflection rounds past diminishing returns (stalling after 3 consecutive failures).
