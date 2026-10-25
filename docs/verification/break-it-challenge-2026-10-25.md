# Break-it command and differential fuzzing (DF-126)

`desk attack POLICY` does three things to a policy file.

It runs the attacker corpus: for each waste rule a forbid rule names (or each `--harm WASTE_RULE:MIN_USD` given), every value outside a forbid rule's set that a permit still accepts, and each numeric threshold at its exact edge. Every request it reports was decided `allow` by the policy's own evaluator, and the verdict is printed beside it. It exits 1 when it finds one.

It evaluates a request you bring: `--try 'waste_rule=C-LOOP-1,model=m,recoverable_usd=3'` prints the verdict and the rules that decided it. This is the way to attack a policy by hand.

It holds the restrict check to a generated set: random policy pairs built to narrow, widen or leave the meaning alone, compared with an oracle that shares none of the check's code (random requests built from the policies' own literals, their numeric edges and one step either side, run through the interpreter). The output states the number of pairs, the seed, and either "no widening escape found" or the escapes. The line says it is the number tried, not a proof. A widening escape exits 1.

## What was exercised

`tests/desk/attack.test.ts` (5): a forbid limited to one model is found with `changing model to "other-model"` and the evaluator's verdict; a sound policy is not accused; a hand-given harm class; a judge's request evaluated; a policy with nothing to aim at says so instead of reporting clean. The prove check `attack-finds-a-planted-loophole-and-the-fuzzer-sees-a-broken-check` also runs the fuzzer against a check made to approve everything and requires it to find escapes, so that finding none on the real check means something. In the run recorded when this was written, the real check let no widening through in 1,500 generated pairs.

## Not covered

The Cedar solver comparison named in the spec is not run: no Cedar installation is used here, so the oracle is exhaustive-style evaluation on generated requests only. The corpus finds evasions of the forbid rules it can see; it does not claim a policy has none. A public place to submit attacks is not hosted; the command is the invitation, and a policy and a request are all it takes.
