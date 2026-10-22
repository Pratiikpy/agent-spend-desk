# Profile: cedar-policy/cedar

Licence: Apache-2.0 (`LICENSE:1-2`). Last commit read: 2026-10-20T12:51Z. Stars 1,797 (2026-10-20). Reader: Claude Sonnet, 2026-10-20. Read through the GitHub API and raw files, no clone. Repository has 1,114 files; read: the symbolic compiler's verifier, authorizer and README, the core authorizer's forbid handling, the CLI command list. The type-checking validator (`cedar-policy-core/src/validator/`) was listed, not read: NOT VERIFIED beyond file names.

## 1. What it is
A policy language (permit and forbid statements over principal, action, resource and context) with a Rust evaluator, a schema-based validator and, in the `cedar-policy-symcc` crate, an SMT-based analyser that proves properties of whole policy sets.

## 2. Architecture map
`cedar-policy-core` (parser, evaluator, authorizer, validator), `cedar-policy` (public API), `cedar-policy-cli` (including `command/symcc.rs`), `cedar-policy-symcc/src/symcc/` (compiler to SMT-LIB terms, `authorizer.rs`, `verifier.rs`, `enforcer.rs`, `solver.rs`, extension types for decimal, datetime, ipaddr). A cvc5 1.3.1 binary is an external requirement (`cedar-policy-symcc/README.md:23`).

## 3. Features and how each behaves
Decision rule: a request is allowed iff some permit matches and no forbid matches; no match means deny. The symbolic form is exactly `and(permits, not(forbids))` (`symcc/authorizer.rs:51-55`); the concrete authorizer collects true and false forbids and residuals separately (`cedar-policy-core/src/authorizer.rs:102-156`).

## 4. How people use it
Embed the library and call `is_authorized`; or run the CLI `symcc` subcommands with `--counterexample` on by default (`cedar-policy-cli/src/command/symcc.rs:48-53`). Usage evidence beyond the repo: NOT VERIFIED.

## 5. Mechanism for the Desk (the restrict-only proof)
The check we want is `verify_implies(new, old, env)`: it "returns asserts that are unsatisfiable iff the authorization decision of policies1 implies that of policies2 for every input in env. In other words, every input allowed by policies1 is allowed by policies2" (`symcc/verifier.rs:183-192`). Run with `policies1 = new` and `policies2 = old`: if the solver finds the negation unsatisfiable, the edit cannot allow anything the old set denied. The same file also offers equivalence (`:225`), disjointness (`:237`), always-allows (`:214`), always-denies (`:219`) and never-errors (`:108`). Mechanism: compile both sets to terms, add the schema's well-formedness assertions for every condition, assert `not(implies(t1, t2))`, and ask the solver for a model; a model is the counterexample (`:84-103`). The README lists the counterexample as "a synthesized request and entity store" (`README.md:18-19`), and says the compiler and verifiers are formally modelled in Lean (`README.md:7-8`; that claim is the authors', not rechecked).
Limits read in the code: the compiler refuses some inputs ("empty set literals are not supported", "templates/slots are not supported", "partial evaluation is not supported", `compiler.rs:425, 813-817`); integers are bit-vectors, so overflow semantics are part of the model (`bitvec.rs:234`, comments at `:303-358`); the proof is for one request environment from a schema, so it iterates over every principal, action and resource type (`README.md:29-60`); an external solver binary is needed.
Missing for a spend and outcome policy: Cedar is stateless. A rule like "monthly spend under 200 dollars" needs the running total passed in as a context attribute; the proof then holds for any value of that attribute, which is the right statement for restrict-only but does not prove the meter is correct. There is no approval verdict (only allow or deny), so "ask a human above 50 dollars" has to be modelled as a separate action or a second policy set. Money needs integer micro-units, since decimals are an extension type.
Where our version should differ: our policy language is smaller (caps, allowlists, windows, approval thresholds, outcome conditions), so subsumption can be decided without an SMT solver. Each rule is a box: a numeric cap is an interval, a model or tool list is a set, a window is a time range. New is no wider than old if every old-denied region stays denied, a componentwise comparison we can run in-process and reproduce offline. Keep the Cedar-style counterexample: when the check fails, print one concrete request that the new policy allows and the old denies. Use cvc5 or a Cedar backend only if the language grows past boxes.

## 6. Agent patterns
None. A pure function from (policies, request, entities) to a decision.

## 7. Model and data layer
No model. Schema-typed entities and context.

## 8. Hackathon-care checks
Library and CLI run offline. The solver is a second download (cvc5), which breaks a one-command run unless bundled. No signed output.

## 9. Traps seen
A proof is only as good as the model of the environment; policies outside the supported fragment cannot be proved. A passing proof says nothing about whether the application feeds correct attribute values.

## 10. Reuse
Apache-2.0: may copy with credit; the idea (implies as the safety property, counterexample on failure) is free regardless.

## 11. Verdict: ADAPT (the idea; rebuild the check for our smaller language)
Copy: (1) "new implies old" as the one named safety property, run before any policy edit is accepted; (2) forbid-overrides-permit, default deny; (3) a concrete counterexample request on failure.
Avoid: (1) a mandatory external solver in the demo path; (2) a stateless language with the meter outside the proof, unless the meter is itself covered by tests; (3) claiming "proved" for anything the compiler marks unsupported.
