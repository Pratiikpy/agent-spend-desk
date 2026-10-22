# Paper note: RouteLLM: Learning to Route LLMs with Preference Data
Source: arXiv:2406.18665 (https://arxiv.org/abs/2406.18665), read 2026-10-20 by agy (Gemini)

For 's Agent Spend and Worth Desk design.

### 1. What the Paper Claims
RouteLLM trains routers to route queries dynamically between a strong model (M_s) and weak model (M_w). It claims to optimize cost-quality trade-offs, achieving "cost savings of up to 3.66x" (Section 5.4, Table 6), cutting costs "by over 2 times in certain cases-without compromising the quality of responses" (Abstract), and showing "significant transfer learning capabilities" (Abstract) across unseen models without retraining (Section 5.2).

### 2. The Method
Router R^alpha(q) calls M_s when win probability P(win_s | q) >= alpha, else M_w (Eq. 2). Training uses 80k Chatbot Arena battles (D_arena, Section 4.1) across 10 tiers, augmented with 1,500 MMLU questions (D_gold) or ~120k GPT-4 pairs costing "around $700 USD in total" (D_judge, Section 4.1.1). Four routers are evaluated (Section 4.2): (1) Similarity-Weighted (SW) ranking (Bradley-Terry, gamma=10), (2) Matrix Factorization (bilinear embeddings), (3) BERT (BERT_BASE), and (4) Causal LLM (Llama-3-8B LoRA).

### 3. Key Numbers (Exact Quotes)
- **Cost savings over GPT-4** (Table 6): MT Bench: "3.66 (95% GPT-4 quality)" at CPT(50%), "2.49" at CPT(80%); MMLU: "1.41 (92% GPT-4 quality)" at CPT(50%), "1.14" at CPT(80%); GSM8K: "1.49 (87% GPT-4 quality)" at CPT(50%), "1.27" at CPT(80%).
- **MT Bench** (Table 1): Random CPT(50%) "49.03(±4)%". Augmented D_judge: Matrix Factorization hits CPT(50%) "13.40%", CPT(80%) "31.31%", APGR "0.802" ("(+60.4%)"); BERT hits CPT(50%) "19.58%", APGR "0.751" ("(+50.2%)").
- **MMLU** (Table 2): Pure D_arena APGR "0.473" to "0.524". Augmented D_gold: Causal LLM hits CPT(50%) "35.49%", Matrix Factorization "35.46%", SW Ranking "35.40%", APGR "0.603" ("(+20.7%)") vs Random "50.07(±0)%".
- **GSM8K** (Table 3): Augmented D_judge: Causal LLM hits CPT(50%) "33.64%", CPT(80%) "63.26%", APGR "0.622" ("(+25.3%)") vs Random "50.00(±2)%".
- **Model Transfer** (Table 4): Claude 3 Opus/Sonnet: SW Ranking reaches CPT(50%) "23.27%", APGR "0.772" ("(+56.6%)"). Llama 3.1 70B/8B: SW Ranking reaches CPT(50%) "21.18%", CPT(80%) "29.39%", APGR "0.767" ("(+49.8%)") vs Random "47.52(±3)%".
- **Overhead** (Table 7): Matrix Factorization runs "155.16" req/s at "$3.32" per 1M requests. SW Ranking runs "2.9" req/s at "$39.26" per 1M requests, adding "no more than 0.4% as compared to GPT-4 generation" (Section 5.5).

### 4. What the Desk Should Take From It
- **Trade-off metrics**: Measure quality loss via Performance Gap Recovered (Eq. 6: PGR = (r(M_R) - r(M_w)) / (r(M_s) - r(M_w))), Call-Performance Threshold (CPT(x%)), and APGR (Eq. 7).
- **Counterfactual replay**: Powers Desk replay ("what would have passed on a cheaper route at what price") by sweeping alpha over historical traces.
- **Deploy Matrix Factorization**: Lowest MT Bench CPT(50%) ("13.40%"), high throughput ("155.16" req/s), low overhead ("$3.32" / 1M requests).
- **Portability**: Unseen pairs preserve efficiency without retraining, enabling instant budget simulation.

### 5. Limits & What the Paper Does Not Show
- **Single-turn prompts only**: Evaluates isolated prompts (Appendix D: "short prompts in a single turn setting"); misses multi-turn agent state, loops, and retries.
- **Binary only**: Limited to 2 models; N-way fleet routing is unaddressed (Section 6).
- **Distribution drop**: Unaugmented Arena routers failed on MMLU/GSM8K; transfer requires domain augmentation.

### 6. What to Avoid
- **Avoid unaugmented deployment**: Raw Arena routers fail on domain reasoning.
- **Avoid SW Ranking in production**: At "2.9" req/s, inference optimization causes severe latency bottlenecks.
- **Avoid static token cost models**: Real bills stem from context growth and runaway loops, not fixed 95:264 token ratios.
