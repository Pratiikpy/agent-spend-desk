# Track 2 prior art: verification and factuality methods

Teardown of six third-party repositories that define how long-form text is checked against evidence, and a proposed verification stack for a TypeScript product built on them. Written 2026-10-13.

**Method and limits.** Every statement about a repository comes from reading its code in `research/track-2-agent-that-can-explain-why/<repo>/` (read-only clones, shallow, commit ids below). No code was run, no model was called, no paper was downloaded, nothing was installed. Numbers quoted from a repository README are marked "README claim" and are NOT VERIFIED by us. File and function names are given so each claim can be re-checked in under a minute. Where behaviour depends on a library or model we did not open, that is said explicitly.

**Reading guide.** Each repository section answers the same seven questions: (1) what it measures, (2) steps and prompts actually used, (3) failure modes visible in code, (4) cost and bounds, (5) licence and commit, (6) ADOPT / BEAT, (7) NOT VERIFIED.

---

## 0. Findings in six lines

1. Five of the six repositories collapse "the evidence is silent" and "the evidence says the opposite" into one label. None ships data labelled for contradiction. Contradiction-detection recall therefore cannot be measured with any existing benchmark in these repositories; we must build the gold set.
2. Only ALCE separates attribution (is the sentence entailed by what it cites) from factuality (is it true). SAFE and FActScore measure factuality against an external corpus and say nothing about whether the cited source is the one that supports the claim. For a product whose promise is "explain why", attribution is the primary quantity.
3. SAFE discards source URLs (only search snippets are kept), so its verdicts cannot be shown to a human as evidence. FActScore and ragas keep passages but not spans.
4. Judge nondeterminism is uncontrolled everywhere (FActScore verifier temperature 0.7, SAFE 0.1, ragas 0.01) and none of the pipelines report a noise floor or a cluster-aware confidence interval.
5. The only deterministic checks in the set are ragas `QuotedSpansAlignment` (real defects, section 5) and FActScore's date/integer guard on its decomposition (narrow, section 2). Nobody tests whether the judge still says "supported" when the evidence is removed.
6. The debate repository has fixed rounds, no evidence, no stopping rule other than a refusal heuristic, and no licence file.

---

## 1. SAFE and LongFact (`research/track-2-agent-that-can-explain-why/long-form-factuality`)

### 1.1 What it measures
SAFE (Search-Augmented Factuality Evaluator) rates every atomic fact in a long answer as `Supported`, `Not Supported` or `Irrelevant` (to the prompt). The aggregate is F1@K (`eval/metric_utils.py::calculate_metrics`):

```
Precision = S / (S + N)                 # Irrelevant facts excluded from both terms
Recall    = min(S / K, 1)               # K = number of supported facts the user "wants"; code default 100
F1@K      = 0 if S == 0 else 2PR/(P+R)
```

`S` = supported count, `N` = not-supported count. The README notes the formula assumes no repeated facts; nothing in the code deduplicates. LongFact is the prompt set (2,280 prompts, 38 topics, Objects and Concepts variants; README says data is CC-BY-4.0).

The unit is a fact judged against **Google search snippets**, not against a document the answer cited. It is a factuality metric, not an attribution metric.

### 1.2 Algorithm and prompts (file, function)
Entry: `eval/safe/search_augmented_factuality_eval.py::main`.

1. Split into atomic facts: `eval/safe/get_atomic_facts.py::main` calls `third_party/factscore/atomic_facts.py::AtomicFactGenerator.run`. Paragraphs by newline, sentences by NLTK `sent_tokenize` plus `fix_sentence_splitter` (initials such as `A. B.`), then per sentence an LLM prompt `ATOMIC_FACT_INSTRUCTION` + 7 fixed demos + 1 demo retrieved by BM25 over demo sentences (`best_demos`). Temperature 0. `is_bio = True` is hard-coded, so the biography demos are used for every LongFact topic, not only biographies.
2. Make self-contained: `classify_relevance.py::revise_fact`, prompt `_REVISE_FORMAT`. Replace pronouns, "unknown entities" ("this event") and non-full names with the entity from the response; "MUST NOT change ... MUST NOT add" any claim. Four worked examples; the model reasons then returns the fact in a code block (`extract_first_code_block`). Falls back to the original fact if nothing parses.
3. Relevance: `classify_relevance.py::check_relevance`, prompt `_RELEVANCE_FORMAT`. Two subjects are "Foo" (relevant) if the response explains how they relate; answer in square brackets. **If the answer never parses after retries, the fact is assumed relevant** (`answer = not answer or ...`).
4. Rate: `rate_atomic_fact.py::check_atomic_fact`. Loop `for _ in range(max_steps)` (5): `maybe_get_next_search` asks the model for ONE Google query that adds information not in the current KNOWLEDGE (`_NEXT_SEARCH_FORMAT`), runs it through Serper (`query_serper.py::SerperAPI.run`, 3 results), appends the result. Then `maybe_get_final_answer` (`_FINAL_ANSWER_FORMAT`): "supported ... should be strongly implied by the KNOWLEDGE", reason step by step, answer `[Supported]` or `[Not Supported]`.
5. Count labels (`count_labels`), compute F1@K in `eval/run_eval.py::add_aggregation`.

Config (`eval/safe/config.py`): model `gpt_35_turbo`, temperature 0.1, `max_tokens` 512, `num_searches` 3, `max_steps` 5, `max_retries` 10.

### 1.3 Failure modes visible in code
- **No early stop.** The search loop always spends all five steps unless a query fails to parse; there is no "I have enough evidence" exit.
- **Evidence is snippets only, URLs dropped.** `_parse_snippets` keeps `answerBox`, `knowledgeGraph` and organic `snippet` text; `link` is discarded and `GoogleSearchResult` stores only `query` and concatenated text. A human cannot click through from a verdict to a source, which fails an "explain why" requirement.
- **Silent loss of facts.** In `classify_relevance_and_rate`, a fact whose rating raises three times is simply not appended. `num_claims` can exceed `Supported + Not Supported + Irrelevant`, and the loss biases precision in an unknown direction.
- **Absence is penalised as falsity.** When search returns nothing, the knowledge string is `NO_RESULT_MSG` and the final prompt then tends to yield `Not Supported`: "not found" and "false" are the same label.
- **No contradiction class.** `Not Supported` covers silent evidence and contradicting evidence alike.
- **Domain mismatch in decomposition.** Biography demos used on all topics (`is_bio = True`).
- **Parse-failure defaults** (relevance = relevant; final answer = None then dropped) are decisions made silently by the harness.
- **Irreproducible by construction.** Live Google results change; no result archive is stored with the verdict.
- **README's own agreement numbers are weakest where we need them** (README claim, `eval/README.md`): fact-count correlation with humans Pearson about 0.8; per-label correlation about 0.9 for Supported, **about 0.63 for Not Supported**, **0.3 Pearson / 0.0 Spearman for Irrelevant**. The headline "72% agreement, wins 76% of disagreements" is a README claim on 100 sampled disagreements.

### 1.4 Cost and bounds
Nominal per fact: 1 revise + 1 relevance + 5 query-generation + 1 final = 8 LLM calls and 5 Serper calls. README claim: about 100 Serper credits and $0.10 of GPT-3.5 per response, roughly $0.20, up to $0.40 for long responses. Retry bounds exist but are loose: per outer attempt up to 11 + 11 + 5x11 + 11 = 88 LLM calls, times 3 outer attempts, i.e. 264 per fact on paper; Serper retries up to 20 with exponential sleep capped at 600 s (`_google_serper_api_results`). Parallelism: `concurrent_map(max_workers=25)` in `eval/run_eval.py`. No per-call timeout is set on `requests.post`.

### 1.5 Licence and commit
Code under `common/`, `data_creation/`, `eval/`, `longfact/`, `main/`: Apache-2.0. `third_party/factscore/*`: MIT (Sewon Min). Other materials (LongFact prompts): CC-BY-4.0 per README. Commit `9d27158d198ced0a9d8271a80147cae580614601`, 2024-04-07.

### 1.6 ADOPT / BEAT
ADOPT (definitions we can implement ourselves, no code copied):
- Atomic-fact decomposition followed by a separate self-containment rewrite with the two hard constraints "do not change, do not add a claim" (the `_REVISE_FORMAT` contract). Our own prompts, same contract.
- The relevance filter: a fact counts only if the response relates its subject to the question's subject (the "Foo" definition). Used to exclude padding from the denominator.
- F1@K, because it fixes precision-only metrics that reward short answers: `P = S/(S+N)`, `R = min(S/K,1)`, harmonic mean, 0 when S = 0. We will additionally dedupe facts before counting, which SAFE does not.
- The "one new query that adds information not in KNOWLEDGE" instruction as the template for an optional search-expansion step on uncited claims.

BEAT:
- Keep source URL, retrieval time and a content hash for every snippet used; show them.
- Split `Not Supported` into unsupported and contradicted.
- Surface dropped facts and parse-failure defaults in the trace instead of discarding them.
- Early-stop the search loop when the evidence set already decides the claim.

### 1.7 NOT VERIFIED
That SAFE reaches the agreement it reports; that GPT-3.5 settings transfer to any model we will use; Serper's current API shape and pricing; that LongFact topics resemble our product's domain; whether the `Irrelevant` weakness (0.3 / 0.0) is a labelling artefact or a method flaw.

---

## 2. FActScore (`research/track-2-agent-that-can-explain-why/FActScore`)

### 2.1 What it measures
Factual precision of a biography against a **closed, per-entity corpus**: the Wikipedia page of the topic (default snapshot `enwiki-20230401`). `factscore/factscorer.py::FactScorer.get_score`:

```
per response i:  s_i  = mean over atomic facts of 1[supported]
                 pen_i = 1                    if |A_i| > gamma
                         exp(1 - gamma/|A_i|) otherwise          (gamma = 10)
                 score_i = pen_i * s_i
FActScore = mean over non-abstained responses of score_i
```
Abstained responses (optional detector, `abstain_detection.py`) are excluded from the mean and reported as `respond_ratio`. `num_facts_per_response` is reported as a recall proxy. The length penalty discourages answers with fewer than `gamma` facts; `gamma = 10` "roughly corresponds to 2 sentences" per README.

### 2.2 Algorithm and prompts
1. Decompose: `atomic_facts.py::AtomicFactGenerator` (the SAFE decomposer is a port of this). InstructGPT (`text-davinci-003`, now retired) at `OpenAIModel.temp = 0.7`, 8 demos (7 fixed, 1 BM25-selected), prompt line "Please breakdown the following sentence into independent facts: ...". Output parsed on `"- "` separators.
2. **Deterministic repair of the decomposition**, `postprocess_atomic_facts` with `detect_entities`: merge one-word sentences into the previous one; drop facts ending in a short list of weak verbs (`born.`, `described.`, `known.` ...) when another fact already contains them; run spaCy on the source sentence and on each fact and collect only **dates and numbers** (spaCy labels DATE, TIME, PERCENT, MONEY, QUANTITY, ORDINAL, CARDINAL, kept only if every token is an integer or a month name, plus every `\b\d+\b` integer token; person, organisation and place names are NOT collected). **If a fact introduces a date or integer that is not in the sentence and has no prefix match, the fact is dropped**; if the new value is a prefix of a known one, the full value is substituted; duplicates are removed; if coverage then looks inconsistent the raw facts are kept. This is the only guard in the six repositories against the decomposer inventing content, and it covers numbers and dates only.
3. Retrieve: `retrieval.py::Retrieval.get_passages(topic, atom, k=5)`. Query = `topic + " " + atom`. Passages are the topic page cut into chunks of at most 256 RoBERTa tokens (`DocDB.build_db`). Ranking by GTR-T5-large inner product (`get_gtr_passages`), or BM25 (`get_bm25_passages`). `encoder.cuda()` is hard-coded, so dense retrieval needs a GPU.
4. Verify (`factscorer.py::_get_score`), prompt: `Answer the question about {topic} based on the given context.` + five passages (`Title:`/`Text:`, in reversed rank order) + `Input: {atom} True or False?\nOutput:`. Parsing a hosted-model reply: contains "true"/"false"; if both appear, supported iff `index("true") > index("false")` (the last-mentioned wins); if neither, supported iff none of `not, cannot, unknown, information` appears. For LLaMA the next-token logits for ids 5852 ("True") and 7700 ("False") are compared. Optional NPM check: `is_supported and npm_prob > 0.3` (`npm.py::get_probabilty`, masked-LM token-copy probability over top-3 BM25 passages; RoBERTa on GPU).

### 2.3 Failure modes visible in code
- **Closed-corpus assumption.** A fact true but absent from the one Wikipedia page counts as unsupported. Score is bounded by retrieval recall over a single page.
- **Binary label, no contradiction class.**
- **Verifier temperature 0.7** (`openai_lm.py`) for decomposition and verification; the disk cache (`LM` base class, keyed by prompt) hides run-to-run variance by replaying the first sample.
- **Fragile output parsing**: the "last mentioned wins" rule and the keyword fallback are heuristics that flip on phrasings like "It is not true that ... false".
- **Unbounded retries.** `call_ChatGPT` loops `while not received` with `sleep(2**n)` and no cap or timeout; a permanent error stalls forever. `InvalidRequestError` hard-asserts.
- **Penalty design.** `exp(1 - gamma/|A|)` penalises short answers but a verbose answer of ten true trivia facts gets full marks; there is no relevance filter.
- **Macro mean over responses** gives a 5-fact and a 60-fact answer equal weight, so claim-level precision of long answers is under-weighted (the length penalty only compensates for short answers), and abstention handling depends on a hand-written phrase list.
- **The decomposition guard is numeric only**: `extract_numeric_values` uses `\b\d+\b`, so `3.5` becomes `3` and `5` and `1,000` becomes `1` and `000`; invented names, places and relations pass unchecked.
- Biography-only demos and prompt ("Tell me a bio of <entity>").

### 2.4 Cost and bounds
README claim: about $1 per 100 sentences with ChatGPT. One verifier call per fact, five passages per call (about 5 x 256 tokens context). Dense retrieval needs a GPU; the full Wikipedia DB is 18 GB per README and takes about 8 hours to build. Model argument fixed to five names (`retrieval+llama`, `+npm`, `retrieval+ChatGPT`, `npm`, `retrieval+ChatGPT+npm`); no concurrency control.

### 2.5 Licence and commit
MIT (Copyright 2023 Sewon Min). Commit `f28272deffcf33efc1f1117d5479c10bb75221a9`, 2025-04-13.

### 2.6 ADOPT / BEAT
ADOPT:
- The score definition above including `gamma` penalty and `respond_ratio` as separate reported numbers.
- **The drift guard** from `postprocess_atomic_facts` as our Layer 1 deterministic check: every number and date in an atomic claim must occur in its source sentence (or be a prefix of one that does); otherwise the claim is flagged `decomposition_drift`, not scored. We extend it with proper number parsing and a name check (section 9).
- Per-entity restricted retrieval as an option when the user supplies the entity (smaller search space, fewer false matches).
- The labelled data (Supported / Not-Supported / Irrelevant per atomic fact, about 500 prompt-response pairs, reachable at `research/track-2-agent-that-can-explain-why/long-form-factuality/third_party/factscore/labeled_data`) as a Layer 1/2 calibration set.

BEAT:
- Deterministic settings plus a measured noise floor; spans and offsets instead of whole passages; a contradiction label; a relevance filter; no unbounded retry.

### 2.7 NOT VERIFIED
Human-agreement figures and the README leaderboard (README claim); the 0.99 Pearson between the ChatGPT and LLaMA+NPM estimators (README claim); whether `text-davinci-003` behaviour is reproducible at all; the exact content of the data bundle (we read the code path, not the downloads).

---

## 3. ALCE (`research/track-2-agent-that-can-explain-why/ALCE`)

### 3.1 What it measures
Citation quality of answers with inline citations `[1][2]`, in `eval.py`, with an NLI model (`AUTOAIS_MODEL = google/t5_xxl_true_nli_mixture`, a T5-XXL checkpoint; input `"premise: {docs} hypothesis: {sentence}"`, output `"1"` means entailed). Documents are formatted `"Title: {title}\n{text}"` and joined with newlines.

Unit: sentence (NLTK `sent_tokenize`). **Citation recall** `compute_autoais` (`citation_rec`):

```
for each sentence s with citations C(s) (parsed with regex r"\[\d+", ids are 1-based):
  joint(s) = 0                      if no citation, or any id >= number of docs
           = NLI(concat(C(s)), strip_citations(s))   otherwise       (C truncated to first 3)
recall(response) = mean_s joint(s)             # denominator: ALL sentences
citation_rec = 100 * mean over responses
```

**Citation precision** (`citation_prec`): for a sentence with exactly one citation, or none, `prec_hits += joint`; for a sentence with more than one citation **and** joint entailment, each cited doc `e` counts as relevant if `NLI(e, s) = 1`, or else if `NLI(C(s) \ {e}, s) = 0` (e is needed); if the rest still entail without `e` and `e` alone does not, it is counted as an over-citation. Then:

```
precision(response) = prec_hits / total_citations        # 0 if total_citations == 0
```
`total_citations` is incremented per valid cited doc (after the 3-citation truncation), including citations in sentences that failed joint entailment. A diagnostic prints the share of multi-citation sentences, of those the supported share, and the over-citation share.

Other metrics in the same file: ROUGE-L, `str_em` (short-answer string presence), QA-based accuracy with a RoBERTa-SQuAD reader, MAUVE, `claims_nli` (ELI5: share of gold claims entailed by the answer, an answer-completeness measure), QAMPARI F1.

The human-evaluation files in `human_eval/` define the human protocol the automatic metric imitates: per citation, 2 = fully supports, 1 = partially, 0 = not at all; per sentence, 1 = fully supported by the cited docs, 0 = not.

### 3.2 Algorithm and prompts
Generation prompt (`prompts/asqa_default.json`): "Write an accurate, engaging, and concise answer ... using only the provided search results ... Always cite for any factual claim. ... Cite at least one document and at most three documents in each sentence. If multiple documents support the sentence, only cite a minimum sufficient subset." Doc format `Document [{ID}](Title: {T}): {P}`. Two-shot, temperature 0.5 (`run.py`). `post_hoc_cite.py` adds a citation to every uncited sentence by top-1 retrieval of the sentence against the supplied docs (TF-IDF or GTR). InlineSearch variants exist for models that retrieve while writing.

### 3.3 Failure modes visible in code
- **Output truncated at the first newline** (`data[i]['output'].strip().split("\n")[0]` in `main`; the log line admits it). A multi-paragraph answer is silently scored on its first line only.
- **Sentence-level granularity.** One sentence with three facts and one supporting citation is "entailed" only if the NLI accepts the conjunction; one unsupported sub-claim zeroes the sentence and says nothing about which.
- **Invalid or out-of-range citation ids score 0 for recall but add nothing to precision's denominator**, so fabricated ids are punished in one metric and invisible in the other. Ids written as `[1, 2]` or `[1-3]` are read only up to the first number by `r"\[\d+"` (the rest is ignored).
- **Precision conflates two failures.** Citations inside unsupported sentences stay in the denominator, so unsupported text depresses precision too, and a response with no citations at all gets precision 0 rather than "undefined" (`ais_scores_prec.append(... else 0)`).
- **"Alone sufficient" is rewarded even when redundant**: a doc that entails alone is counted relevant regardless of whether others also do. Only "insufficient alone and removable" is penalised.
- **Citation cap**: `at_most_citations` defaults to 3 and truncates silently.
- **`remove_citations`** deletes every `]`, every `[digit` and every ` |`, which also corrupts legitimate brackets in the sentence.
- **Binary NLI**, no neutral/contradiction split; the model's context length is not managed (no truncation set on the tokenizer call in `_run_nli_autoais`).
- The NLI model is a T5-XXL seq2seq checkpoint; premise and hypothesis are concatenated as raw text, so formatting noise is in the judgement.

### 3.4 Cost and bounds
NLI calls per response: one per cited sentence for recall; for each multi-citation supported sentence up to 2 per cited doc more. Model loaded in bf16 across all visible GPUs with `max_memory = free - 6 GB` (`utils.get_max_memory`), so a large-memory GPU is required. README: building the dense index needs 80 GB GPUs and about 31 GB of disk, and BM25 retrieval over the corpus is "extremely expensive and time-consuming". `max_new_tokens=10` for NLI, 300 for generation.

### 3.5 Licence and commit
MIT (Copyright 2023 Princeton NLP). Commit `246c476a4edfc564266b7346b6e29ef4861ae937`, 2024-10-09.

### 3.6 ADOPT / BEAT
ADOPT (exact definitions, to be re-implemented):
- Citation recall as the share of sentences whose **cited set jointly entails** the sentence.
- Citation precision with the **leave-one-out** logic: a cited doc is relevant iff it entails alone, or removing it breaks entailment of the set. We extend it with explicit `redundant` and `decorative` classes (section 9, Layer 4).
- The 0/1/2 citation-support and 0/1 sentence-support human rubric as our annotation protocol, so our human labels are comparable to ALCE's.
- The generation instruction "cite a minimum sufficient subset", and post-hoc citation as the fallback for uncited sentences, with the result flagged `post_hoc`.
- `claims_nli`-style completeness (share of required claims the answer entails) as the recall counterpart to precision.

BEAT:
- Claim-level, not sentence-level, with offsets of the supporting span.
- Report invalid ids, over-cap citations and uncited sentences as separate counts; define precision as undefined (n/a) when there are no citations, and also give the ALCE-compatible zero.
- Neutral vs contradicted; deterministic span check in front of the NLI.
- Never truncate the answer silently: the unit is the whole response.

### 3.7 NOT VERIFIED
How well AutoAIS agrees with the human labels in `human_eval/` (paper figure, not recomputed); that a small or API-served judge reproduces the T5-XXL checkpoint's decisions; the licences of the underlying ASQA / ELI5 / QAMPARI data; whether the human-eval files contain enough contradicted items to be useful (they do not label contradiction at all).

---

## 4. Self-RAG (`research/track-2-agent-that-can-explain-why/self-rag`)

### 4.1 What it does
A fine-tuned LLaMA-2 (7B/13B) emits **reflection tokens** inline, then a segment-level beam search uses their probabilities to pick among candidate continuations (`retrieval_lm/run_long_form_static.py`, `run_short_form.py`). Token families (`retrieval_lm/utils.py`):
- Retrieve: `[No Retrieval]`, `[Retrieval]`, `[Continue to Use Evidence]`
- IsRel: `[Irrelevant]`, `[Relevant]`
- IsSup: `[Fully supported]`, `[Partially supported]`, `[No support / Contradictory]`
- IsUse: `[Utility:1]` ... `[Utility:5]`

### 4.2 Algorithm and prompts
Segment score for one candidate generated against one retrieved paragraph (`run_step_generation_batch`):

```
s_rel = p([Relevant]) / sum p(IsRel tokens)
s_sup = p([Fully]) / Z + 0.5 * p([Partially]) / Z            Z = sum p(IsSup tokens)
s_use = sum_{i=1..5} w_i * p(Utility:i) / sum p(Utility)      w = [-1, -0.5, 0, 0.5, 1]
score = w_rel*s_rel + w_sup*s_sup + w_use*s_use   (+ exp(mean logprob) if use_seqscore)
```
Defaults `w_rel = w_sup = 1`, `w_use = 0.5`. Adaptive retrieval: retrieve when `p([Retrieval]) / (p([Retrieval]) + p([No Retrieval])) > threshold` (short-form; the long-form variant adds `[Continue to Use Evidence]` to the numerator). Search: for each segment generate one candidate per retrieved paragraph, keep the top `beam_width` (default 2), repeat to `max_depth` (default 2) or `</s>`. `ignore_cont` drops segments tagged `[No support / Contradictory]`.

Where the labels come from: the critic training data are labelled by GPT-class models with the prompts in `data_creation/critic/gpt4_reward/` (`chatgpt_groundness.py`, `chatgpt_relevance.py`, `chatgpt_need_retrieval.py`). The support prompt defines a five-point scale in one template (5 Fully supported "only applicable when the output and part of the evidence are almost identical", 4 Mostly supported ... 1 Ignore / Contradictory) and a three-label template (`multi`, `multi_no_preceding`) that takes optional preceding sentences. "Make sure to not use any external information/knowledge" is an explicit instruction in both.

### 4.3 Failure modes visible in code
- **Bug: utility is never scored in the long-form path.** In `run_long_form_static.py::run_step_generation_batch` the utility loop iterates `grd_tokens.items()` instead of `ut_tokens.items()` (the short-form file iterates `ut_tokens`), so `len(ut_score_dict) == 5` is never true and `utility_score` stays 0.0.
- **CLI weights ignored** in long-form: `main` hard-codes `w_rel=1.0, w_sup=1.0, w_use=0.5` when it calls `call_model_beam_batch`.
- `mode == "no_retrieval"` returns an undefined `prediction_tree` (NameError path).
- The missing-token sentinel `-100` is used as a probability in the IsRel branch (stored without `exp`) but as a log-probability in the IsSup branch (`np.exp(-100)`), so one missing IsRel token corrupts the normalisation while a missing IsSup token does not.
- `[No support / Contradictory]` merges unsupported and contradicted, same as everywhere else.
- Self-reported support is a **learned classifier's token probability**, not a check: nothing verifies the claimed support against the paragraph text.
- The critic's strictness is prompt-defined: "Fully supported" is nearly verbatim; paraphrases fall into "Partially".
- The `postprocess` that builds the final string removes reflection tokens and appends citation indices `[idx]` by segment position, so the citation points at the paragraph used for that segment, not at a verified span.
- Postprocessing string patches (`.replace(".[Continue to Use Evidence]", " [1]. ")`) show the format is brittle.
- `chatgpt_groundness.py::postprocess` picks the highest digit 1-5 found anywhere in the score string, and stores the score in the `explanation` field.

### 4.4 Cost and bounds
Needs a fine-tuned open model and vLLM with `logprobs=32000` (requested in `SamplingParams`): not usable with a hosted chat API. Per segment: about `ndocs` (default 10) generations per expanded node, with 1 root node plus `beam_width` nodes per extra level, so roughly `ndocs x (1 + beam_width x (max_depth - 2))` forward passes per segment. README: 7B training on 8 x A100-40GB; 13B on 4 x A100-80GB; 13B inference may need `--world_size` > 1.

### 4.5 Licence and commit
MIT (Copyright 2023 Akari Asai). Commit `1fcdc420e48f50a7d7ab1ece5494221b93252e99`, 2024-03-19.

### 4.6 ADOPT / BEAT
ADOPT (definitions only; the mechanism needs model weights we cannot use through an API):
- The three-way support taxonomy and its wording: fully / partially / no support, with the explicit rule "do not use outside knowledge, only check support by the evidence".
- The segment-level score `w_rel*s_rel + w_sup*s_sup + w_use*s_use` as a template for ranking candidate answers or candidate evidence items, with `s_sup = p(full) + 0.5 p(partial)`. With a hosted LLM the probabilities are replaced by verdict agreement rates over repeated judge samples (section 9, Layer 2). That substitution is ours and NOT VERIFIED to behave like token probabilities.
- On-demand retrieval as a decision with a threshold, recorded in the trace (the "why" of retrieving or not).
- The critic-prompt structure (instruction, evidence, output, optional preceding sentences) for judging a claim in context.

BEAT:
- A verdict that is not just a probability: it carries the exact supporting span, verified deterministically.
- Separate `contradicted` from `unsupported`.
- No dependence on logprob access.

### 4.7 NOT VERIFIED
Anything about the released checkpoints' behaviour; the paper's benchmark numbers; whether the 5-point to 3-label collapse used in training data matches the 3-label prompt (both prompts exist in the repo; which was used for the released generator data we did not trace); whether the utility bug changes released-model results (the released numbers may have been produced with different code).

---

## 5. ragas (`research/track-2-agent-that-can-explain-why/ragas`)

Two implementations coexist: legacy metrics in `src/ragas/metrics/_*.py` and the newer `src/ragas/metrics/collections/<metric>/`. Where they differ it is stated.

### 5.1 What it measures

**Faithfulness** (`metrics/_faithfulness.py::Faithfulness`, `collections/faithfulness/metric.py`):

```
statements = LLM(answer -> standalone statements, no pronouns)          # StatementGeneratorPrompt
verdicts   = LLM(context, statements -> [{statement, reason, verdict in {0,1}}])   # NLIStatementPrompt
faithfulness = sum(verdict) / len(verdicts)                              # NaN when there are no statements
```
`context = "\n".join(retrieved_contexts)`. Verdict 1 iff "the statement can be directly inferred based on the context". Variant `FaithfulnesswithHHEM` replaces the verdict LLM by a classifier (`vectara/hallucination_evaluation_model`, loaded with `trust_remote_code=True`), batch size 10, predictions rounded.

**ResponseGroundedness** and **ContextRelevance** (`collections/`): two differently worded judge prompts, rating each 0 / 1 / 2 (not / partially / fully); `score = (r1/2 + r2/2) / 2`; empty input returns 0; a NaN from one judge falls back to the other.

**Context precision** (`metrics/_context_precision.py`): per retrieved chunk an LLM verdict v_k in {0,1} "was the context useful in arriving at the answer" (or the reference); Average Precision:

```
AP = ( sum_k  [ v_k * (sum_{j<=k} v_j) / k ] ) / ( sum_k v_k + 1e-10 )
```
**Context recall** (`_context_recall.py`): reference answer split into sentences, each classified "attributed" (1) or not (0) to the contexts; score = attributed / total.

**Noise sensitivity** (`_noise_sensitivity.py`): decompose reference and response into statements; per retrieved chunk compute which reference statements and which response statements it entails; `incorrect_i` = response statement i not entailed by the reference. With a chunk called "relevant" if it entails at least one reference statement:

```
mode "relevant":   score = mean_i [ (some relevant chunk entails statement i) AND incorrect_i ]
mode "irrelevant": score = mean_i [ (some irrelevant chunk entails statement i, none relevant) AND incorrect_i ]
```
This is the nearest thing in the six repositories to our counterfactual layer: it attributes wrong statements to specific retrieved chunks.

**Factual correctness** (`_factual_correctness.py`): claim decomposition with four example banks (atomicity low/high x coverage low/high); NLI of response-claims against the reference (precision side) and reference-claims against the response (recall side); `tp = #response claims supported by reference`, `fp = #response claims unsupported`, `fn = #reference claims NOT supported by response`; `precision = tp/(tp+fp+1e-8)`, `recall = tp/(tp+fn+1e-8)`, F-beta via `metrics/utils.py::fbeta_score`.

**QuotedSpansAlignment** (`metrics/quoted_spans.py` and `collections/quoted_spans/`): extract quoted spans of at least 3 words from the answer; normalise whitespace and case; the metric is the fraction found as substrings of the sources. It is the only deterministic grounding check in the set.

### 5.2 Prompts and steps (file, class)
- `StatementGeneratorPrompt`: "Given a question and an answer, analyze the complexity of each sentence in the answer. Break down each sentence into one or more fully understandable statements. Ensure that no pronouns are used in any statement." One worked example (Einstein).
- `NLIStatementPrompt`: "judge the faithfulness of a series of statements based on a given context ... verdict as 1 if the statement can be directly inferred based on the context or 0 if the statement can not be directly inferred". Two worked examples (John/Computer Science; photosynthesis vs Einstein).
- `ContextPrecisionPrompt`: "verify if the context was useful in arriving at the given answer".
- `ClaimDecompositionPrompt`: "standalone statements ... Each statement should be a standalone claim that can be independently verified", with atomicity/coverage examples.
- Defaults: LLM temperature 0.01 (`llms/base.py`), `max_retries = 1`.

### 5.3 Failure modes visible in code
- **Denominator comes from the LLM output.** `Faithfulness._compute_score` divides by `len(answers.statements)` (the verdicts the model returned), not by the number of statements that were sent. A judge that skips an unfaithful statement raises the score.
- **No attribution.** Contexts are concatenated into one blob; the output is a number, not a span and not a chunk id. Faithfulness cannot say which chunk supports which statement and has no notion of a citation.
- **Binary and "directly inferred".** No neutral/contradicted split; two few-shot examples; strictness is entirely prompt-defined.
- **Statement generator is unchecked**: nothing verifies that the statements follow from the answer (the failure FActScore's entity guard addresses).
- **NaN semantics.** Empty statements return NaN; how aggregation treats NaN across a dataset was not traced.
- **`QuotedSpansAlignment` defects.** (a) The legacy regex character class contains only ASCII quote characters, the backtick and U+00B4 (checked at byte level), although the docstring promises curly quotes; the collections version adds U+201C-U+201F and U+2018/U+2019. (b) In both, the apostrophe is a quote delimiter, so ordinary text such as "the firm's chief said it's ready" can create a three-word "span" and a spurious miss. (c) Sources are joined with a single space and matched as one string, so a span can match across the seam between two unrelated passages (false pass). (d) A span found in any passage passes, so "quote exists but not in the cited source" is invisible. (e) Normalisation is whitespace plus lowercase only: no Unicode normalisation, no dash/quote folding, hence false failures on typographic differences. (f) With no quoted spans the legacy function returns 0.0 and the collections metric returns 1.0 (vacuous truth); the two implementations disagree on the same input.
- **Factual correctness mixes claim sets.** In recall mode `tp` is counted over the response's claims and `fn` over the reference's claims, so `tp/(tp+fn)` is not a recall over one population.
- **Context precision** judges usefulness against the answer, so a wrong answer that leans on a distractor makes the distractor "useful".
- **`trust_remote_code=True`** in the HHEM path executes code from a model repository at load time; treat as a supply-chain risk and do not enable it in our product.

### 5.4 Cost and bounds
Faithfulness: 2 LLM calls per sample (generation + one NLI call over all statements). Noise sensitivity: 2 decompositions + 2 x (#chunks) NLI calls + 1. Factual correctness: up to 4. Response groundedness / context relevance: 2 judge calls (retries up to 5). Concurrency and timeouts are controlled through `RunConfig` (not traced in detail).

### 5.5 Licence and commit
Apache-2.0. Commit `298b68274234c060deacab3cf5fb52aa3a20e885`, authored 2026-02-23. No release tag is present in the shallow clone, so the package version is NOT VERIFIED (it is derived from git tags).

### 5.6 ADOPT / BEAT
ADOPT:
- Faithfulness as a two-stage definition (statements, then per-statement verdict, ratio), **with the denominator fixed to the number of statements sent**; a missing verdict counts as unverified, not as absent.
- The dual-judge 0/1/2 average with two differently worded prompts as a variance reducer in Layer 2.
- Noise sensitivity's relevant / irrelevant split as the template for our distractor-injection test (Layer 4).
- Context precision as Average Precision over ranked evidence, for evaluating our retrieval order when evidence is retrieved rather than supplied.
- The atomicity / coverage vocabulary and its four-way grid to specify and test the decomposer (section 10).
- The quoted-span idea, rebuilt (Layer 0).

BEAT:
- Keep chunk ids and span offsets in every verdict; per-evidence matching rather than a joined blob; typographic normalisation; proper quote pairing; "not applicable" instead of 0.0 or 1.0 when nothing is quoted.

### 5.7 NOT VERIFIED
HHEM's model size, licence and accuracy; the instructor-based LLM wrappers; NaN aggregation; correlation of any ragas metric with human judgement (no figure was checked).

---

## 6. Multiagent debate (`research/track-2-agent-that-can-explain-why/llm_multiagent_debate`)

### 6.1 What it does
Several instances of the same chat model answer a question independently; in each later round every agent is shown the other agents' last answers and asked to produce an updated answer. Tasks: arithmetic (`math/`), GSM8K (`gsm/`), MMLU (`mmlu/`), biographies (`biography/`).

Settings read from code: biographies 3 agents x 2 rounds on the first 40 shuffled names of 524 in `biography/article.json`; GSM 3 x 2 on 100 questions; MMLU 3 x 2; arithmetic 2 agents x 3 rounds on 100 random expressions. Model `gpt-3.5-turbo-0301`, no temperature set, `openai==0.27.6`.

### 6.2 Algorithm and prompts
- Round 0: each agent gets the task prompt alone ("Give a bullet point biography of {} highlighting their contributions and achievements as a computer scientist, with each fact separated with a new line character.").
- Round r >= 1 (`construct_message`): "Here are some bullet point biographies of {} given by other agents: ```...```" for each other agent, then "Using these other biographies of {} as additional advice, what is your updated bullet point biography ...", and in the final round "Closely examine your biography and the biography of other agents and provide an updated bullet point biography." With a single agent: "Closely examine your biography and provide an updated bullet point biography." Each agent keeps its full history, so the prompt grows every round.
- Aggregation: biography has none (each agent's final message is scored separately); arithmetic and MMLU take `most_frequent` over parsed numeric/letter answers; GSM scoring is in `gsm/eval_gsm.py` (not read in detail).
- **Stopping rule: none.** The number of rounds is a constant. The only early exit is in `biography/gen_conversation.py`: after a round, if the last agent's reply parses to a single bullet, break ("the LM just doesn't know this person").
- Biography scoring (`biography/eval_conversation.py`): for each ground-truth bullet and each agent's final text, ask "Is the above biography consistent with the fact below? ... single word answer, yes, no, or uncertain. Carefully check the precise dates and locations"; `parse_yes_no`: contains "uncertain" returns None (dropped), contains "yes" returns True, contains "no" returns False; accuracy = mean over non-None; standard error printed as `std/sqrt(n)` over all pooled judgements. Responses that are one bullet under 400 characters are skipped as refusals.

### 6.3 Failure modes visible in code
- **No evidence.** Debate happens among model samples with no external source, so agreement can be agreement on a shared error. Homogeneous agents (same model, same prompt) make errors correlated; majority vote over correlated samples is weaker than it looks, and with two agents (`math/`) there is no majority at all (`most_frequent` returns the first maximum).
- **No stopping rule** beyond a refusal heuristic; no convergence test; no cost cap besides constants.
- **No measurement of harm.** The scripts report accuracy only; they never count answers that were right before debate and wrong after.
- **The biography "accuracy" is consistency with known ground-truth facts, not precision.** Facts the biography omits tend to come back "uncertain" and are dropped, so omission is not penalised, and statements in the biography that are absent from ground truth are never checked. It measures a different quantity from FActScore.
- **Same-family judge**: generator and judge are both gpt-3.5; self-preference is uncontrolled.
- **Pseudo-replication**: the reported standard error treats pooled judgements across agents and people as independent.
- **Parser bugs**: substring tests `"no" in s` match "unknown", "not", "none"; `"yes"` matches inside other words; `parse_answer` returns the last token that parses as a float anywhere in the reply.
- **Not runnable as shipped**: an absolute dataset path from the authors' cluster in `gsm/gen_gsm.py`; `pdb.set_trace()` at the end of generation scripts; bare `except:` with one retry then a crash; the pinned model is retired.

### 6.4 Cost and bounds
Calls = agents x rounds per item: biographies 6 per person (240 for 40 people); arithmetic 6 per item; GSM 6 per item; context length grows with each round because other agents' full text is appended. No token budget, no timeout, no concurrency control.

### 6.5 Licence and commit
**No LICENSE file in the clone and none mentioned in the README** (checked with a recursive search). Treat as all rights reserved: we implement the published protocol from its description in the README and the structure above, and copy no code. The GitHub-side licence is NOT VERIFIED. Commit `9846749350eb917ae5bfaaff4c645fc705b8d3af`, 2025-04-24. The README calls the code "a preliminary implementation".

### 6.6 ADOPT / BEAT
ADOPT:
- The communication pattern: each participant sees the others' previous output and revises (`construct_message`), with a "closely examine your own answer" fallback for the single-agent case.
- Fixed small defaults as an ablation baseline: 3 agents x 2 rounds (text tasks), 2 x 3 (arithmetic).
- Treat "model doesn't know" (single short reply) as an abstain signal rather than forcing a debate.

BEAT (all of it is ours to design, section 9 Layer 3):
- Asymmetric roles (advocate / skeptic / arbiter) instead of three identical peers.
- Every argument must quote evidence spans; spans failing the deterministic check (Layer 0) are struck before the arbiter reads them.
- An explicit stopping rule (stability of verdict and span set, hard round cap, token budget) and a terminal `contested` label instead of a forced vote.
- Measured harm: report how often debate turns a correct verdict into a wrong one.
- A judge from a different model family than the generator where available.

### 6.7 NOT VERIFIED
The paper's reported gains (paper not downloaded); that debate helps on evidence-grounded verification at all (the repository tests closed-book tasks); the repository's licence on GitHub.


---

## 7. Side by side

| | Unit judged | Evidence the judge sees | Labels | Contradiction class | Deterministic check | Judge randomness | Provenance kept |
|---|---|---|---|---|---|---|---|
| SAFE | atomic fact | up to 5 live Google queries, 3 results each, snippets only | Supported / Not Supported / Irrelevant | no | none | temperature 0.1 | query text only; URLs dropped |
| FActScore | atomic fact | top 5 chunks of the topic's Wikipedia page | True / False (binary) | no | date and integer guard on decomposition | temperature 0.7, replayed from cache | passages, not spans |
| ALCE | sentence | the documents the sentence cites (max 3) | entailed 0/1 (T5-XXL NLI) | no | citation id format and range | greedy call; checkpoint config NOT VERIFIED | citation ids |
| Self-RAG | output segment | one retrieved paragraph | fully / partially / no support or contradictory | merged | none | token probabilities from a fine-tuned model | paragraph |
| ragas | statement | all contexts joined | 0/1, or 0/1/2 averaged over two judges | no | quoted-span substring (flawed) | temperature 0.01 | none |
| Debate | whole answer | none (ground-truth facts only at evaluation) | yes / no / uncertain | n/a | none | default sampling | n/a |

---

## 8. Cross-cutting weaknesses (what the field does not do)

1. **Nobody measures contradiction detection.** Every label set merges silence and opposition, and none of the labelled data in these repositories (FActScore labels, ALCE human files) marks a contradiction. Any contradiction-recall claim has to be earned on data we build.
2. **Factuality and attribution are different questions.** SAFE and FActScore ask whether a claim is true against a corpus they choose; ALCE asks whether the cited text entails it. A true claim with the wrong citation is a pass for the first two and a fail for the third. For "explain why", the second is the product; the first is optional.
3. **Absence of retrieval is scored as falsity.** SAFE, FActScore and ragas all return "unsupported" when the retriever misses. Retrieval-limited failures must be reported separately (`not_found_in_retrieved`).
4. **Uncontrolled judge noise.** Temperatures of 0.01 to 0.7, caches that replay the first sample, no repeated-run noise floor, no confidence intervals that respect that claims within one response are not independent (the debate evaluation divides by the square root of pooled judgements).
5. **No test that the judge actually used the evidence.** Nobody removes the evidence and checks that "supported" disappears. A judge that answers from its own knowledge looks identical to a grounded one.
6. **Decomposition is trusted.** Only FActScore post-checks it, and only for dates and integers. SAFE's own README reports fact-count correlation with humans of roughly 0.8, so the denominator of every claim-level precision moves with the decomposer.
7. **Sentence-level citation (ALCE) hides which sub-claim failed; claim-level metrics (SAFE, FActScore) lose the citation link.** Neither gives a claim-level verdict tied to a span.
8. **Silent defaults.** Relevance defaults to "relevant" on parse failure (SAFE), facts that fail three times vanish (SAFE), output is cut at the first newline (ALCE), invalid citation ids vanish from precision (ALCE), dropped verdicts shrink the denominator (ragas). Each is a decision the harness made for the user without reporting it.
9. **Self-judging.** The debate repository judges gpt-3.5 outputs with gpt-3.5; none of the others measure self-preference.
10. **Domain.** Evidence comes from Wikipedia biographies, ASQA / ELI5 passages and general web snippets. Our domain is undecided (`docs/open-questions.md`, Q1), so any transfer is NOT VERIFIED.

---

## 9. Our verification stack

A proposal. None of it is built or measured; every claim of benefit below is a hypothesis that section 10 defines the test for. The stack is provider-agnostic: the LLM sits behind a `Judge` interface because the model stack is undecided (`docs/open-questions.md`, Q4), and sponsor APIs are not assumed.

### 9.0 Shared types and rules (TypeScript)

```ts
interface EvidenceItem {
  id: string;                 // stable within a run
  sourceUri: string;
  text: string;               // the exact string given to every judge
  sha256: string;             // hex of SHA-256 over UTF-8(NFC(text)), set at retrieval time
  docSha256?: string;         // hash of the parent document, with chunkStart/chunkEnd offsets
  retrievedAt: string;        // ISO 8601
}

interface Citation { evidenceId: string; sha256: string; quote?: string }   // sha256 is what the author saw

type ClaimKind = 'factual' | 'numeric' | 'quote' | 'opinion' | 'meta';

interface Claim {
  id: string;
  text: string;                       // self-contained
  parentSentenceId: string;
  parentSpan: [number, number];       // offsets in the answer
  kind: ClaimKind;
  checkWorthy: boolean;
  citations: Citation[];              // inherited from the sentence unless narrowed
  decomposer: string;                 // 'llm-v1' | 'sentence-fallback'
}

type Label =
  | 'entailed' | 'partial' | 'unsupported' | 'contradicted'
  | 'unattributed'        // no citation on a check-worthy claim
  | 'invalid_citation'    // id unknown or hash mismatch
  | 'fabricated_quote'    // Layer 0 fail
  | 'contested';          // Layer 3 did not converge

interface Span { evidenceId: string; start: number; end: number; text: string }  // text === evidence.text.slice(start, end), re-checked

interface Verdict {
  label: Label;
  supporting: Span[];                 // verified by Layer 0 before the label is accepted
  contrary: Span[];
  layers: Array<{ layer: 0|1|2|3|4; judge: string; decision: string; why: string }>;
  confidence: 'high' | 'medium' | 'low';   // rule-derived (9.6), not a calibrated probability
}

interface Judge {
  judge(claim: string, evidence: EvidenceItem[], opts: { prompt: string; seed?: number; timeoutMs: number }):
    Promise<{ label: 'entailed' | 'partial' | 'neutral' | 'contradicted'; spans: Span[]; raw: string }>;
}
```

Rules that apply everywhere: temperature 0 (or the provider's closest equivalent) for every judge call; per-call timeout and at most 2 retries, enforced in code; every call cached by `hash(claim, evidence hashes, prompt version, model id, params)`; a JSONL trace line per decision with the reason (`{runId, layer, claimId, inputHash, decision, why, model, ms, tokens}`); no verdict is dropped silently, a failure produces an explicit `unknown` state with the error class.

### 9.1 Layer 0: deterministic checks (no model, offline)

Inputs: answer text, claims with citations, the `EvidenceItem` store.
Outputs: per citation `{hashOk, quoteChecks[], numericChecks[], l0: 'pass' | 'fail' | 'n/a'}`; per answer `selfInconsistencies[]`.
Follows: ragas `QuotedSpansAlignment` (idea), FActScore `postprocess_atomic_facts` and `detect_entities` (date / integer guard, extended), ALCE citation id range check.

0a. Quote-in-source.
- Prefer structured citations from our own generator (`{evidenceId, quote}` objects) so no extraction is needed. For third-party text, extract quotes by paired quotation marks (straight, curly, low-9, guillemets); treat a single quote as a delimiter only when the opener follows whitespace or an opening bracket and the closer precedes whitespace or punctuation, with at least 3 words (this fixes the apostrophe defect in ragas).
- Normalise both sides with `N(x)`: Unicode NFKC, curly to straight quotes, all dash variants to `-`, ellipsis character to `...`, remove soft hyphens and zero-width characters, collapse whitespace, optional casefold. Keep an index map from normalised to raw positions so the UI can highlight raw text.
- Match **per cited evidence item**, never against a joined blob. Statuses: `exact` (raw substring), `normalised`, `ellipsis_ordered` (fragments around `...` or `[...]` all found in order inside one item), `near` (token LCS ratio >= 0.9 or normalised edit distance <= 5%; reported as a warning, not a pass), `misattributed` (found in another evidence item but not the cited one), `absent`.
- A quote with status `absent` or `misattributed` yields `fabricated_quote` immediately, without a model call (the sub-reason, `absent` or `misattributed`, is kept in the trace).

0b. Source-chunk hash.
- `sha256 = SHA-256(UTF-8(NFC(text)))` computed when the chunk enters the store (Web Crypto `crypto.subtle.digest` or `node:crypto`). The hash the author saw is carried in the citation; Layer 0 recomputes and compares before every judge call. Mismatch gives `invalid_citation` (the evidence changed between generation and verification). A parent-document hash plus chunk offsets makes a chunk re-derivable.
- What it proves: the text judged is the text cited and the run can be replayed. What it does not prove: that the text is true or that it supports the claim.

0c. Numeric and date consistency.
- Extract from claim and cited evidence: numbers (thousands separators, decimals, both `1.234,5` and `1,234.5` readings kept when ambiguous, percentages, currency, scale words such as k / million / billion, and locale scales such as lakh / crore when configured, units, ranges), and dates (ISO 8601, `14 March 1879`, `March 14, 1879`, numeric day-month forms with both readings kept, month-year, year). Relative dates are resolved only against an explicit `asOf` date, otherwise `unresolvable` (never guessed). FActScore's integer-only regex `\b\d+\b` splits `3.5` into `3` and `5` and `1,000` into `1` and `000`; we do not reuse it.
- Compare at the coarser of the two precisions (a claim of "about 1.2 million" matches 1,234,567 within half a unit of the stated precision).
- Statuses: `match`; `absent` (claim value not present in cited evidence); `conflict_candidate` (same unit, at least two shared content tokens within 8 tokens of the number on both sides, different value beyond tolerance, and the claim value occurs nowhere in the evidence); `derived_candidate` (claim value equals a sum, difference, ratio or percent change of two evidence values of the same unit within tolerance); `n/a`.
- A numeric status is a hint passed to Layer 2, never a verdict by itself: `absent` is not wrong (the number may be derived), and a `conflict_candidate` may be about a different quantity.
- Within-answer consistency: the same `(entity key, unit)` stated with two different values in one answer sets `self_inconsistent`, a contradiction detected without any evidence.

0d. Decomposition drift guard (used by Layer 1): every number and date in an atomic claim must occur in its parent sentence (FActScore's rule, with proper number parsing), and so must every capitalised entity string (casefolded exact match; alias handling is a known gap, so a miss is a flag for Layer 1 step 6, not a rejection).

Bounds: linear in text length; no I/O; runs in SAMPLE_MODE and offline.

### 9.2 Layer 1: atomic-claim decomposition

Inputs: answer, sentence segmentation, optional question.
Outputs: `Claim[]` with `kind`, `checkWorthy`, `selfContained`, parent span, inherited citations.
Follows: FActScore / SAFE decomposition prompt contract (one independent fact per line, demonstrations, deterministic repair), SAFE `revise_fact` self-containment contract and `check_relevance` relevance definition, ragas atomicity / coverage vocabulary for testing.

Steps:
1. Segment into sentences. `Intl.Segmenter` (granularity `sentence`) with an abbreviation and initials guard analogous to FActScore's `fix_sentence_splitter` (`[A-Z]\. ?[A-Z]\.`). Whether `Intl.Segmenter` handles our abbreviations is NOT VERIFIED; the guard list is calibrated on the gold set.
2. Skip non-factual boilerplate (greetings, "Here are ...", sign-offs) as `meta`, as FActScore and SAFE do for their first and last sentence.
3. LLM decomposition per sentence into atomic facts (our own prompt, same contract; a few demonstrations, at least one retrieved by lexical similarity as in FActScore).
4. Self-containment rewrite under SAFE's two constraints: replace pronouns, unknown entities and non-full names with the entity from the answer; **must not change or add a claim**. Fusing steps 3 and 4 into one call is a cost option that must be tested against the two-call version.
5. Relevance filter: keep a claim for headline metrics only if the answer relates its subject to the question's subject (the SAFE definition). On parse failure the claim is marked `relevance: unknown` and **kept**, with the reason in the trace (SAFE's silent default is not copied).
6. Drift guard (0d) plus a second check: an LLM or lexical entailment from the parent sentence (and its neighbours) to each atom; failing atoms are flagged `decomposition_drift` and excluded from scoring but listed.
7. Coverage check: every number, date and capitalised entity of the sentence must occur in at least one atom, else `coverage_gap` is recorded.
8. Dedupe atoms (normalised text equality, then embedding or lexical similarity above a threshold, to be tuned) before counting; SAFE's F1@K assumes this and does not do it.
9. Fallback when no model is available: `decomposer: 'sentence-fallback'` (sentence is the claim). Results carry that label and are never mixed with model-decomposed results in reported metrics.

Limits: decomposition count differs from human counts (SAFE README: correlation about 0.8); therefore claim-level metrics are always reported together with sentence-level metrics that do not depend on the decomposer (section 10).

### 9.3 Layer 2: entailment judgement

Inputs: a claim, its cited evidence set (never the whole corpus), Layer 0 hints.
Outputs: `{label: entailed | partial | neutral | contradicted, spans[], judge, agreement}` per claim; per cited item `S(e)` (entails alone) as needed by Layer 4.
Follows: ALCE for the question asked (does the **cited set** entail the claim, joint premise), SAFE's "strongly implied, need not be explicit" wording versus ragas' "directly inferred" as the two strictness poles to compare, Self-RAG for the fully / partial / none ladder and the "no outside knowledge" rule, ragas for the dual-judge average.

2a. LLM judge.
- Two differently worded prompts (dual judge, as in ragas `ResponseGroundedness`), temperature 0, same evidence. Required output: label plus **the verbatim span(s) of evidence that decide it**, or a statement of which element of the claim has no support. Each span is re-checked by Layer 0 (`exact`/`normalised`); a verdict `entailed` or `partial` without at least one verified span becomes `unverified_rationale` and goes to Layer 3 once. This span gate is our addition: it is meant to stop a judge from answering out of prior knowledge, and its benefit is NOT VERIFIED (ablation in section 10.6).
- Label definitions given to the judge: `entailed` (all parts of the claim are stated or follow by simple inference from the evidence); `partial` (some parts supported, a named part not discussed); `neutral` (evidence silent on the claim); `contradicted` (evidence states something incompatible; the contrary span is required). Splitting `neutral` from `contradicted` is the change that makes contradiction recall measurable.
- Agreement: both judges identical gives that label with `agreement = 1`; otherwise route to Layer 3. Optional third sample at temperature > 0 to estimate stability; never used to average away a disagreement.
- Different model family from the answer generator when two are available (self-preference is uncontrolled in every repository).

2b. Cheap offline fallback (also used as a pre-filter to save calls).
No repository ships an offline entailment fallback usable from TypeScript. Candidates and what we know:
- Lexical gate (ours, design below). Works in the browser or Node without a model.
- A small NLI cross-encoder run in-process (for example through an ONNX runtime). Candidate model, licence, size, and accuracy are all NOT VERIFIED; it enters only if it beats the lexical gate on the gold sets in section 10.
- ragas `FaithfulnesswithHHEM` and FActScore's `npm` need Python, a GPU or a model download and (for HHEM) `trust_remote_code`; not adopted.

Lexical gate, concretely. Tokens: NFKC, lowercase, split, drop stopwords, light stemming. For claim `c` with content set `T(c)` and each window `W` of 1 to 3 consecutive sentences of the cited evidence:

```
idf(t)   = ln(1 + (N - n_t + 0.5) / (n_t + 0.5))          # BM25 idf over the evidence store
cov(c,W) = sum_{t in T(c) intersect T(W)} idf(t)  /  sum_{t in T(c)} idf(t)
best(c)  = max_W cov(c,W)
gates    = all claim numbers/dates found in W (0c)  AND  all capitalised entity strings found in W  AND  negation parity equal in W and c
```
Decision: `lexical_supported` if `best >= tau_hi` and gates pass; `lexical_unsupported` if `best < tau_lo`; `lexical_conflict_candidate` if `best >= tau_lo` and a number/date gate fails or negation parity differs; otherwise `uncertain`. `tau_hi` is set on the dev split so that precision of `lexical_supported` is at least 0.95 and `tau_lo` so that recall of true-unsupported is at least 0.95; if those targets cannot be met the gate abstains more, it is never loosened. Output is always labelled `judge: lexical`, `confidence: low`, and is reported separately from LLM-judged results.

Known blind spots of the lexical gate, stated so they are tested rather than discovered: role reversal ("A acquired B" versus "B acquired A"), paraphrase with no shared content words, quantifier changes ("some" versus "all"), scope of negation, coreference across sentences, and implicit arithmetic. It can short-circuit extractive claims and flag obvious absences; it cannot be the headline judge.

Bounds: 2 LLM calls per claim (cache hits free); the lexical gate is free. At most 3 citations are judged jointly (ALCE's default cap); further citations are flagged `over_cap` and reported, not silently truncated.

### 9.4 Layer 3: adversarial critic / debate with a stopping rule

Inputs: claims routed from Layer 2 when (a) the two judges disagree, (b) `unverified_rationale`, (c) lexical and LLM disagree, (d) label is `partial`, (e) the claim is in a configured high-stakes class (numbers, legal, medical, financial).
Outputs: final label or `contested`, with the surviving spans of both sides and the round count.
Follows: Du et al. for the revise-after-seeing-others pattern and the fixed baseline (3 agents x 2 rounds); `docs/design/agent-pairings.md` pairing 2 (proposer + critic, one fix, one revision) for the "one fix, one revision" discipline. Departs from Du et al. in every other respect.

Roles and protocol:
- **Advocate** argues the claim is entailed by the cited evidence; **Skeptic** argues it is not (missing element) or is contradicted; **Arbiter** (separate prompt, preferably another model) reads the claim, the evidence, and both briefs and returns a label. Each brief is a short list of `(assertion, span)` pairs.
- Every span is checked by Layer 0 before the Arbiter sees it. Spans that fail are struck and the strike is shown to the Arbiter ("advocate cited text that is not in the source"). A side whose entire brief is struck loses the round.
- Round r >= 2: each side sees the other's surviving brief and may revise once (Du et al.'s construct-message pattern, with evidence attached).

Stopping rule (all enforced in code):
1. Stop at round r if `label_r == label_{r-1}` **and** the set of surviving spans is unchanged (stability). Minimum 2 rounds unless rule 2 fires in round 1.
2. Stop at once if one side's brief is fully struck.
3. Hard cap `R_max = 3` rounds and a token budget per claim.
4. On cap without stability: label `contested`. No forced majority vote.

Cost: at most `3 roles x R_max = 9` calls per routed claim. Expected extra calls per claim `= 9 p`, where `p` is the routed fraction; `p` is NOT VERIFIED and must be measured. Du et al. report debate helps closed-book tasks (paper claim, NOT VERIFIED here); whether it helps evidence-grounded verification is exactly what the ablation in 10.6 tests, including its harmful-flip rate.

### 9.5 Layer 4: counterfactual sensitivity

Inputs: claims with a final label of `entailed` or `partial` and their cited set `C` (|C| <= 3).
Outputs: per claim a necessity table and flags; per cited item a class.
Follows: ALCE's leave-one-out precision logic (extended), ragas `NoiseSensitivity` (distractor injection, relevant / irrelevant split).

For a claim `c` and evidence set `X`, let `v(c, X)` be the Layer 2 label (cached; same prompts, temperature 0). Compute:
- `v(c, C)` (baseline), `v(c, {e})` for each `e in C`, `v(c, C \ {e})` for each `e in C`, `v(c, empty)`, and `v(c, C + D)` where `D` is k = 3 unrelated chunks sampled from other claims' evidence.
- Class of each cited item `e`:
  - `critical`: `v(c, C)` = entailed, `v(c, C \ {e})` != entailed, and `v(c, {e})` = entailed (it alone carries the claim).
  - `complementary`: needed jointly: `v(c, C \ {e})` != entailed and `v(c, {e})` != entailed.
  - `redundant`: `v(c, {e})` = entailed and `v(c, C \ {e})` = entailed (corroboration).
  - `decorative`: `v(c, {e})` != entailed and `v(c, C \ {e})` = entailed (ALCE's "over-citation").
  - `harmful` (a flag in addition to the four classes above): `v(c, C \ {e})` is more favourable than `v(c, C)`, for example removing `e` turns `partial` into `entailed`; `e` conflicts with the rest of the evidence. If Layer 4 is also run on `contested` claims, the same test applies to them.
- Claim flags: `ungrounded_entailment` if `v(c, empty)` = entailed (the judge says yes with no evidence, so its verdict cannot be trusted as evidence-based); `distractor_sensitive` if `v(c, C + D)` != `v(c, C)`.

Noise control (non-optional): a flip counts only if it reproduces in 3 independent runs on both sides of the comparison; otherwise it is recorded as `judge_unstable`, not as evidence sensitivity. The noise floor (fraction of identical inputs whose label changes between runs) is reported with every Layer 4 number.

Cost: up to `|C| + |C| + 2` extra judge calls per claim (about 8 for |C| = 3), cached; run the lexical gate first and call the LLM only where it abstains. Applied to claims that will be displayed as headline evidence, then widened.

### 9.6 Orchestration, final label, confidence, offline mode

Order and fail-fast: L1 -> L0 -> (fatal L0 failures end the claim) -> L2 -> L3 if routed -> L4. Final label precedence: `invalid_citation` > `fabricated_quote` > `unattributed` (check-worthy claim with no citation) > L3 outcome > L2 agreed label. `entailed` requires a Layer-0-verified supporting span.

`confidence` is derived by rule, not by asking a model:
- `high`: L0 pass, both judges agree, a verified span exists, L4 shows no `ungrounded_entailment` and no `judge_unstable`.
- `medium`: L3 resolved with stable verdict, or L4 flags a single issue.
- `low`: lexical-only, `contested`, `ungrounded_entailment`, or `sentence-fallback` decomposition.
It is an ordinal tag, not a probability. Calibration (reliability diagram on the gold sets) is a precondition for ever showing it as a number.

Explanation output (the "why"): rendered from verified fields only: label, the supporting and contrary spans with offsets and hashes, the necessity table, the layers that acted and their reasons. Free-text rationale from a judge is shown only when every span it quotes passed Layer 0.

Offline / SAMPLE_MODE: Layer 0 and the lexical gate run with no network; Layer 1 uses `sentence-fallback`; Layer 4 uses the lexical judge. Outputs are tagged `grade: offline` and excluded from headline LLM-grade metrics. SAMPLE_MODE must still compute from real inputs; no verdict is hard-coded.

Bounds in code (initial values, to be tuned): claims per answer capped (extra claims reported as `not_checked`), 3 citations per claim, `R_max = 3`, per-call timeout, at most 2 retries, a per-run token and wall-clock budget; hitting a budget yields an explicit `budget_exhausted` state, not a guess.

---

## 10. Evaluation: what we will report, with exact formulas

### 10.1 Notation
Response `r` has sentences `S_r` (fixed segmenter) and check-worthy sentences `S_r^cw`. `C(s)` is the ordered, deduplicated list of valid cited evidence ids of sentence `s`, truncated to 3 (the truncation is reported as `over_cap`). `v(s, X)` in {entailed, partial, neutral, contradicted} is the final pipeline label of `s` against evidence set `X`, with `ent(s, X) = 1` iff `v = entailed`. `A_r` is the deduplicated set of check-worthy atomic claims of `r`, each with final label `y(c)`.

### 10.2 Citation recall (follows ALCE `citation_rec`)
```
CR_alce(r) = | { s in S_r : C(s) != empty and ent(s, C(s)) = 1 } | / | S_r |
CR_cw(r)   = same, over S_r^cw
CR_claim(r)= | { c in A_r : y(c) = entailed } | / | A_r |            # strict; also CR_claim_lenient with partial
headline   = mean over responses (macro); micro = sum of numerators / sum of denominators
```
`CR_alce` is comparable to ALCE; `CR_cw` and `CR_claim` are ours.

### 10.3 Citation precision (follows ALCE `citation_prec`, extended)
Per cited item, `rel(s, e) = 1` iff `ent(s, C(s)) = 1` and either `|C(s)| = 1`, or `ent(s, {e}) = 1`, or `ent(s, C(s) \ {e}) = 0`; otherwise 0 (including every cite inside a sentence that failed joint entailment).
```
CP(r) = sum_s sum_{e in C(s)} rel(s, e)  /  sum_s |C(s)|           # n/a if the denominator is 0
CP_alce(r) = CP(r) with n/a reported as 0                            # only for comparison with ALCE
CP_cond(r) = same, summing only over sentences with ent(s, C(s)) = 1 # precision given the sentence is supported
decorative_rate = |{(s,e): ent(s,{e})=0 and ent(s, C(s)\{e})=1}| / sum_s |C(s)|
redundant_rate  = |{(s,e): ent(s,{e})=1 and ent(s, C(s)\{e})=1}| / sum_s |C(s)|
```
Also reported: `uncited_rate = |{s in S_r^cw : C(s) = empty}| / |S_r^cw|` and `invalid_rate = |{ids not in store or hash mismatch}| / sum |cited ids|`, because ALCE hides both.

### 10.4 Unsupported-claim rate
```
UCR_strict(r)  = | { c in A_r : y(c) != entailed } | / | A_r |
UCR_lenient(r) = | { c in A_r : y(c) in {unsupported, contradicted, unattributed, invalid_citation, fabricated_quote} } | / | A_r |
partial_rate, contested_rate = shares of y = partial, y = contested               # shown, never folded away
```
Comparison bridges: SAFE precision `S/(S+N)` equals `1 - UCR_lenient` when no claim is partial or contested and Irrelevant claims are excluded from `A_r`; FActScore without penalty is the response-level supported share, and with penalty `pen = 1` if `|A| > gamma` else `exp(1 - gamma/|A|)`, `gamma = 10`. F1@K (SAFE) is reported when the task defines `K`: `P = S/(S+N)`, `R = min(S/K, 1)`, `F1@K = 2PR/(P+R)`, 0 if `S = 0`, after deduplication. `UCR` here is attribution against the cited evidence only; a factuality variant against open-web search is a separate, labelled metric.

### 10.5 Contradiction-detection recall
Gold set `G` of `(claim, evidence set, gold label)` with gold label in {entailed, partial, neutral, contradicted}; `G_contra`, `G_ent`, `G_neu` are the subsets by gold label.
```
CDR      = | { g in G_contra : y(g) = contradicted } | / | G_contra |
CDR_any  = | { g in G_contra : y(g) not in {entailed, partial} } | / | G_contra |
FCR_ent  = | { g in G_ent   : y(g) = contradicted } | / | G_ent |      # false contradiction on entailed items
FCR_neu  = | { g in G_neu   : y(g) = contradicted } | / | G_neu |
```
`CDR` is never reported without `FCR_ent` and `FCR_neu` (flagging everything gives CDR = 1). Breakdowns: by perturbation type, and by the layer that first emitted the label (0c numeric, 2, 3), so we can say what each layer contributes.

Building `G` (no existing data labels contradiction): (a) controlled edits of entailed pairs (entity swap, number or date shift, unit change, negation flip, role reversal, quantifier change, antonym), each verified by two annotators that the evidence genuinely contradicts the edited claim and not merely fails to support it (target Cohen's kappa >= 0.8, disagreements adjudicated); (b) natural conflicts, such as a source and its later correction or two sources that disagree; (c) neutral controls where the edit adds an unsupported but not opposed fact. Synthetic edits are easier than natural contradictions, so (a) alone is never reported as the headline; transfer from (a) to (b) is NOT VERIFIED until measured.

### 10.6 Supporting measurements that decide whether the layers earn their place
- Judge versus human: macro-F1 and Cohen's kappa over the four classes, confusion matrix, on the two public labelled sets below plus our own.
- Quote fabrication detection: recall on seeded fabricated and misattributed quotes (expected near 1 by construction) and false-fail rate on real quotes with typographic differences (the number that matters).
- Decomposition: atomicity error rate (atoms containing more than one independently checkable fact), coverage (share of gold facts present in at least one atom), drift rate (atoms not entailed by their parent sentence), and agreement of fact counts with humans (SAFE README reports about 0.8 correlation for its own decomposer).
- Ungrounded-entailment rate: `UER = | {c : ent(c, C(c)) = 1 and ent(c, empty) = 1} | / | {c : ent(c, C(c)) = 1} |`.
- Distractor sensitivity: share of entailed claims whose label changes when 3 unrelated chunks are added.
- Judge noise floor: share of identical inputs whose label changes across 3 runs.
- Debate: routed fraction `p`, mean rounds, cost, benefit flips `BF = |{routed c: y_L2 wrong, y_final right}|`, harmful flips `HF = |{routed c: y_L2 right, y_final wrong}|`, net `BF - HF`, contested share.
- Ablations on the same gold: L2 alone; L2 with span gate; L2 + symmetric Du-style debate; L2 + our asymmetric evidence-anchored debate; with and without Layer 4 gating.
- Baselines we must beat to claim anything: ragas-style faithfulness (one NLI call over joined context, denominator fixed), ALCE-style per-sentence joint entailment with the same LLM, and SAFE without search. A claim that the stack is better is permitted only where its confidence interval separates from every baseline on the same gold set; otherwise we state what is better, what is not, and what is unmeasured.

### 10.7 Gold data and calibration
- FActScore human labels (Supported / Not Supported / Irrelevant per atomic fact, about 500 prompt-response pairs) in `research/track-2-agent-that-can-explain-why/long-form-factuality/third_party/factscore/labeled_data` (MIT): Layer 1 and Layer 2 calibration, biography domain.
- ALCE human evaluation (`research/track-2-agent-that-can-explain-why/ALCE/human_eval/`, MIT): per-citation 0/1/2 and per-sentence 0/1 labels for citation precision and recall calibration. Licences of the underlying ASQA / ELI5 text are NOT VERIFIED.
- LongFact prompts (CC-BY-4.0 per README) for generating long answers to check.
- Our own domain set once the use case is chosen (`docs/open-questions.md`, Q1), plus the contradiction set from 10.5.

### 10.8 Reporting rules
- Confidence intervals: cluster bootstrap over **responses** (at least 1,000 resamples) for every aggregate computed from claims, because claims in one response are not independent; Wilson interval for proportions over independent gold items. Never a standard error over pooled claims.
- Sample size: to estimate a recall near 0.8 within +-0.05 at 95% confidence needs about `1.96^2 x 0.8 x 0.2 / 0.05^2 = 246` positives; within +-0.10 about 62. So a contradiction gold set below roughly 250 items supports only a wide interval, and the report says so.
- Each quality-sensitive number is produced from 3 full runs; the report gives the worst and the mean.
- Every report lists the surfaces and cases covered and those not covered, the judge and decomposer versions, and the share of claims in each `grade` (LLM versus offline).

---

## 11. What is NOT VERIFIED, and what is undecided

- Not run or checked: none of the six codebases was executed; no paper or model card was read; every README figure (SAFE agreement and correlations, FActScore leaderboard and 0.99 estimator correlation, ALCE and Self-RAG benchmark results, Du et al. gains) is unconfirmed by us.
- Not established: that the span-gated judge reduces prior-knowledge leakage; that asymmetric evidence-anchored debate beats a single dual-judge pass; that Layer 4 flips exceed judge noise; that the lexical gate reaches the 0.95 targets; that `Intl.Segmenter` and our abbreviation guard segment adequately; that any small in-process NLI model is good enough; domain transfer from Wikipedia / ASQA / web snippets to the product domain.
- Undecided and not ours to decide silently: use case and domain (Q1), model and provider stack (Q4), whether the answer generator is ours (structured citations, which makes Layer 0a exact) or third-party text (inline quote extraction).
- Repository facts to re-check if relied on: licence of `llm_multiagent_debate` on its GitHub page (no file in the clone); ragas package version (no tag in the shallow clone); the generation config of the ALCE NLI checkpoint.
- Licence handling: SAFE, ALCE, FActScore, Self-RAG, ragas permit reuse of ideas and, under their licences, code; this document specifies definitions to re-implement and copies no code. The debate repository's absent licence means no code or prompt text is to be copied from it.
