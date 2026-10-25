# The wording lint: text that would overclaim is never shown (2026-10-25)

Feature DF-080 built. `src/desk/lint/wording.ts` is a list of rules over words that claim more than the evidence does, and three places where it runs.

## The rules

| Rule | Flags | Allowed when |
|---|---|---|
| `proved` | `proved`, `proves`, `proven`, `proof` | the line is about the restrict-only check, the offline verifier, a signature or a tamper test; or it denies the word right beside it ("not proof of", "cannot prove") |
| `as-good-as` | `as good as` | an equivalence is named, or the idiom is "only as good as" |
| `regressed` | `regressed`, `regression` | a verdict, an interval, a control arm, the canary or a study is in sight; "regression test" and "regression index" are not the claim |
| `billed` | `billed` | an invoice, the billed class, a vendor or a reconciliation is the subject; or the bare class label "Billed" |
| `caused-by` | `caused by` | the sentence denies it ("not shown to be caused by") |
| `overclaim` | `best`, `optimal`, `production-ready`, `state of the art`, `guaranteed`, `certified`, `flawless`, `perfect`, `seamless`, `bulletproof`, `foolproof`, `never wrong`, `100% accurate` | the word is denied beside it, or the line says it is not claimed or not verified |
| `promise-of-saving` | `will save`, `saves you`, `you will save`, `guaranteed saving` | it is denied ("not a promise") |
| `accurate` | `accurate`, `accuracy` | a measurement is beside it |

A line is read with the lines either side, so a thought begun above is read with its end. Every exemption is a pattern in the file with the context it names. A denial passes only when it is right beside the word, not anywhere in the paragraph: a first version let any "not" in the neighbouring lines excuse a claim, which passed a deck heading reading "What is proven, what is not".

## Where it runs

- **The Auditor refuses a generated sentence** that overclaims, whatever its figures (`reason: wording`, naming the rule). The Auditor keeps its own checks for "billed" and "as good as", which it can make against the cited claims.
- **`desk prove`** has a check that lints the README, the evidence page, the product description, every file under `docs/submission` except the organisers' templates, every verification note, the command list and the sample bill: 53 files and about 3,300 lines, 0 findings. The check first plants an overclaim and fails if the lint misses it.
- **The tests** lint the rendered text of every screen (one line to a text node), the card text, and run a corpus of 51 sentences: each rule flags the overclaims it is for and passes the honest uses it must not stop (`tests/desk/lint-wording.test.ts`).

## What it found

- The Ask screen said a change in an answer "is the proof the engine does something"; it now says "the evidence that".
- The deck's last section was headed "What is proven, what is not"; it is "What is checked, what is not", and both deck PDFs were re-rendered.
- The product description named a source category "governance and proof"; it is "governance and verification".
- A benchmark note said "a perfect score there says the fixes worked"; it says "a score of 60 of 60". A bill note ranked provenance classes by "the best kind available"; it says "the highest-ranked kind".
- Replaying the recorded benchmarks after the Auditor change gave the same tables (sets A, B and D, 0 differ), so no recorded explainer sentence was refused for its wording.

## Not covered

- **The rules are phrases.** A claim in words the rules do not know passes. They are a floor on the words that have already caused trouble, not a reading of meaning.
- **Documents outside the list are not linted**: the design and planning files under `docs/design`, `docs/plan` and `docs/intel`, code comments, commit messages and the organisers' templates.
- **Only some generated text is linted**: every screen, the card, the bill, the command list, and the Explainer's sentences through the Auditor. The output of every other command (the weekly review, the gauge, the estimate, the month close) is not run through the lint.
- **A live Explainer was not tried with a prompt that tempts it to overclaim.** The Auditor refuses what it is given; how often a live model offers such sentences is not measured, and a refusal costs a revision (at most two) and then the rule-written sentence.
- A false positive is possible in either direction: a harmless sentence that happens to hold a rule's word with none of its excusing context is flagged, and the fix is to reword it.
