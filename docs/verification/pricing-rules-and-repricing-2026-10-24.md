# Pricing rules and repricing (2026-10-24)

What a call costs now depends on three things the logs can say, and a price that is corrected later no longer overwrites the cost it replaces. This note records what was built, what was checked against the real thing, and what was not.

## The rules

`src/desk/cost/price-call.ts` prices one call and names what decided the price. Source for the rates: Anthropic's pricing page, sections "Data residency pricing" and "Fast mode pricing", read 2026-10-24 through the r.jina.ai text reader; the page text hashes to the same value as the page the prompt-length tiers were read from (`af58183971be…`), and the five sentences used are copied into `data/prices/official-modifiers-2026-10-24.json`.

| Rule | Fires when | Effect |
|---|---|---|
| `long_prompt` | the model is priced by prompt length and this request's prompt is strictly over the line | the higher prices on every token of that request |
| `fast_mode` | the log says `speed: "fast"` and the model has fast prices (Opus 5.5 $8 in and $40 out; Opus 5 and Opus 4.8 $10 and $50 per million tokens) | the fast input and output prices; the cache prices are 0.1x, 1.25x and 2x of the fast input price, as the page says the caching multipliers apply on top |
| `us_only` | the log says `inference_geo: "us"` and the model is one the page names ("Claude 4.6 and later") | 1.1x on every price, including a long prompt's higher prices; stacks with fast mode |

Where the log and the price book disagree or are silent the call is priced at the standard rate and a note is kept beside it, never a guess: `note:fast_mode_unpriced`, `note:speed_unrecorded` (a model with a fast mode and no speed in the log), `note:us_only_unpriced`, `note:geo_unrecorded`. A note does not change a price. The Bill shows, for the period, how many calls each rule and each note touched.

The batch discount (50%) is not modelled: Claude Code does not use the Batch API, and the page says fast mode is not available with it.

## Repricing keeps the old cost

`desk prices reprice --prices <snapshot> [--since D] [--until D] [--reason TEXT] [--preview]` prices the ledger again. A cost that changes is copied to `cost_event_history` under a `repricing` row (when, to which snapshot, which span, why, how many calls, the dollar change) and the call keeps the snapshot id of the price that stands. A second run changes nothing; a repricing back to the old snapshot restores the old totals and keeps both versions. `desk prices history [--call ID]` lists the repricings or one call's versions, and the Bill says when the ledger was repriced and by how much. A call whose price did not move but whose rule notes changed is updated in place without a history row.

## What was checked

- Hand-computed prices, to the micro-dollar, for a standard call, fast mode (the cache prices derived from the fast input price), US-only, fast and US-only together, a long prompt with US-only, the exact line (100,000 tokens is still the short price) and each note: `tests/desk/price-rules.test.ts` (13 tests).
- Repricing on a constructed ledger: preview writes nothing, only changed calls are touched, the old version is readable, a call that was unpriced keeps that fact in the history, a span limits the change, repricing twice is a no-op, going back restores the totals: `tests/desk/reprice.test.ts`.
- The gateway reserves what a request asks for: a request with `speed: "fast"` reserves at the fast output price and is refused where the same request without it fits under the cap; it settles at the fast price; `inference_geo: "us"` settles at 1.1x: `tests/desk/gateway/modifiers.test.ts`.
- The gate's observer and the offline verifier price through the same function, so a dossier row that carries `speed` and `inference_geo` recomputes the same cost; an older row without them is priced as before.
- On this machine's ledger (237,857 calls): `inference_geo` was read from the logs where it exists (`not_available` 148,358; `global` 67,014; empty for the rest). **No call says `us` and none says `fast`**, so the two surcharges never fired on real data here; they are tested on constructed calls only, and the one thing the real data exercised is the notes (56,664 calls on models with a fast mode or a US-only option that did not say).
- Repricing this ledger to the new snapshot moved 2,959 calls by +$208.80. Nearly all of it (2,568 calls, 2,538 of them Claude Sonnet 5.5, +$184.45) is calls that an earlier price file could not price at all; 381 Haiku 5.5 calls (+$4.18) and a few Opus and Sonnet 5 calls had been priced under older rows. The change and the old costs are in the ledger's history, not in the repository.

## Not covered

Fast mode and US-only on a real call (none exists in these logs). The Codex and OpenCode readers carry no speed or geography, so their calls take the standard price and no note. Other providers' surcharges. Whether Anthropic's page matches an invoice: no invoice was read.
