# Profile: AgentOps-AI/tokencost (client-side token counting and price lookup)

Reader: Claude Sonnet, 2026-10-20. Licence read first: MIT (`LICENSE:1`, "Copyright (c) 2023 AgentOps"). Stars 2,004; last commit e7f7c19, 2025-09-05 (gh api). That is 13.5 months before today, so the project is dormant. Read in full at HEAD, no clone: `tokencost/costs.py` (458 lines), `tokencost/constants.py` (95), `update_prices.py`, tests header, `README.md`.

## 1. What it is
A small Python library that estimates the USD cost of a prompt and a completion from text, before or after a call. It has no server, no ledger and no budgets.

## 2. Architecture map
`tokencost/costs.py` (counting and math), `tokencost/constants.py` (price loading), `tokencost/model_prices.json` (1,701 `litellm_provider` entries, my count), `update_prices.py` (regenerates the JSON and `pricing_table.md`), `tests/test_costs.py`.

## 3. Features and how each behaves
`calculate_prompt_cost`, `calculate_completion_cost`, `calculate_all_costs_and_tokens` (`costs.py:336-458`) return `Decimal` USD and token counts. `configure_model` and `register_model_pattern` let you add or override a model, with a `*` wildcard turned into a regex (`:32-98`). Unknown model raises `KeyError` (`:320-325`, `:360-364`), so failure is loud, unlike a silent zero.

## 4. How people use it
`pip install tokencost`, call a function with a string or a ChatML message list and a model name (`README.md:63`). Real-world use: NOT VERIFIED.

## 5. Mechanism for the Desk
Where money is counted: nowhere persistent. It computes `Decimal(price_per_token) * Decimal(num_tokens)` (`costs.py:333`), nothing more.

How prices are sourced: not by the project. `PRICES_URL` points at LiteLLM's `model_prices_and_context_window.json` on `main` (`constants.py:27`). `refresh_prices` fetches it with a 10-second timeout, merges it over the bundled static copy, and on any exception returns the static prices (`constants.py:37, 62-79`). `update_prices.py` copies the same source into `model_prices.json` and re-adds `openai/`-prefixed duplicate keys (`:7-9, 49-60`). So tokencost's price book is a downstream snapshot of LiteLLM's; its freshness is LiteLLM's freshness minus whenever someone last ran the script. The repo's last commit is 2025-09-05, so the bundled snapshot is over a year old unless `refresh_prices()` is called.

Tokenization per provider, and where it is wrong:
- OpenAI and everything else: `tiktoken` with the model's encoding; if the model is unknown it silently uses `cl100k_base` and logs a warning (`costs.py:224-228`, `:299-303`). For non-OpenAI models that is an approximation, not the model's own tokenizer. The file says so: "cl100k is the openai base tokenizer. Nothing to do with Claude" (`:17`).
- Message overhead is hard-coded for a fixed list of OpenAI model names, 3 tokens per message and 3 to prime the reply (`:229-275`); any other model name raises `KeyError` (`:262-266`). Names beginning with "o" get the GPT-4 overhead (`:240`), including unrelated models.
- Anthropic: calls the Anthropic beta token-counting API, which needs an API key and a network call, only for a fixed list of Claude families; otherwise it raises (`:162-190`). The README says older Claude models use `cl100k_base` (`README.md:118`), but the code raises for them instead (`:174-177`): a README/code mismatch. The library warns "expect differences in costs" (`:219-222`). Completion tokens for Claude are `count - 13` for an assumed fixed 13-token wrapper (`:409-410`).
- Strings containing `claude-` cannot be counted with `count_string_tokens` (`:294-297`).

What the math leaves out: `TokenType` includes `cached` (`:21`, `:150-154`) but `calculate_prompt_cost` only ever uses `input` (`:375`), and `calculate_completion_cost` only `output` (`:414`). There is no cache-write price, no cache-read discount applied in practice, no tiered pricing, no batch rate, no reasoning or thinking tokens, no per-request or tool fees, no image or audio. It prices text it is given, not usage the provider billed; for an agent bill it understates anything involving caching, long context or reasoning. Estimated versus billed: all of it is an estimate from text; the library never reads a provider `usage` block. Its own error message says to use the `usage` property of the response for exact counts (`:176`).

## 6. Agent patterns
None.

## 7. Model and data layer
Model names normalise by lowercase, strip `ft:gpt-3.5-turbo` suffixes, `bedrock/anthropic.` prefix and last path segment (`:101-137`, `:193-200`). Pattern-registered prices are cached into the global dict on first match (`:130-135`).

## 8. Hackathon-care checks
`tests/test_costs.py:9-10` loads `ANTHROPIC_API_KEY` from `.env`, so Claude tests need a live key; a judge without it cannot run them. Tests were not executed by me.

## 9. Traps seen
Silent `cl100k_base` fallback; hard-coded `- 13`; "o"-prefix overhead rule; stale snapshot; unused `cached` token type; README claim that differs from code.

## 10. Reuse
MIT: may reuse with credit. Nothing worth copying as code; the lessons are about what not to rely on.

## 11. Verdict: REJECT as a dependency, ADOPT its test idea
Copy: (1) `Decimal` arithmetic for money; (2) loud failure on an unknown model; (3) user-registered model price overrides with wildcards.
Avoid: (1) estimating tokens from text when the provider returns billed usage; (2) a silent default tokenizer for non-OpenAI models; (3) bundling a price snapshot with no age stamp or `source` per entry.
