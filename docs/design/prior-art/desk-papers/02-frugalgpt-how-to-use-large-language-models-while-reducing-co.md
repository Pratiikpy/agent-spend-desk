# Paper note: FrugalGPT: How to Use Large Language Models While Reducing Cost and Improving Performance
Source: arXiv:2305.05176 (https://arxiv.org/abs/2305.05176), read 2026-10-20 by agy (Gemini)

Desk Design Note

### 1. What the Paper Claims
LLM API fees differ by "two orders of magnitude" (Abstract). FrugalGPT cascades queries across models to match best individual LLM accuracy with "up to 98% cost reduction", or "improve the accuracy over GPT-4 by 4% with the same cost" (Abstract).

### 2. The Method
FrugalGPT implements an **LLM cascade** (Section 3):
- **Sequential routing**: An ordered list of models queries LLM APIs from cheapest to dearest.
- **Generation scoring**: DistilBERT regression scores output reliability score in [0, 1].
- **Threshold acceptance**: Returns answer if reliability score exceeds threshold; otherwise queries next LLM.
- **Optimization**: Maximizes task performance under budget, pruning LLM pairs with small answer disagreement.

### 3. Key Numbers (with Section/Table)
- **API price disparity** (Section 1, Table 1): 10M input tokens cost "$30" for GPT-4 versus "$0.2" for GPT-J; 10M output tokens cost "60" (GPT-4) versus "5" (GPT-J). J1-Jumbo charges "250" per 10M output tokens plus "0.005" per request.
- **Enterprise baseline cost** (Section 2): "360,000 queries per month" at "$0.03" input and "$0.06" output per 1k tokens costs "≈$21.2K".
- **Cascade case study** (Section 4, Figure 3): On HEADLINES with budget "$6.5" ("one-fifth of GPT-4’s cost"), cascade queries GPT-J (accept if "greater than 0.96"), J1-L (accept if "greater than 0.37"), then GPT-4. Cost is "reduced by 80%, while the accuracy is even 1.5% higher".
- **LLM diversity** (Section 4, Figure 4): For "about 6% of the data, GPT-4 makes a mistake but GPJ-J (or J-L or GPT-C) gives the right answer" on HEADLINES; on COQA, in "13% of data points" GPT-4 fails while GPT-3 succeeds.
- **Cost savings to match best LLM** (Section 4, Table 3):
  - HEADLINES: GPT-4 cost "33.1", FrugalGPT "0.6", savings "98.3%".
  - OVERRULING: GPT-4 cost "9.7", FrugalGPT "2.6", savings "73.3%".
  - COQA: GPT-3 cost "72.5", FrugalGPT "29.6", savings "59.2%".
  - Across tasks, savings "range from 50% to 98%".
  - Equal-cost gain: "improves the accuracy by up to 5%" (Figure 5); "1% accuracy gain while reducing costs by 73%" on OVERRULING (Section 4).

### 4. What the Desk Should Take From It
- **Replay mechanism**: Replaying past tasks on cheaper routes is validated by FrugalGPT's offline optimization over query logs.
- **When cheaper is good enough**: Feasible only with calibrated outcome scoring and receipt verification before halting.
- **Arbitrage via diversity**: Yields "50% to 98%" savings; "generation diversity" lets cheap models catch expensive model errors.

### 5. Limits & What the Paper Does Not Show
- **Requires labels**: Optimization and scoring "need some labeled examples" (Section 5). Unsupervised open-ended agent tasks are NOT SHOWED / NOT VERIFIED.
- **Distribution shift**: Requires queries from "same or similar distribution as the test examples" (Section 5); vulnerable to task drift.
- **No multi-turn agent execution**: Tested solely on single-turn QA (HEADLINES, OVERRULING, COQA). Multi-step tool use, loops, and side-effects are NOT VERIFIED.
- **Sequential latency**: Sequential fallback latency is omitted from optimization (Section 5).

### 6. What to Avoid
- **Static price tiers**: Prompt/output token cost ratios invert pricing order (e.g. J1 is 2nd priciest on HEADLINES, Section 4).
- **Cascading without calibrated scoring**: Unreliable scoring triggers worst-case cascade hops to all models, maximizing cost and latency.
- **Assuming frontier model dominance**: Do not assume GPT-4 dominates all sub-queries.
