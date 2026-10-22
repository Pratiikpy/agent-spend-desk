# Paper note: SWE-bench: Can Language Models Resolve Real-World GitHub Issues?
Source: arXiv:2310.06770 (https://arxiv.org/abs/2310.06770), read 2026-10-20 by agy (Gemini)

, research note for Agent Spend and Worth Desk design:

### 1. What the Paper Claims
- Real-world software engineering across full repositories exposes severe performance limits in frontier language models.
- State-of-the-art models resolve only the simplest issues when tasked with multi-file code editing from natural language issue descriptions.
- Solving repository-scale issues requires long-context reasoning, precise fault localization, and coordinating changes across files, which traditional code benchmarks fail to evaluate.

### 2. The Method
- **Pipeline**: A "3"-stage pipeline (Section "2.1") scrapes pull requests from GitHub, applies attribute filtering (merged PRs resolving an issue and modifying test files), and verifies via execution in versioned Conda environments.
- **Task Formulation**: Given issue text and codebase, the model generates a unified diff (".patch") file; edits apply to the pre-PR base commit via unix's "patch" program (Section "2.2").
- **Evaluation**: Execution harness executes the PR test suite. Completion requires applying the patch and passing all relevant tests (Appendix "A.4").

### 3. Key Numbers (with Section or Table)
- Benchmark scale: "2,294" task instances drawn from "12" popular Python repos, filtered from "~90,000" PRs (Section "2.1").
- SWE-bench Lite: "300" instances across "11" repositories (Section "2.4").
- Model resolution rates (Table "5", BM25 retrieval, % Resolved):
  - Claude 3 Opus: "3.79" (full), "4.33" (Lite)
  - Claude 2: "1.97" (full; cited as "1.96%" in Section "5" text), "3.00" (Lite)
  - GPT-4-turbo: "1.31" (full), "2.67" (Lite)
  - SWE-Llama 13b / 7b: "0.70" / "0.70" (full)
  - ChatGPT-3.5: "0.17" (full)
- Oracle retrieval: Claude 2 resolves "4.8%" (Section "5", Table "18").
- Patch characteristics: Reference solutions average "1.7" files, "3.0" functions, and "32.8" lines (Section "2.3"); model patches average "30.1" lines vs gold "74.5" lines (Table "8").
- Execution outcomes (Table "23", Appendix "C.5"): Out of "1078" applied patches for Claude 2, "110" were Resolved, "26" Breaking Resolved, "15" Partially Resolved, "20" Work in Progress, "471" No-Op, and "436" Regression. Non-resolved applied patches are "60%" to "70%" No-Ops.

### 4. What the Desk Should Take from It
- **Outcome Verification Dual-Gate**: Adopt SWE-bench's test split:
  - `FAIL_TO_PASS` (F2P): Target issue resolution (at least "1" test changes from fail to pass).
  - `PASS_TO_PASS` (P2P): Non-regression guarantee (median "51" tests must remain passing; Section "2.3").
- **Outcome Accounting**: Receipts must classify runs into the "6" Table "22" states: Resolved, Partially Resolved, Breaking Resolved, Work in Progress, No-Op, and Regression. Never bill full price for a No-Op or Regression.
- **Harness & Contamination Caveats**:
  - Harness formatting brittleness: Syntax errors require automated patch fixing (Step "6", Appendix "A.4"); execution timeouts or missing tests default to score "0".
  - Contamination: Cut off issue comments before initial commit timestamp; verify performance invariance across release dates (Table "7").

### 5. Limits and What the Paper Does Not Show
- **Python only**: Evaluates exclusively "12" Python repositories (Section "7").
- **No test feedback in loop**: Tests single-shot generation without tool interaction, agent loops, or test execution during generation (Section "7").
- **Spend & Efficiency**: Does not track token spend, financial cost, latency, or runaway loops.
- **Code quality blind spot**: Section "7" notes passing unit tests does not guarantee readability, efficiency, or maintainability (e.g., Cyclomatic complexity jumping from "3" to "5", Appendix "C.7").

### 6. What to Avoid
- Avoid binary pass/fail receipts that ignore regressions (breaking P2P tests).
- Avoid paying for patches that pass tests via brittle workarounds or increased complexity.
- Avoid loose execution environments; version-pinned dependencies are mandatory.
