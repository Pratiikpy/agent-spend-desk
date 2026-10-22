# Paper note: Game-theoretic statistics and safe anytime-valid inference
Source: arXiv:2210.01948, https://arxiv.org/abs/2210.01948, read 2026-10-20 by agy (Gemini)

, here is the research note for the Agent Spend and Worth Desk:

### 1. What the Paper Claims
The paper unifies Safe Anytime-Valid Inference (SAVI), demonstrating that measures of statistical evidence and certainty remain valid under continuous monitoring, arbitrary stopping rules, and optional continuation. Admissible SAVI procedures must fundamentally rely on nonnegative test martingales ("testing by betting"). Unlike p-values, e-values quantify evidence as capital in a betting game, allowing valid combination via averaging under arbitrary dependence and multiplication over sequential trials.

### 2. Method
Testing is formulated as a game where a Skeptic begins with unit capital ($1$). In each round $t$, Skeptic purchases payoffs $S_t \ge 0$ satisfying $\mathbb{E}_P[S_t \mid \mathbf{F}_{t-1}] \le 1$ under null $\mathbf{P}$. The accumulated wealth $M_t = \prod_{i=1}^t S_i$ forms a test supermartingale (or e-process $E_t \le M_t^P$). By Ville's inequality, stopping when $M_t \ge 1/\alpha$ guarantees anytime-valid Type-I error control $\le \alpha$. Core construction techniques include plug-in strategies, mixtures, Universal Inference (split-sample likelihood ratios), and Growth-Rate Optimal (GRO) bets that maximize expected log wealth under alternatives.

### 3. Key Numbers (Exact Quotes)
- Section 1: "an anonymous survey of over 2000 psychologists found 56% admitting to “deciding whether to collect more data after looking to see whether the results were significant”" and "25 subjects run, then 10, then 7, then 5."
- Section 2.1 & Eq. 1: Unit bet expectation "$\mathbb{E}_P[S_t(X_t)]\le 1$" bought at price "1".
- Section 2.5 & Eq. 8: Ville's inequality "$P(\sup_t M_t \ge \alpha) \le 1/\alpha$" for "$\alpha \ge 1$".
- Section 2.5 & Eq. 9: Type-I error control "$\sup_{P\in\mathbf{P}}P(\exists t\ge 1:E_t\ge 1/\alpha)\le\alpha$".
- Section 2.7: Anytime-valid p-value "$p_t := 1/(\max_{s\le t} M_s)$" where "$P(\exists t\ge 1:p_t\le u)\le u$" for "$u\in[0,1]$".
- Section 6.2: e-BH threshold "$k^{*}:=\max\{k\in\{1,\dots,K\}:e_{[k]}\ge K/(k\alpha)\}$" controlling FDR at "$\alpha$".
- Appendix B: Width tradeoff: anytime-valid confidence sequences "tend to get between 1.5 and 2 times as wide" as fixed-sample confidence intervals.

### 4. What the Desk Should Take from It
For the Desk's daily quality-drift canary, standard p-values fail under continuous daily monitoring:
- **Daily Canary Guarantee**: To detect if an agent regressed on Tuesday, the Desk tests $H_0: \text{agent has not degraded}$. We update e-process $M_t = \prod_{i=1}^t S_i$ after each canary task. Alerting when $M_t \ge 1/\alpha$ (e.g., $\alpha=0.05 \implies 1/\alpha=20$) guarantees that the lifetime probability of ever raising a false alarm under $H_0$ is at most $\alpha$, regardless of when or how often the owner inspects the desk.
- **Aggregation**: Fleet-wide canary tasks can be averaged safely under arbitrary correlation, while e-BH controls FDR across thousands of simultaneous regression assertions.

### 5. Limits and What the Paper Does Not Show
- **Width Penalty**: Confidence sequences are wider ("between 1.5 and 2 times as wide"), requiring larger drift effect sizes or more runs before detection compared to fixed-sample tests.
- **Data Splitting Waste**: Universal Inference splits data to handle composite nulls, halving sample efficiency.
- **LLM Workloads Unverified**: The paper evaluates sub-Gaussian and invariant parametric/nonparametric cases; LLM canary tasks (discrete pass/fail drift, token spend variance) are NOT VERIFIED in the paper.

### 6. What to Avoid
- **e-hacking** (Section 6.4): Testing multiple betting strategies and reporting the highest wealth. Bet parameters must be strictly predictable (fixed using only history $\mathbf{F}_{t-1}$).
- **Fixed-sample P-values**: Never compute classical t-tests on continuously monitored canary metrics.
- **Post-hoc Weighting**: Never weight task e-values based on current-run outcomes.
