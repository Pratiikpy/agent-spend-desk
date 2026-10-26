# Impact and market validation: what is established, what is not

Written 2026-10-26. This file separates three kinds of evidence and never lets one stand in for another:

1. **The problem is real and large.** Independent research, surveys and public reports. This does not show anyone needs desk. in particular.
2. **desk. does what it says.** Measured on a constructed sample, with its own checks. This is in `docs/evidence.md` and `docs/verification/`.
3. **desk. helps someone make a better decision.** Independent use by real users. **No such evidence exists yet.** Section 6 is a protocol for it, written before any participant has been recruited and not yet run.

Every external figure below was read from the cited page on 2026-10-26. Where a page was not read in full, the row says so.

## 1. Independent research on the problem

| Source | Finding, as the source states it | Method and sample | Limit | What it supports in desk. |
|---|---|---|---|---|
| Stanford Digital Economy Lab, working paper "How Do AI Agents Spend Your Money? Analyzing and Predicting Token Consumption in Agentic Coding Tasks" (arXiv 2604.22750; https://digitaleconomy.stanford.edu/publication/how-do-ai-agents-spend-your-money-analyzing-and-predicting-token-consumption-in-agentic-coding-tasks/) | Agentic tasks use about 1000 times more tokens than code reasoning and code chat; runs on the same task can differ by up to 30 times in total tokens; higher token use does not mean higher accuracy (accuracy often peaks at intermediate cost); expert-rated difficulty only weakly tracks token cost; frontier models fail to predict their own token use (correlations up to 0.39) and underestimate it | Trajectories of eight frontier models on SWE-bench Verified | Benchmark tasks, not a team's real work; the paper does not study spend policy | Why estimates must be ranges and why the pre-run estimate refuses to answer with fewer than ten similar tasks; why spend and quality are measured together |
| Stack Overflow, 2025 Developer Survey, AI section (https://survey.stackoverflow.co/2025/ai) | 84% of respondents use or plan to use AI tools (76% a year earlier); 51% of professional developers use them daily; 46% distrust the accuracy of the output against 33% who trust it; 66% name "almost right, but not quite" solutions as their biggest frustration and 45% say debugging AI code takes longer | A large self-reported survey; respondent count not re-read for this file | General developers, not engineering leads who pay the bill; says nothing about spend | The need for checked claims and for measuring completed work. It is not evidence of demand for desk. |
| METR, randomized controlled trial (arXiv 2507.09089; https://arxiv.org/abs/2507.09089) and its update of 2026-02-24 (https://metr.org/blog/2026-02-24-uplift-update/) | 16 experienced open-source developers, 246 tasks. Developers forecast that AI would cut completion time by 24% and afterwards estimated 20%; the measured effect was a 19% increase in completion time (interval +2% to +39%). In a later experiment METR found the data an unreliable signal because of selection effects (developers declining to work without AI, a lower pay rate, unreliable timing for people running several agents); it reports -18% (interval -38% to +9%) for returning developers and -4% (interval -15% to +9%) for newly recruited ones and calls it very weak evidence | Randomized per task, early-2025 tools for the first study | One setting; the later study is explicitly unreliable; neither concerns spend | An argument for measuring completed engineering outcomes instead of perceived productivity or token counts. It also warns how hard such measurement is |
| Google DORA, 2025 State of AI-assisted Software Development (https://research.google/pubs/dora-2025-state-of-ai-assisted-software-development-report/) | AI is "an amplifier": it magnifies the strengths of high-performing organizations and the dysfunctions of struggling ones | More than 100 hours of qualitative data and survey responses from nearly 5,000 technology professionals | Only the summary page was read; survey based | Supports governance and measured rollout in general. Not specific to coding-agent spend |

These four sources make a serious case that the problem is real. They do not show that desk. saves money or improves engineering outcomes.

## 2. What vendors already provide (and where they are stronger)

| Vendor | What its own documentation lists | Source |
|---|---|---|
| Anthropic | The Claude Code Analytics Admin API returns daily per-user metrics: sessions, lines of code added and removed, **commits and pull requests created using Claude Code**, tool acceptance and rejection rates, and **estimated cost and token usage by model**; data arrives with up to a one-hour delay; records cover usage authenticated against a Claude Console organization | https://platform.claude.com/docs/en/build-with-claude/claude-code-analytics-api |
| OpenAI | Codex governance documentation lists an interactive Codex analytics dashboard, an Analytics API for aggregated Codex reporting, and a Compliance API for audit records; workspace credit controls are described as separate from analytics | https://developers.openai.com/codex/enterprise/governance |
| Cursor | A web analytics dashboard with CSV download; an Admin API with usage events, daily usage data, spending data and user spend limits; an Analytics API available only to Enterprise customers; a section on tracking AI code in git commits | https://cursor.com/docs/account/teams/analytics ; https://cursor.com/docs/account/teams/admin-api |

These are first-party, need no install and are strongest for their own tool. The earlier wording in this repository, that tools show only a number, was too broad and has been corrected. The narrower claim that survives is in section 3.

## 3. The gap, stated narrowly

Existing analytics report usage, estimated cost and development activity inside one vendor. As far as these pages state, none of them, and none of the free log readers we read (ccusage, CodexBar), does the following across vendors and from the owner's own logs: tie each dollar to independently checked outcomes (merged on green checks, kept, reverted), replay a proposed cap on a month it was not drafted from and report the landed work it would have blocked, call a regression against a control arm, or produce a signed record a stranger can verify offline. "Not documented in the pages read" is not "does not exist": a vendor may have such a feature that we did not find.

### Comparison on six real questions

Marks: **Y** documented in the sources read; **Partly** documented for part of the question; **Not documented** in the sources read; **Constructed** shown by desk. only on its constructed sample.

| Question | Anthropic Claude Code analytics | OpenAI Codex analytics | Cursor admin and analytics | Log readers (ccusage, CodexBar) | desk. |
|---|---|---|---|---|---|
| What did the team's AI spending achieve? | Partly: commits and pull requests created, lines of code, estimated cost | Partly: usage and Code Review activity | Partly: usage, spend, a section on AI code in commits | Cost and pace, not outcomes | Constructed: each dollar placed on kept, merged, committed, reverted or unlinked |
| Which costs led to merged, checked work? | Not documented | Not documented | Not documented | No | Constructed: merged on green checks versus red, through Zetaris |
| Why was a limit exhausted? | Usage by user and model | Usage and credits by surface | Usage and spend per user | Pace and totals | Constructed: the heaviest window split into causes |
| Would a proposed cap interrupt useful work? | Not documented | Not documented | Not documented | No | Constructed: replay on a held-out month; 5 of 333 landed sessions would be blocked |
| Can the action be challenged, approved and enforced safely? | Spend limits at the organization | Usage limits (plan dependent) | User spend limits | No | Restrict-only check, attacker, approval echo and a fail-closed gate; enforced for Claude Code and Codex CLI in live tests |
| Can the evidence be verified independently? | Exportable data | Exportable data | CSV and API export | Open logs | Signed dossier that verifies on plain Node with the network off |

Where vendors are stronger: first-party data, no install, native enforcement inside their own product, and real organizations using them. Where desk. is weaker: it has been run on a constructed sample and the author's own logs, and no outside user has run it.

## 4. Measured evidence about desk. itself (not external research)

See `docs/evidence.md`, `docs/verification/` and the Evidence Index in the Notion workspace. In short: a preregistered 60-question comparison (12 / 45 / 55 exact answers), a role-removal study, a three-model and two-mix study, 61 named checks, a held-out replay that blocks 5 of 333 landed sessions and a decision record that recommends keeping the current policy. The 55 / 45 / 12 result was recorded on the revision named in `docs/verification/benchmark/RESULTS-v3.md`; the Ask path changed afterwards (Scout Intent routing, embeddings), so it is a measured historical result and not a fresh held-out result for today's revision.

## 5. Evidence that weakens the case

- No named buyer willing to pay a third party was found; individual users have free trackers and teams have vendor consoles (`docs/design/desk/03-product-requirements.md`, section 3).
- Vendors are adding exactly the kind of analytics in section 2, and the usage-meter category is crowded with free tools.
- The project's own research gate scored the idea 69.4 raw and 53.4 after eight open weaknesses.
- Daily value is thin by default: the typical daily regression result is that nothing happened.
- The external research in section 1 shows the problem exists, not that desk. solves it.

## 6. Proposed independent evaluation (a protocol; not run)

**Aim.** Test whether someone who did not build desk. reaches better decisions with it than with what exists today.

**Participants.** Engineering leads or senior engineers who have owned a team's AI tooling budget; at least 12, from at least 3 organizations; none involved in building desk.; recruited without describing the expected result; informed consent; no payment tied to outcomes.

**Conditions (each participant sees all three, order counterbalanced, different scenario each time).**
A. The vendor analytics and exports a team would have today for that scenario.
B. A free log reader's output.
C. desk.'s card, Ask and policy replay.

**Tasks.** Four scenarios generated by code from seeds and committed before recruitment, each with a ground truth fixed in advance: for a constructed team and month, (1) which proposed cap would block landed work, (2) whether a model regression happened, (3) why a limit was exhausted, (4) whether a drafted policy should be adopted.

**Pre-registered scoring.** Primary outcome: the share of decisions that match the ground truth and preserve completed work. Secondary: time to decision, harmful caps adopted, false alarms, and stated confidence against correctness. The scoring rubric, the exclusion rules and the analysis (exact paired tests with intervals, and no claim beyond the pre-registered comparisons) are committed before the first session.

**Independence.** Sessions run by someone other than the builders; scenario files and the scoring script public; raw (anonymised) results published whatever they show, including a null or negative result.

**What it would and would not show.** A small study can add early evidence that desk. improves a decision on constructed scenarios. It would not show savings on a real team or support causal claims for all engineering teams. A second study on a consenting team's own logs (their definition of landed work, one decision they took) is the step that tests the claim that matters.

## 7. Economic hypotheses (no measured savings)

Value to a team in a month, written with its assumptions explicit, none of which has been measured:

`value = (probability of a runaway session) x (its average cost avoided by a reserve and a cap) + (share of spend that is recoverable waste) x (spend) x (fraction a policy can recover without blocking landed work) - (cost of landed work a cap would wrongly pause) - (review time)`

On the constructed sample the measured pieces are: waste found in training of $5,171.07 (fan-out), $152.73 (loops) and $16.14 (idle); a hardened policy that pauses 12 sessions in the training month ($113.04 not spent, 0 of 311 landed blocked) and, on the held-out month, 10 sessions with 5 of 333 landed sessions blocked ($136.72 upper bound). Those are list-price estimates on a constructed team. Public reports give the scale of the exposure (a single overnight loop that burned about $6,000; token use on the same task varying up to 30 times) but not the frequency on any given team. No savings figure is claimed.
