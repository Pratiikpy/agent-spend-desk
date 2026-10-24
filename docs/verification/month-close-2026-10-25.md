# Month close and the signed month bill (2026-10-25)

`desk close [--month 2026-09] [--policy FILE] [--sign] [--ask-approval]` walks the five steps of a month end and, with `--sign`, writes a `month_bill` dossier that anyone can check offline.

## The five steps

1. **Spend.** The month's estimated list-price spend and calls, split by what the work became (landed, committed, not tied to a commit, reverted), the calls on a model with no price (counted, not priced), and the billed figure when an invoice is imported (otherwise it says what importing would change). A month still running is labelled not final.
2. **Invoices.** Every vendor month in the reconciliation with its status. Vendors with no invoice, a partial one or a gap are listed as unreconciled, never hidden, and stay listed in the dossier.
3. **Canary.** The verdict as of the last run dated inside the month, or the reason there is none.
4. **Replay and the drafted change.** With `--policy FILE`, the policy in force is replayed over the month's sessions only (the first half drafts, the second half is held out), a change is drafted and attacked, and a decision record is written. `--ask-approval` issues an approval request for a change that only narrows the policy. Without `--ask-approval` nothing is waiting for approval, and the close can finish without one. Nothing changes the policy except `desk approve`.
5. **The month dossier.** With `--sign`, the dossier is built, signed with the owner's key (created outside any git work tree), written beside its pins file, and checked at once with the same verifier a stranger runs.

## What a stranger can recompute

The dossier holds one row per day, model, price tier, speed, geography and landing state, with the summed tokens of the calls in it and the cost the ledger recorded. Individual calls are not published (a month is 100,000 calls, which the format's limits and a reader's patience would not carry), and no row holds a session id, path or branch. The verifier, on plain Node with no network:

- recomputes each row's cost from its tokens and the pinned price snapshot, including the long-prompt, fast-mode and US-only rules, to within the rounding half a micro-dollar per call allows and no further (`cost_bounds@1`, new). Each call is rounded half up to a micro-dollar, so n calls can differ from the exact figure by less than n/2 micro-dollars; a row further off than that is refused. A row marked as having no price must really have none in the snapshot;
- adds the rows up for every figure (spend, landed, not tied to a commit, calls, unpriced calls, the billed class, the vendor months not reconciled);
- checks that every number in a sentence is a recomputed claim, and that the word "invoice" or "billed" rests on a billed claim.

A bucket with no row gets no claim: a sum over nothing has no class to carry, and the summary still says it is zero.

## What was run

- 21 tests in `tests/desk/close.test.ts`: month boundaries (leap February, the new year); the rows against the ledger (the month's calls, none from the neighbouring days, the sum by landing state, rule-priced calls kept apart, no session id or path in any row); the dossier verifying at every level; and a corpus of changes a dishonest issuer might make, each refused by the builder's own check: cost up or down by two micro-dollars on two calls, tokens changed, tier or priced flag changed, model swapped, speed changed, a snapshot that is not in the bundle. The rounding bound is tested at its edges (exactly half a micro-dollar rounds up, down is refused). The close command is tested with an invoice that matches (reconciled, billed class present) and one 10% off (unreconciled), with and without a policy, with a policy file that is missing, with a month that is empty, bad or still running, and with a second close for the same month (refused, not mixed).
- One test runs the dossier through **plain `node src/desk/verify/main.ts`** in a subprocess and reads `RESULT: PASS`; the same bundle without its pin is not a pass.
- On this machine, September 2026 (102,716 calls, $14,187.85 estimated, 154 calls on an unpriced model) was closed: 5 steps, 2.3 s, a 206 KB dossier, PASS at every level on plain Node, and the Dossiers screen shows it (photographed, console clean). That it passed means every recorded cost in the real ledger agrees with the pinned prices to within the rounding bound, a check nobody had run before.

## Defects found by doing it, and fixed

- **The offline verifier did not start on plain Node.** `node src/desk/verify/main.ts` failed with "TypeScript parameter property is not supported in strip-only mode" because the error classes in `src/runtime/errors.ts`, which the verifier imports, used parameter properties. The claim "anyone can verify offline on plain Node" was untested until now; it is now a test.
- **A price snapshot with supplements applied could not be bundled.** Its name (`base+supplement+supplement`) contains a plus sign, which the verifier's path rule refused, so the real ledger's snapshot made the first real dossier fail. A plus sign is now allowed in a bundle path.
- A claim over a bucket with no row ("committed $0.00") was refused with a class error; such buckets now get no claim.
- The proposal text said "No rule could stop  without pausing landed sessions" with a blank name when there was nothing to propose; with no finding there is nothing to escalate now. "1 sessions" now reads "1 session".
- The estimate and the review no longer write to the ledger.

## Not covered

- A month with an invoice in a currency other than USD: the invoice is left out of the billed class and the vendor month is unreconciled (per the reconciliation rules); not exercised on a real foreign-currency invoice. Invoice import itself is not verified against a real vendor invoice.
- The long-prompt rows: a sum of tokens cannot show that each call in the row was over the line, only that together they hold more than that many tokens per call. The dossier says so in a sentence when such calls exist. September 2026 had none; October does.
- A month over 200,000 aggregate rows is not reachable (a row is a day, model, tier, speed, geography and landing state: a few thousand at most), but a month with more than a thousand claims is not exercised.
- `desk close --ask-approval` was exercised for its refusals (no policy, a missing policy file) but not through to an issued request on a ledger where the draft narrows the policy; that path is the existing `desk propose --dossier`, covered by its own tests.
- The signed dossier is not tied to an approval of the month itself: the owner's signature says the Desk produced it, not that the owner agreed with it. A month approval step is not built.
- The Dossiers screen was photographed in light at desktop width only.
