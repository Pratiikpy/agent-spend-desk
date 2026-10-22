# Paper note: Cedar: A New Language for Expressive, Fast, Safe, and Analyzable Authorization
Source: arXiv:2403.04651v2 (https://arxiv.org/abs/2403.04651v2), read 2026-10-20 by agy (Gemini)

, here is the research note for the Agent Spend and Worth Desk:

### 1. Paper Claims
Cedar balances expressiveness (RBAC, ABAC, ReBAC), sub-millisecond evaluation, safety (default-deny, forbid-trumps-permit, determinism, side-effect-free), and automated formal analysis. Unlike Rego or OpenFGA, Cedar provides a decidable, sound, and complete SMT encoding for automated equivalence and containment checking.

### 2. Method
- **Formal Verification:** Core semantics and validator soundness formalized and machine-checked in Lean.
- **Differential Testing:** Native Lean executable model differential-fuzzed via `cargo-fuzz` against production Rust code.
- **SMT Compilation:** Novel quantifier-free translation to CVC5 using uninterpreted functions, datatypes, and ground acyclicity/transitivity constraints over expression footprints.
- **Policy Slicing:** Indexes policies by scope `(principal, resource)` ancestors to evaluate only relevant rules.

### 3. Key Numbers (Quoted Exact Words)
- **Evaluation Latency vs Alternatives (§5.2.2):** "Cedar is 28.7×, 34.4×, or 35.2× faster than OpenFGA (for gdrive, github, and TinyTodo respectively)" and "60.4×, 80.8×, or 42.8× faster than Rego, respectively."
- **Cedar Scaling (§5.2.2):** Handled gdrive requests in "median 4.0μs with 5 Users/Groups/Documents/Folders, increasing only to 5.0μs with 50 Users/Groups/Documents/Folders", github "around median 11.0μs across this entire input range", with p99 "under 10μs (gdrive) or 20μs (github)".
- **Competitor Scaling (§5.2.2):** Rego gdrive degraded from "median 76μs" (p99 "391μs") to "median 676μs" (p99 "1933μs"). OpenFGA gdrive p99 surged from "283μs to 3012μs".
- **Policy Slicing (§5.3):** Template slicing median was "about 18% faster than the Cedar median for github, but about 94% slower than Cedar for gdrive."
- **SMT Refactoring Analysis (§5.4 Table 1):** Median solve times (encoding + solver ms): Correct github "27.1+33.8", gdrive "16.4+28.9", TinyTodo "52.2+67.4"; Buggy github "29.9+40.9", gdrive "19.6+34.9", TinyTodo "56.2+77.3".
- **Implementation Quality (§3.6):** Differential fuzzing uncovered "nearly two dozen bugs since the project’s inception".

### 4. Desk Takeaways
- **Policy Engine for Spend & Approval Gates:** Adopt Cedar-style deterministic, default-deny, forbid-trumps-permit policies to enforce hard spend limits, canary halts, and workflow caps without embedding logic in agent code.
- **Proving Policy Changes Only Restrict (Containment):** To prove new policy set $P_{\text{new}}$ only restricts existing $P_{\text{old}}$ (subsumption), compile both to SMT and assert $\text{isTrue}(P_{\text{new}}) \land \neg\text{isTrue}(P_{\text{old}})$ with footprint well-formedness constraints. If UNSAT, $P_{\text{new}}$ provably never permits any action/spend denied by $P_{\text{old}}$. If SAT, solver synthesizes an exact counterexample request for approval review.
- **Signed Audit Dossiers:** Deterministic evaluation and explicit DAG entity stores allow emitting self-contained, offline-verifiable authorization and spending decision dossiers for Plumbline.

### 5. Limits & What the Paper Does Not Show
- **SMT Scale Unproven:** Benchmarks evaluated only toy policies (3–5 rules). Scalability on enterprise suites with hundreds of policies is NOT VERIFIED.
- **Lean SMT Proofs Incomplete:** Paper notes SMT encoder soundness/completeness proofs in Lean were "underway, as of this writing" (§4.4) [NOT VERIFIED in paper].
- **Pure In-Memory Evaluation:** Assumes all entities reside in memory (§5.2); omits real-world database fetching latencies.
- **Slicing Overhead:** Scoping index overhead slows down small policy sets (e.g. 94% slower on gdrive).

### 6. What to Avoid
- **Avoid Turing-complete / General Datalog Languages (e.g. Rego):** Recursion and custom combinators cause exponential worst-case latency and destroy automated SMT decidability.
- **Avoid Quantified SMT Axioms:** Never use universal quantifiers for graph acyclicity/transitivity; use grounded footprint constraints.
- **Avoid Over-Slicing:** Do not mandate index slicing where policy counts are small.
