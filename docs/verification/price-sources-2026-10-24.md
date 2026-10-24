# Two price sources, and the one price they disagree on (2026-10-24)

`desk prices compare` reads a second, independent source of Anthropic list prices and checks our price book against it. The second source is Portkey's open price database (`Portkey-AI/models`, MIT licence, served at `https://configs.portkey.ai/pricing/anthropic.json`), saved whole as `data/prices/portkey-anthropic-2026-10-24.json` by `scripts/fetch-portkey-prices.ts` (38 entries, sha256 `acd222665898…`; identical to the copy in the GitHub repository). Portkey states prices in US cents per token; the reader multiplies by 1e10 and rounds to get the micro-dollars per million tokens our price book holds.

## Result

17 models are priced by both. **89 of 90 prices agree** within 0.1%, including Claude Haiku 5.5's prompt-length tier. One does not:

| Model | Price | Our price book | Portkey |
|---|---|---|---|
| claude-sonnet-5-5 | cache read | $0.10 per million tokens | $0.20 per million tokens |

What each source says about that one price, as read on 2026-10-24:

- Anthropic's pricing page (read through `r.jina.ai`): "Cache read (hit): 0.1x base input price (0.025x on Claude Fable 5.1 and Claude Mythos 5.1; 0.05x on Claude Opus 5.5 and Claude Sonnet 5.5)", which is $0.10 for Sonnet 5.5. The model table's cache-hit cell for Sonnet 5.5 is blank in the text the reader returned, so the sentence is the evidence, not the table. The same page lists Claude Sonnet 5 at $0.20.
- LiteLLM's database (our price book's base): $0.10.
- Portkey: $0.20, the same as Sonnet 5.
- Claude Code's own recorded session cost reproduces to 0.3% only with $0.20 (`docs/verification/reconciliation-2026-10-24.md`). That is a client-side estimate, not an invoice.

Two sources say $0.10 and two say $0.20. **NOT VERIFIED which is right.** Portkey and Claude Code may both carry Sonnet 5's price over to Sonnet 5.5, or the page may be ahead of them; only a usage export or an invoice for Sonnet 5.5 cache reads settles it.

## What it is worth in the ledger

In the reconciliation ledger (218,026 calls) Sonnet 5.5 has 17,418,745,265 cache-read tokens. If $0.20 is right, the cost estimate for those tokens is **$1,741.87 higher** than the price book says. Every other price agrees, so this is the whole disagreement. `desk prices compare --db <ledger>` prints that line for any ledger, and `costBand` turns it into a low and high estimate.

## Not covered

Only Anthropic's file was compared. Portkey's OpenAI file, and any other provider the ledger may hold, were not. Models only one source has are listed by the command (our book has the Mythos and Opus 4.6 and 4.7 rows Portkey lacks; Portkey has the Claude 2, 3 and 3.5 rows we left out); they cannot be checked against each other. Batch, regional and fast-mode prices were not compared. The tolerance is 0.1%, which covers rounding of cents. Adding Portkey's code or data to the product is not done: the file is used as an input to a check, with credit in `data/README.md`.
