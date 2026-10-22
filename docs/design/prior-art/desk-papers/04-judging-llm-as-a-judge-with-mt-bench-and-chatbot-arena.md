# Paper note: Judging LLM-as-a-judge with MT-Bench and Chatbot Arena
Source: arXiv:2306.05685 (https://arxiv.org/abs/2306.05685), read 2026-10-20 by agy (Gemini)

— Desk Design Note:

## 1. What the paper claims
The paper claims strong LLMs (notably GPT-4) can evaluate open-ended chat assistants as automated judges, matching human evaluation quality. GPT-4 achieves "over 80%" agreement with human preferences (Abstract, Section 7), providing a scalable, explainable proxy where traditional closed-ended benchmarks fail to detect conversational and instruction-following quality.

## 2. The method
The authors build two benchmarks:
- **MT-Bench**: "80 high-quality multi-turn questions" across "8 common categories" (writing, roleplay, extraction, reasoning, math, coding, STEM, humanities), with "10 multi-turn questions" each (Section 2.2).
- **Chatbot Arena**: Crowdsourced anonymous battles collecting "around 30K votes" (Section 2.3).
They evaluate three judge modes: pairwise comparison, single-answer grading, and reference-guided grading. Agreement is measured against "58 expert-level human labelers" (~"around 3K votes") and Arena crowd users ("2114 unique IPs") across non-tie (S2) and tie-inclusive (S1) setups (Section 4.1).

## 3. Key numbers with section or table
- **Agreement** (Section 4.2, Table 5b): On MT-Bench turn 2 (S2), GPT-4 pairwise vs human agreement reaches "85%", higher than human-to-human agreement at "81%". GPT-4 single-answer vs pairwise agreement is "95%". Humans deemed GPT-4 reasonable in "75%" of cases and changed choices in "34%" of cases. On Arena (Table 6), GPT-4 pairwise vs human agreement is "87%".
- **Position Bias** (Section 3.3, Table 2): Consistency when swapping order on default prompts is "23.8%" for Claude-v1 ("75.0%" biased toward first), "46.2%" for GPT-3.5 ("50.0%" biased toward first), and "65.0%" for GPT-4 ("30.0%" biased toward first). Few-shot prompting raises GPT-4 consistency to "77.5%" (Table 13).
- **Verbosity Bias** (Section 3.3, Table 3): Under a "repetitive list" attack, failure rate is "91.3%" for Claude-v1 and GPT-3.5, but "8.7%" for GPT-4.
- **Math/Reasoning Failure & Reference Fix** (Section 3.3–3.4, Table 4): Default GPT-4 math grading failure rate is "14/20" (text notes "70%"), dropping to "6/20" with Chain-of-Thought, and "3/20" (text notes "15%") with reference-guided grading ("70% to 15%").
- **Self-Enhancement** (Section 3.3): GPT-4 shows "10%" higher win rate for itself; Claude-v1 shows "25%".

## 4. What the Desk should take from it
The Desk evaluates task replay on cheaper routes, canary drift, and outcome receipts:
- **Mitigate Position Bias**: Never use single-pass pairwise comparison. Enforce bidirectional swapping: declare a win only if preferred in both orders; otherwise declare a tie.
- **Defend Against Verbosity Bias**: Crucial for spend control. Weaker models reward verbose slop ("91.3%" failure). The Desk must penalize runaway token padding and avoid weak judges for outcome verification.
- **Reference-Guided Verification**: Replays and canaries on math/code/reasoning must supply reference solutions. CoT alone repeats mistakes ("6/20"); references slash failures to "3/20".
- **Single-Answer Grading**: Validated for independent pipeline runs ("95%" alignment with pairwise), avoiding quadratic comparison costs.

## 5. Limits and what the paper does not show
- Focuses only on chatbot helpfulness; explicitly "largely neglects safety" (Section 6) and combines accuracy, relevance, and creativity into a single score.
- Tested on dialog chats, NOT autonomous agent traces, external tool calling, multi-step environment mutations, or API failures.
- Statistical evidence for self-enhancement is inconclusive ("cannot determine").
- Few-shot prompts make API calls "4×" more expensive without improving human agreement (Section 3.4, D.2).

## 6. What to avoid
- Avoid single-order pairwise evaluations without swapping.
- Avoid using weak judges (e.g., GPT-3.5) for spend/worth auditing without reference solutions.
- Avoid splitting multi-turn agent conversations into separate turn prompts, which breaks reference context (Section 3.5).
