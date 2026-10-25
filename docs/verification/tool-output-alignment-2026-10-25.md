# Tool-output alignment (DF-101), 2026-10-25

A tool output or a model's structured answer is judged against a reference by what is in it, not by how it is laid out. Equality of two JSON texts says no when the keys come in another order, when a list comes back sorted differently, or when a string differs by one letter. A score between 0 and 1 says how much of the reference is there.

## What it does

`src/desk/align` takes a reference and an output, each a value or JSON text, and scores them:

- **Objects.** Every field of the reference is paired with a field of the output so that the pairs score as much as they can together, by Kuhn-Munkres assignment. A pair scores 0.3 for the same key and 0.7 for how alike the values are. A field renamed with its value kept scores 0.7; the right key with a wrong value scores 0.3 plus 0.7 of how alike the values are.
- **Lists.** Matched the same way by the value alone, in any order. `--ordered` compares them position by position, for a list whose order is the answer.
- **Leaves.** Strings are compared by characters (edit distance over the longer length), numbers by distance against the larger, booleans and null by equality. A value of another type is 0. A number written as a string is a mismatch unless `--coerce` is given.
- **What is missing or added.** A field or element with no partner scores 0 and counts against the whole, whether it is missing from the output or only in the output, so adding fields is no safer than dropping them.
- **Not JSON.** A reply that is not JSON, or a reference that is not, is compared by words and marked low confidence. JSON cut out of a fenced block or out of a sentence is scored as structure and marked low confidence, because the model was told to give JSON and gave more.
- **Pass line.** 0.85.
- **Logprobs.** When the model's token log-probabilities are given, tokens under 1% probability are left out of the mean confidence and counted apart. They never move the score; a score whose tokens were mostly doubtful is labelled low.

`desk align <reference.json> <output.json>` scores two files and lists where the points went. `jsonAlignedIs` is a checker kind for the canary (version 1), so a task can be scored this way; the pinned canary pack is unchanged and does not use it.

## What was run

`tests/desk/align.test.ts` (26 tests): the assignment against every permutation on 300 seeded matrices (square and not), the greedy choice that is not the highest-scoring pairing, a 200 by 200 matrix, ragged and non-finite matrices refused; edit distance by character and by word, code points, numbers; a reordered object and lists scoring exactly 1, a near match between 0.85 and 1, a wrong one under 0.5, renamed and wrongly valued fields at their weights, missing and extra fields at one half each, type mismatches, ordered lists, two alike elements not paired twice, empty values and top-level scalars, JSON read out of a fence and out of a sentence, prose falling back to words, a structure too deep to match, 200 records in any order, the cap on listed losses, logprob handling, the checker and the command. `desk prove` runs it as `tool-output-alignment-is-order-blind-and-continuous`. Mutation checks: reversing the assignment's cost failed 12 tests, changing the weights to 0.5 and 0.5 failed 3, and matching lists in order only failed 7.

## Not covered

- **Real tool outputs.** Every case is written for the test. No captured tool output from a real agent run has been scored yet; that arrives with trajectory capture and replay (DF-040, DF-042).
- **The weights.** 0.3 for a key and 0.7 for a value are the specified ones. They are not tuned on any data, and a task where the key matters more would want others.
- **Lists longer than 400.** They are matched in order, not by assignment, because the assignment is cubic; the report does not say when this happened.
- **Semantics.** Two values with the same meaning in different words ("yes" and "affirmative"), a date in two formats, or a number in a different unit score as different.
- **Logprobs from a real model.** Only the arithmetic over a given list is tested; no log-probabilities from an endpoint were fetched.
