# Paper note: FActScore: Fine-grained Atomic Evaluation of Factual Precision in Long Form Text Generation
Source: arXiv:2305.14251 (https://arxiv.org/abs/2305.14251), read 2026-10-20 by agy (Gemini)

— Desk Design Note:

## 1. What the paper claims
Sentence-level verification fails on long-form text because sentences mix truth and hallucination (Footnote 2: "4.4 per sentence in ChatGPT, 40% of which are a mixture of supported and unsupported information"). The paper introduces FActScore: breaking generations into atomic facts and computing the percentage supported by a reliable knowledge source. Commercial LMs struggle: ChatGPT achieves "58.3%", InstructGPT "42.5%", and retrieval-augmented PerplexityAI "71.5%" (Table 1). An automated estimator pairing retrieval with an LM achieves "less than a 2% error rate" (Abstract, Table 3), evaluating "6,500 generations" across 13 LMs saving "$26K" (Abstract, Section 4.3).

## 2. The method
Two-stage pipeline (Section 3.1, 4.1):
1. **Atomic Fact Generation**: Breaks sentences into independent atomic facts via few-shot InstructGPT (Table 15).
2. **Fact Verification**: Validates facts against Wikipedia via four setups: No-context LM, Nonparametric Probability (NP via masked LM likelihood), Retrieve -> LM (retrieving k="5" 256-token passages via GTR-Large/BM25 with "True or False?" prompting), and Retrieve -> LM + NP ensemble (assigns Supported only if both agree).

## 3. Key numbers with section or table
- **Model Factuality** (Table 1, Section 3.4): FActScore is "42.5%" for InstructGPT, "58.3%" for ChatGPT, "71.5%" for PerplexityAI. Mixed supported/unsupported sentences: "40%".
- **Estimator System Error Rate (ER)** (Table 3, Section 4.2): Inst-LLAMA + Retrieve -> LM + NP achieves ER of "1.4" on InstructGPT and "0.4" on ChatGPT. ChatGPT + Retrieve -> LM achieves ER of "0.8" on PerplexityAI.
- **Segment-Level F1_micro** (Table 10, Appendix B.2): For single-fact validation, ChatGPT + Retrieve -> LM achieves F1_micro of "87.5" (InstructGPT), "80.2" (ChatGPT), and "65.8" (PerplexityAI).
- **Human Agreement & Edits** (Appendix A.2, A.3): Annotator agreement is "96%, 90% and 88%" on InstructGPT, ChatGPT, PerplexityAI. Human experts split atomic facts in "18%" and merged in "34%" of cases.
- **Estimator Error Breakdown** (Table 13, Appendix B.3): On 30 misclassifications, "70%" lacked direct evidence in retrieved passages; "17%" were distracted by other passages; "7%" were context-dependent; "3%" were wrong despite correct passage; "3%" were annotation errors.
- **Model Comparison at Scale** (Table 5, Section 4.3): Across "6,500 generations", GPT-4 yields "60.8" facts per response vs ChatGPT's "37.0".

## 4. What the Desk should take from it
- **Atomic Claim Decomposition**: Plumbline cannot audit agent outputs at sentence level; hallucinations hide inside mixed sentences ("40%"). Outputs must be decomposed into atomic units before checking.
- **System vs. Segment Error**: System ER is low ("less than a 2%"), but segment F1_micro drops to "80.2"–"87.5". Because Desk receipts audit individual agent runs, segment-level errors require explicit approval gates and source-quote citations.
- **Prompting Strategy**: Table 11 proves "TF Prompting" beats question-generation "QA Prompting" (F1 "78.9" vs "65.3"); question generation creates ambiguous queries and false rejections.
- **Grounded Verification**: Eliminates ungrounded hallucinations; truth must be evaluated relative to an auditable corpus.

## 5. Limits and what the paper does not show
- **Domain Scope**: Restricted to Wikipedia biographies with static, non-debatable facts; NOT VERIFIED on multi-step agent actions, tool call parameters, or environment mutations (Limitations).
- **Precision Only**: Ignores recall (Table 6, Limitations); an agent gaming brevity or abstaining gets a high FActScore.
- **Single-Source Assumption**: Assumes evidence resides within a single topic page.

## 6. What to avoid
- Avoid sentence-level claim matching.
- Avoid ungrounded evaluation (No-context LM drops F1 to "40.0"–"61.2", Table 10).
- Avoid question-generation QA prompting (Table 11).
- Avoid evaluating precision without tracking abstention rate and fact count.
