# Profile: FoundationAgents/MetaGPT

Reader: Haiku (low effort), 2026-10-16, about 105 seconds, 86k tokens, 37 tool calls. Shallow clone (depth 1), commit 11cdf46 (2026-01-21), deleted after the profile pass. Paths relative to `metagpt/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright Chenglin Wu (confirmed); commit 11cdf46 dated 2026-01-21 (confirmed); `Team.run` loops for `n_round` rounds, stops early when all roles are idle, and calls a balance check before each round, at `team.py:123-138` (confirmed; the reader did not mention the budget check, which stops a run when the money limit is reached); the environment runs all roles concurrently with futures at `environment/base_env.py:197-203` (confirmed). The role internals, the line numbers for subscription and the memory claims were not rechecked. Result: PASS on the parts checked.

## 1. What it is
A multi-agent framework where role agents with standard operating procedures (SOPs) collaborate through a shared message environment, best known for generating a software project from one sentence. MIT.

## 2. Architecture map
An environment holds roles and routes messages by publish and subscribe; a role wraps actions and a context with a message buffer and memory; a team hires roles and runs rounds; documents carry a status (draft, under review, approved, done); a subscription runner supports continuous tasks; a cost manager tracks spending.

## 3. Features and how each behaves
A role watches certain action types; a message whose source action matches lands in that role's buffer; the role observes, decides its next action, acts and publishes a message with its source and recipients. React modes: react until no action matches, by order, or plan and act. The team stops when a round limit is hit, all roles are idle or the budget is spent.

## 4. How people use it
`pip install metagpt`, `metagpt --init-config`, then a one-line command or the team API with hired roles. Examples include a debate and a code, test, review loop. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our modules (M4/M10 roles and SOPs)
SOPs are not a primitive: they are the order of actions plus each role's watch set. Routing is by message source and addressee. Critic loops are made by one role watching another's output type. Lost: messages are never pruned from buffers, role state lives per role without locks.

## 6. Agent patterns
Roles with shared environment, subscription-based activation, budgeted rounds, document status as a workflow state. No confidence branching; silent idling when no action matches.

## 7. Model and data layer
A provider registry for models; readers for several file types; a RAG submodule; plain-text keys in a user config file.

## 8. Hackathon-care checks
Messages carry source, content, sender and recipients, but there is no JSONL trace writer; no Docker file found; no evaluation harness in the main package; no sample mode found.

## 9. Traps seen
Roles that cannot act just idle with no error; unbounded buffer growth; a global storage path for saved state; design notes cite RFCs that are not in the repository.

## 10. Reuse
MIT: copy with credit. Candidate parts: targeted message routing by watch set, document status lifecycle, round and budget guard in the run loop.

## 11. Verdict: ADAPT for M10 and the agent roster
Copy: (1) a hard stop on spending and rounds in the run loop, visible in the trace; (2) addressed messages and watch sets so a role sees only what it subscribed to; (3) document status (draft, under review, approved) as part of the case state.
Avoid: (1) silent idling: a role with no matching action records why; (2) unbounded message buffers; (3) shared global storage paths.
Where we are already ahead: roles differ by tool scope and trust boundary, with an ablation showing each is needed.
