# Packs from others and the opt-in index (DF-065, DF-064)

## Packs

A pack is a JSON file: `desk.pack.v1`, a kind (`loop_signature`, `budget_policy`, `outcome_rule` or `canary_template`), a name, a version, a description and a content object. A policy pack holds rules in the policy language and nothing else. A canary template holds tasks, and each task's check is one of seven declared kinds that read text (`lastNumberIs`, `wordIs`, `listIs`, `dateIs`, `timeIs`, `numbersTailAre`, `jsonAlignedIs`). Any other field, in the pack or in a task, is refused when the file is read. A pack cannot hold a command, a path or an address to fetch.

Importing a policy pack adds its rules to the policy in force as a draft and puts the draft through the restrict check that any edit goes through. A pack that permits anything the policy in force denies is rejected, and so is a pack that changes a route, and so is a pack that reuses the id of a rule in force. A rejected pack writes nothing. What passes is replayed over the owner's last 30 days of sessions (withheld, with the reason, when the ledger holds none or does not reproduce its own total), and is written as `policies/drafts/<name>-<version>.yaml` with a `.meta.json` that marks it as in shadow for seven days. The command prints the `gate serve --shadow-for 7d` line that runs it. The policy in force is not touched.

A canary template is stored in its own folder and run on a model the owner names with `desk pack run`. It is not added to the pinned task pack, because that would change the pack's name and restart the baseline.

A pack can be signed by its author (a DSSE envelope over the canonical JSON). A signed pack opens only against keys the owner lists in a pins file, and the output says which key signed it; an unsigned pack is imported and is labelled UNSIGNED.

## The index

Off by default. With `DESK_INDEX=on` and `DESK_INDEX_URL` set, `desk index preview` prints the exact payload and its hash, `desk index accept` records that hash, and `desk index publish` sends the payload only if its hash is the accepted one. The payload holds, per suite, the harness name (a hash), the model the endpoint reported, the number of tasks and runs, the pass rate, the mean steps (swaps) and the canary verdict, plus the tool version and the day. It holds no task id, no prompt, no path and no person. The address is a declared destination in the egress manifest, only while the index is on. A redirect from that address is not followed.

## What was exercised

`tests/desk/pack.test.ts` (8) and `tests/desk/regindex.test.ts` (7): every refusal above, the shadow draft and the untouched policy, signatures (accepted, wrong key, tampered, no pins), canary templates stored and run offline, payload contents against the sample canary and a measured swap, the previewed bytes against a real local server, a changed payload after acceptance, a redirect, and the egress manifest. The prove check `packs-cannot-widen-and-the-index-sends-only-what-was-previewed` repeats the central cases end to end.

## Not covered

No public index exists to send to; the receiving side is not built here, so the payload's usefulness to others is NOT VERIFIED. Packs from strangers have been exercised only as files made in the tests. The shadow draft is run by the existing gate flag; the gate was not run against a pack's draft here.
