# Signed Nightshift receipts for the Nemotron calls, 2026-10-26

Every model call desk. makes can go through Meterless Nightshift, an OpenAI-compatible endpoint on this machine. Nightshift 1.2.x writes beside each reply a receipt (`meterless.compute_receipt.v1`: the request, the model that answered, the route, the tokens and the time) and signs it with Ed25519. `2026-10-26.json` holds the receipts of eleven live calls of desk.'s own roles, kept whole, so that anyone can check the signatures without Nightshift and without a network.

```
npm run desk -- receipts docs/verification/nightshift-receipts
npm run desk -- receipts docs/verification/nightshift-receipts --pin e92caae86b5f702e
```

Result of the first command on 2026-10-26: 11 receipts, 11 signed, 11 valid, signed by key `e92caae86b5f702e`. `desk prove` runs the same check and also refuses the log with one number changed, with one signature swapped for another call's, and read against another key (`nightshift-receipts-verify-and-a-changed-one-is-refused`).

## Which model answered which role

| Role | What it does | Model that answered | Receipts |
|---|---|---|---|
| `ask_planner` | The Planner writes a typed program for a question | `nvidia/nemotron-3.5-lightning-30b-a3b` | 3 |
| `ask_planner` | The same, with a second Nemotron model chosen in settings | `nvidia/nemotron-3-ultra-550b-a55b` | 1 |
| `explainer` | The Explainer writes the answer from checked figures | `nvidia/nemotron-3.5-lightning-30b-a3b` | 2 |
| `explainer` | The same, with the second model | `nvidia/nemotron-3-ultra-550b-a55b` | 1 |
| `policy_drafter` | The Drafter proposes a spend policy from one month | `nvidia/nemotron-3.5-lightning-30b-a3b` | 3 |
| `policy_attacker` | The Attacker looks for requests that step around a policy | `nvidia/nemotron-3.5-lightning-30b-a3b` | 1 |

The model is a setting (`NEMOTRON_MODEL`), not something the code assumes; the receipt names the model that actually answered, and desk. calls a reply Nightshift's only when it carries such a receipt and the signature holds.

## What a valid signature shows, and what it does not

It shows that the key named above wrote this receipt and that nothing in it changed afterwards: the model, the receipt id, the tokens and the time are the ones Nightshift signed. It does not show that the key is Meterless's own: the key is the one this machine's Nightshift generated, and a reader who wants that comparison must hold the key id from another source, which is what `--pin` is for. It does not show that the answer was good.

## How these were made

Nightshift 1.2.3 for Windows, with an NVIDIA key in its own key store, was started and the commands below were run against the constructed sample, each recording into a folder outside the repository so that the committed replies were not touched. `desk receipts export` then wrote the eleven calls whose receipts were signed and valid to one log.

```
desk ask "What changed before 2026-10-15?"   --db data/desk/sample/ledger.db --record --cassettes <folder>
desk ask "Which model cost the most in the last 30 days?" ... (same)
desk ask "How much of our spend landed?"      ... with NEMOTRON_MODEL=nvidia/nemotron-3-ultra-550b-a55b
desk propose                                  --db data/desk/sample/ledger.db --record --cassettes <folder>
desk receipts export <folder> docs/verification/nightshift-receipts/2026-10-26.json
```

## What is not covered

- **The canary and the three benchmark arms.** Their 2,400-odd recorded replies in `data/sample/` carry a receipt each (`desk receipts` lists them by role and model), but they were recorded before Nightshift's signatures were kept, so they are counted as unsigned and cannot be checked by a stranger. They say which model answered; they do not prove it.
- **A reply with no receipt.** In one live run the Explainer's reply for the first question arrived without a receipt and was not claimed as Nightshift's (the log of that run is not kept); a second run of the same call carried a valid one. Nightshift also answers HTTP 502 for some upstream failures, with no receipt, and desk. retries those.
- **One signer.** Every receipt here was signed by one Nightshift installation. Receipts from another machine would show another key id.
- **Nightshift's model routing.** With a concrete model id the replies named the model asked for, on every call here. Earlier builds substituted models in some cases (organizers' chat, 2026-10-23); nothing here shows how a different build behaves.
