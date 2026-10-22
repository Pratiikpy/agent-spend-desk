# Profile: EleutherAI/lm-evaluation-harness

Reader: agy (Gemini), 2026-10-20 (prepared for ). Licence read first: MIT (`LICENSE.md:1-21`). Stars: 14,278 (`gh api repos/EleutherAI/lm-evaluation-harness`, 2026-10-20); pushed_at: `2026-09-14T10:51:06Z`; HEAD commit `d6de81643928d653435c431bae19945d41d32520` dated `2026-09-14T10:51:05Z`. Paths relative to repository root. Not cloned; inspected via GitHub API.

## 1. What it is
The standard open-source framework for declarative benchmark evaluation and few-shot testing of language models across hundreds of tasks. MIT licence (`LICENSE.md:1-21`).

## 2. Architecture map
CLI entry points in `lm_eval/__main__.py:5-14`, `lm_eval/_cli/harness.py:10-45`, and `lm_eval/_cli/run.py:18-47`. Orchestration lives in `lm_eval/evaluator.py:140-426` (`simple_evaluate`) and `:430-672` (`evaluate`). Task definitions in `lm_eval/tasks/` built via `TaskFactory` (`lm_eval/tasks/_factory.py:25-84`) and parsed from YAML configs (`lm_eval/tasks/_yaml_loader.py:165-209`). Data models in `lm_eval/config/task.py:81-170` (`TaskConfig`) and `lm_eval/result_schema.py:19-108` (`EvalResults`). Model abstractions in `lm_eval/api/model.py:276-355` (`CachingLM`). Caching divided into prompt request caching (`lm_eval/caching/cache.py:14-75`) and SQLite model response caching (`lm_eval/api/model.py:261-291`). Result and sample persistence in `lm_eval/loggers/evaluation_tracker.py:124-376`.

## 3. Features and how each behaves
- Four-slot seed tuple: `[python, numpy, torch, fewshot]` defaults to `[0, 1234, 1234, 1234]` (`config/evaluate_config.py:30-31`, `_cli/run.py:322-334`), setting `random.seed()`, `np.random.seed()`, `torch.manual_seed()` (`utils.py:916-920`), and passing dedicated generator `random.Random(seed)` to few-shot samplers (`evaluator.py:197-215`, `api/task.py:561-564`).
- Isolated few-shot context sampling: `ContextSampler` uses private `Random(rnd)` instance (`api/samplers.py:26, 78`), excluding the evaluated document via `rm_eval_doc()` (`:60-74`) to prevent label leakage.
- Declarative YAML tasks: `TaskConfig` specifies dataset splits, prompt formatting (`doc_to_text`, `doc_to_target`), metrics, delimiters (`fewshot_delimiter` default `\n\n`), and stops (`config/task.py:81-169`). Supports recursive `include:` inheritance (`tasks/_yaml_loader.py:165-209`) and Python function dispatch with `!function` (`:27-35`).
- Two-tier caching: preprocessed prompt instances cached to disk via `dill` (`caching/cache.py:57-75`, `api/task.py:289-311`), while LM inference responses are cached in SQLite using SHA-256 digests of `[attr] + args` (`api/model.py:256-291`).
- Predict-only mode: `--predict_only` sets `override_metric("bypass")` to record raw model outputs into `samples_*.jsonl` without computing metrics (`evaluator.py:319-325, 373`).

## 4. How people use it
Run via CLI: `lm-eval run --model hf --model_args pretrained=gpt2 --tasks hellaswag --seed 0,1234,1234,1234` (`_cli/run.py:27-38`). Used as the backbone for Hugging Face Open LLM Leaderboards and reproducible model papers. External community usage beyond docs: NOT VERIFIED.

## 5. Mechanism for the Desk
For the Desk quality-drift canary and replay engine, lm-evaluation-harness provides the blueprint for verifiable, reproducible runs:
- Four-slot seed isolation: Separate seeds for harness code (`random_seed`), data permutation (`numpy_random_seed`), model weights/dropout (`torch_random_seed`), and few-shot sampling (`fewshot_random_seed`) (`evaluator.py:197-215`). The Desk must adopt this four-way split so that canary task permutations never perturb model temperature/sampling.
- Multi-hash integrity receipts: `EvaluationTracker` computes `doc_hash`, `prompt_hash`, and `target_hash` per sample (`evaluator.py:656-665`, `result_schema.py:211-218`), then rolls them into a cumulative task digest: `task_hashes[name] = hash_string("".join(sample_hashes))` (`loggers/evaluation_tracker.py:250-261`), alongside `system_instruction_sha` and `chat_template_sha` (`:111-115`). The Desk can directly adapt this into Plumbline's signed verification dossier.
- Model response cache with multimodal digest: `CachingLM` intercepts `loglikelihood` and `generate_until`, storing results in SQLite keyed by `hash_args(attr, args)` (`api/model.py:256-291`). It converts bytes and PIL images to SHA-256 hashes (`:231-253`). What they lose: it bypasses caching if `do_sample=True` (`:311-318`), missing reproducibility for stochastic runs. The Desk will cache stochastic outputs indexed by `(prompt_hash, seed, temperature)`.

## 6. Agent patterns
Linear evaluation pipeline without autonomous multi-agent loops: dataset loader -> prompt formatter -> request batcher -> LM runner -> filter pipeline -> metric aggregator. Multi-turn chat supported via `fewshot_as_multiturn` (`evaluator.py:358-362`).

## 7. Model and data layer
Pluggable model backends via `LM` base class (`api/model.py:30-227`): Hugging Face (`models/huggingface.py`), vLLM (`models/vllm_causallms.py`), SGLang (`models/sglang_causallms.py`), and API models (`models/openai_completions.py`, `models/anthropic_llms.py`, `models/litellm_llms.py`). Datasets load through Hugging Face `datasets.load_dataset` (`config/task.py:87-99`).

## 8. Hackathon-care checks
Structured logging to `results_{date}.json` (`result_schema.py:19-108`) and `samples_{task}_{date}.jsonl` (`:164-218`). Git commit hash (`git_hash`), PyTorch environment (`pretty_env_info`), and start date recorded automatically (`evaluator.py:420-422`). Unsafe code execution (e.g., HumanEval) blocked behind explicit `--confirm_run_unsafe_code` guard (`evaluator.py:522-526`).

## 9. Traps seen
- Request cache key omits few-shot seed: `cache_key` in `api/task.py:289-298` includes task name, few-shot count, and tokenizer, but omits `fewshot_random_seed`. Rerunning with a different seed while `--cache_requests` is enabled serves stale prompts from the previous seed.
- Unsafe pickle caching: Prompt caching serializes arbitrary Python objects to disk via `dill.loads`/`dumps` (`caching/cache.py:60, 74`), creating deserialization vulnerability.
- Arbitrary code execution in YAML: `!function` constructor imports and executes arbitrary Python code paths without sandboxing (`tasks/_yaml_loader.py:27-35, 94-129`).
- Silent cache bypass: Stochastic sampling (`do_sample=True`) bypasses SQLite cache entirely without persistent tracking (`api/model.py:311-318`).

## 10. Reuse
MIT licence (`LICENSE.md:1-21`): Full reuse with attribution.

## 11. Verdict: ADAPT the four-slot seed architecture, isolated ContextSampler, SQLite response cache, and cumulative task hashes
Copy:
1. Four-slot seed separation (`python,numpy,torch,fewshot`) with dedicated `random.Random(seed)` instances to eliminate global PRNG cross-contamination (`config/evaluate_config.py:31`, `api/samplers.py:26`).
2. Cumulative cryptographic integrity hashes (`doc_hash`, `prompt_hash`, `target_hash`, `task_hashes`) for tamper-evident evaluation receipts (`loggers/evaluation_tracker.py:250-261`, `result_schema.py:211-218`).
3. Two-tier caching architecture: SQLite response cache with deterministic argument hashing (`api/model.py:256-291`).
Avoid:
1. Omitting random seeds from prompt request cache keys (`api/task.py:289-298`).
2. Insecure `dill`/pickle serialization for cached tasks (`caching/cache.py:60, 74`).
3. Arbitrary Python function execution directly from YAML tags without isolation (`tasks/_yaml_loader.py:30-34`).
