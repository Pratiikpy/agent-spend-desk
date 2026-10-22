# Paper note: tau-bench: A Benchmark for Tool-Agent-User Interaction in Real-World Domains
Source: arXiv:2406.12045, https://arxiv.org/abs/2406.12045, read 2026-10-20 by agy (Gemini)

Prepared for  for Agent Spend and Worth Desk design.

### 1. What the Paper Claims
Existing benchmarks evaluate static, single-turn tool calls, failing to test multi-turn user interaction or domain policy adherence. tau-bench proves frontier language agents lack consistency: even state-of-the-art models succeed on "<50%" of realistic tasks and suffer steep performance drops over repeated trials.

### 2. Method
tau-bench formalizes tasks as POMDPs across tau-retail and tau-airline. Agents receive tool schemas and domain policies in system prompts, interacting dynamically with an LM user (`gpt-4-0613`, temperature 1.0; capped at "at most 30 agent actions"). Evaluation calculates binary reward r = r_action x r_output in {0, 1} by comparing final database states with ground truth (r_action) and verifying required communication substrings (r_output). The authors introduce pass^k = E[(c/n)^k] to measure consistency across k independent trials.

### 3. Key Numbers (Quoted)
- **Table 1 (Domain Statistics):** tau-retail has "500 users, 50 products, 1,000 orders", API tools "7 write, 8 non-write", and "115" tasks. tau-airline has "500 users, 300 flights, 2,000 reservations", API tools "6 write, 7 non-write", and "50" tasks.
- **Table 2 (Pass^1 via function calling):** Average: gpt-4o "48.2" (retail "61.2", airline "35.2"); gpt-4-turbo "45.1" (retail "57.7", airline "32.4"); claude-3-opus "39.5" (retail "44.2", airline "34.7"); mixtral-8x22b "24.7" (retail "17.7", airline "31.6"); gemini-1.5-pro "17.9" (retail "21.7", airline "14.0"); meta-llama-3-70B "14.6" (retail "14.8", airline "14.4").
- **Abstract & Section 5.1 (Inconsistency):** Frontier models "succeed on <50% of the tasks"; for gpt-4o, "pass^8 < 25% in retail" despite ">60%" average pass^1. In airline, "gpt-4o solves only 35.2% of the tasks".
- **Table 3 (Policy Ablation):** Removing domain policies degrades airline gpt-4o from "33.2 → 10.8" ("-22.4%"), but gpt-3.5 only drops "10.8 → 9.6" ("-1.2%").
- **Section 5.1 (Cost Analysis):** Retail agent/user simulation costs are "$0.38 / $0.23 per task respectively", totaling "around 200 dollars" per run; input prompt consumes "95.9%" of spend vs "4.1%" for completion.
- **Section 5.2 (Failures):** In "36" retail agent failure cases (from "115" tasks, "40" failed, "pass^1=65.2%"): wrong argument/info caused "~55% of overall failures", wrong decision-making "25% of overall failures", partial resolution "19% of cases". Hallucinated IDs per task: gpt-4o "0.46" vs gpt-3.5-turbo FC "2.08" and Act "6.34".

### 4. What the Desk Should Take from It
- **One run is not evidence:** Single-trial success (pass^1) conceals failure when multi-trial consistency collapses ("pass^8 < 25% in retail"). The Desk's daily canaries and cheaper-route replays cannot certify model viability from one passing run; pass^k consistency across repeated runs is required before switching routes or setting caps.
- **Plumbline ground truth:** Outcome receipts must verify state mutations directly against databases (r_action), never trusting conversational text or LLM self-evaluations.
- **Prefix spend dominance:** Because "95.9%" of agent cost is input tokens (policies, schemas, history), prompt caching, schema pruning, and early loop cutoff gates yield the largest dollar savings.

### 5. Limits and What the Paper Does Not Show
- **Synthetic user bias:** Simulated by gpt-4-0613 tuned against gpt-4-turbo, introducing circular bias. Simulated users accept flawed agent proposals without verification (Section 6).
- **Narrow scope:** Restricted to two mock domains with deterministic local databases; does not test distributed rollbacks, network failures, or multi-agent orchestration.

### 6. What to Avoid
- Avoid certifying model routing or prompt revisions on single-trial passes.
- Avoid text-based evaluations when deterministic state diffs can be audited.
- Avoid unverified tool calls: "~55% of overall failures" stemmed from wrong arguments, ungrounded IDs, or miscalculations.
