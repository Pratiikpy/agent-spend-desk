# Profile: TauricResearch/TradingAgents

Reader: Haiku (low effort), 2026-10-16, about 112 seconds, 98k tokens, 32 tool calls. Local clone, version 0.6.0 (2026-10-03). Paths relative to `tradingagents/` unless stated. (The repository owner is NOT VERIFIED.)

Spot-check (reviewer, against the files): Apache 2.0 (confirmed); the changelog entry for 0.6.0 dated 2026-10-03 (confirmed); `max_debate_rounds` and `max_risk_discuss_rounds` both default to 1 at `default_config.py:133-134` (confirmed); model names such as `claude-opus-5-5` appear in the tests (confirmed; the reader's mapping from tier to default model was not rechecked). The graph wiring, the settlement logic and the line numbers for them were not rechecked: NOT VERIFIED. Result: PASS on the facts checked; the rest is the reader's account.

## 1. What it is
A multi-agent LLM framework that imitates a trading firm: analysts, a bull and bear debate, a trader, a risk debate and a portfolio manager, with a memory of past decisions. Apache 2.0.

## 2. Architecture map
A LangGraph graph: four analysts (market, sentiment, news, fundamentals) with tools, a bull and bear debate with a research manager, a trader that turns the plan into a proposal, a three-way risk debate (aggressive, conservative, neutral), and a portfolio manager that issues the rating. A memory node settles earlier decisions in parallel with the analysts. Per-ticker SQLite checkpoints allow resume.

## 3. Features and how each behaves
Structured outputs for the plan, the proposal and the decision, with a fallback to parsing free text. Optional portfolio context (positions, cash). Backtest over tickers and dates. HTML and Markdown reports. Many model providers.

## 4. How people use it
Install, set a provider key, run the interactive command line, or pass flags and environment variables, or call the graph from Python. More than 40 test files; an end-to-end wiring test uses scripted models and no network (per the reader). Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M5 decision pipeline and learning)
Two debates with fixed turn counts end by a counter, not by agreement. The final manager reads the debate history, the plan and a "past context" of lessons. Memory: each decision is logged as pending; after the holding window it is settled with realised return and a reflection, which the next run on the same ticker reads. Lost: no measure of how strongly the debaters disagreed; "conflict alone is not a Hold" is a prompt instruction.

## 6. Agent patterns
Debate pairs with an arbiter, a structured-output fallback, parallel analysts, a settlement step that runs alongside, checkpoint resume. The critics are the debaters themselves, not a separate verifier.

## 7. Model and data layer
LangChain clients for many providers with default model tiers; pluggable data vendors (Yahoo, EDGAR, Alpha Vantage, FRED and others) behind a router with retries; data is fetched as of the run date to avoid looking ahead.

## 8. Hackathon-care checks
Reports and a Markdown decision log; no structured trace format seen; no sample mode, but scripted-model tests run offline; Dockerfile and volume for data; keys in `.env`; the README admits runs are not reproducible because of model sampling and live data.

## 9. Traps seen
Settlement skips quietly when closing prices are unavailable and shows only in a report note; analyst selection changes what the trader sees; the debate state structure is fragile across checkpoint resumes (reader's account); no confidence signal; non-reproducible runs.

## 10. Reuse
Apache 2.0: copy with credit and notice. Candidate parts: the debate state machine with alternating turns, the structured output with free-text fallback, the settle-then-reflect memory loop, as-of-date data fetching.

## 11. Verdict: ADAPT for M5 and M6
Copy: (1) a bounded two-sided debate (approve versus hold) before a human sees a case, with the turn limit as a visible parameter; (2) structured outputs with a recorded fallback; (3) outcome-based memory: record the decision, wait for the real outcome, then write the lesson. For us the outcome is the later payment result or override, not a market return.
Avoid: (1) debate that ends only by a turn counter with no disagreement measure; (2) settlement that skips without a visible gap; (3) non-reproducible runs: ours must replay from a stored case.
Where we are already ahead: a lesson becomes a proposed rule that is replayed on stored cases and confirmed by a person before it changes any later decision.
