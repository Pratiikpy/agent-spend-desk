# Paper note: ALCE: Enabling Large Language Models to Generate Text with Citations
Source: arXiv:2305.14627 (https://arxiv.org/abs/2305.14627), read 2026-10-20 by agy (Gemini)

Title match confirmed: arXiv:2305.14627 titled 'Enabling Large Language Models to Generate Text with Citations' (ALCE benchmark).

### 1. What the paper claims
LLMs used for information seeking hallucinate and lack verifiability. Generating text with passage citations enables verification and factual grounding. ALCE provides the first reproducible, automated end-to-end benchmark evaluating systems across fluency, correctness, and citation quality. Current LLMs have "considerable room for improvement".

### 2. The method
Evaluates three datasets: ASQA (ambiguous factoid, 21M Wikipedia), QAMPARI (entity list, 21M Wikipedia), and ELI5 (long-form explanatory, 899M Sphere).
- **Fluency**: MAUVE score sanity check.
- **Correctness**: Exact match recall for ASQA, recall-5 for QAMPARI, and claim recall on ELI5 (using InstructGPT sub-claims verified by TRUE T5-XXL NLI).
- **Citation Quality**:
  - *Citation Recall*: Statement entailed by concatenated citations ($\phi(\text{concat}(\mathcal{C}_i), s_i) = 1$) via TRUE NLI.
  - *Citation Precision*: Citations not irrelevant (removing citation still entails statement, while citation alone does not).
- **Modeling**: Vanilla in-context retrieval, Summ/Snippet compression, InlineSearch on-the-fly retrieval, ClosedBook, Rerank, and PostCite.

### 3. Key numbers with section or table (quoted verbatim)
- Abstract: "lack complete citation support 50% of the time" on ELI5.
- Section 4.2: "top-5 retrieved passages can only cover 56.8% percent of the answers in ASQA."
- Table 4 (ASQA): ChatGPT Vanilla (5-psg) achieves correctness "40.4", citation recall "73.6", precision "72.5". Rerank achieves recall "84.8", precision "81.6". LLaMA-13B has recall "10.6", precision "15.4"; Chat-70B achieves recall "62.9", precision "61.3".
- Section 5.1 & Table 4: ClosedBook+PostCite citation recall is "lower than Vanilla by 47% on ASQA" (scoring "26.7"); ClosedBook has "only a 2%" gap on ASQA correctness ("38.3" vs "40.4").
- Table 5 (QAMPARI): ChatGPT Vanilla recall-5 "20.8", citation recall "20.5".
- Table 6 (ELI5): ChatGPT Vanilla claim recall "12.0", citation recall "51.1", precision "50.0".
- Section 6: Human correlation Cohen's kappa is "0.698" for recall and "0.525" for precision. Automatic accuracy vs human gold labels is "85.1%" for recall and "77.6%" for precision.

### 4. What the Desk should take (for 's Agent Spend and Worth Desk)
- **Statement-level Citation Recall & Precision**: Automate outcome receipts on the Plumbline core by verifying whether generated claims are entailed by cited evidence spans using NLI.
- **Re-ranking as an outcome filter**: Sampling $n=4$ and re-ranking by citation recall significantly boosts quality before settling payment.
- **Metric limits**: ALCE precision penalizes partial multi-source support. The Desk must decompose claims into atomic statements to prevent false penalties.

### 5. Limits and what the paper does not show
- **NLI model errors**: TRUE misses subtle entailment and cannot detect partial support.
- **Open-book distraction**: Open-book LLMs get distracted by irrelevant passages, lowering correctness.
- **Context plateau**: Increasing passages (10 to 20) does not proportionally improve output; ChatGPT plateaus at top-1 for correctness.
- **Narrow scope**: Single-turn QA only; does not test agent loops, tool invocations, code execution, or multi-step budgets.

### 6. What to avoid
- **Avoid post-hoc citation (PostCite)**: Generating claims closed-book and matching citations afterwards fails catastrophically ("lower than Vanilla by 47%").
- **Avoid naive context stuffing**: Pushing 20 passages without reranking degrades precision.
- **Avoid relying on fluency/utility alone**: Fluent responses frequently mask hallucinated statements with near-zero citation support.
