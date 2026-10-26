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

## 1b. Demand signals measured on 2026-10-26 (interest in the category, not willingness to pay)

All numbers were read on 2026-10-26 from the GitHub API, the npm download API and the Hacker News search API. Reddit threads are in section 1c.

| Signal | Number | What it shows | What it does not show |
|---|---|---|---|
| ccusage (free log reader), GitHub stars | 19,181 (created 2025-05-29) | Developers want to see where agent spend goes | That anyone pays; stars can be inflated |
| ccusage, npm downloads | 131,771 in the week ending 2026-10-25; 857,016 in the 30 days to 2026-10-25 | Active installs and CI use | Unique users: downloads include automation and repeat installs |
| CodexBar (menu-bar usage tracker), stars | 22,823 (created 2025-11-16) | Same | Same |
| Claude-Code-Usage-Monitor, stars | 8,766 (created 2025-06-19) | Same | Same |
| CodeBurn (free, local, 37 tools, by model, project and task), stars | 11,581 in about six months (created 2026-04-13) | The category is moving fast; a Show HN post drew 112 points and 27 comments | That its users want a policy loop |
| LiteLLM and Langfuse (gateway and observability), stars | 62,072 and 36,526 | Teams pay attention to LLM cost control and tracing | That coding-agent teams buy a third-party desk |
| GitHub repositories matching "claude code usage" | 8,348 (search count) | Many people build their own trackers | Quality or adoption of any of them |
| Claude Code issue on hitting limits unexpectedly (#16157) | 1,499 comments, 726 reactions, still open | Intense, durable pain | That the pain is solved by a tracker |
| Claude Code issue on limits exhausted fast (#38335) | 879 comments, 546 reactions, still open | Same | Same |
| Claude Code issue on degradation in complex engineering (#42796) | 583 comments, 3,286 reactions, closed | A large audience suspects silent regressions | That a canary would settle it |
| Codex issue on rate-limit cost jump (#28879) | 211 comments, 561 reactions, closed | The pain is multi-vendor | |
| Hacker News stories mentioning "claude code usage limit" since October 2024 | 153 (search count) | A recurring topic, with many Show HN tools | Quality of any story |

What these numbers support: the demand for seeing where agent spend goes and for seeing limits coming is large, real and multi-vendor. What they also show: the category is crowded with free tools that appeared quickly, so interest in a tracker is not evidence that anyone pays for one.

### The nearest free competitor, read from its README

CodeBurn (https://github.com/getagentseal/codeburn, MIT) lists: spend by model, project and task across 37 to 42 tools; `sessions --by-pr`, which groups spend by the pull request links a session recorded; plan and quota tracking, with live five-hour and weekly limits; a Guard feature for budget caps for Claude Code; and a model comparison on the user's own history (one-shot rate, retry rate, cost per edit). As far as its README says, it does not describe a held-out replay of a proposed cap, a control-arm regression check, a restrict-only proof, or a signed record a stranger verifies offline. That is a reading of one README on 2026-10-26, not a test of the product. It is the strongest evidence in this file that what users want is close to what desk. does first (where did the money go, will I hit a limit, stop a runaway), and that desk.'s differences are in the decision loop around it.

## 1c. What people say on Reddit, read on 2026-10-26

**Method.** Reddit blocks direct access from this machine, so the threads were read through a public Redlib instance (Redlib is an open-source, read-only Reddit front end; instance list: https://github.com/redlib-org/redlib-instances), with an identifying user agent, twelve search queries about usage limits, cost and tracking for Claude Code, Codex and Cursor, sorted by top over the past year, 25 results each, four seconds apart. That returned 231 unique threads. Of those, 45 were on topic in developer subreddits (r/ClaudeCode, r/ClaudeAI, r/codex, r/OpenAI, r/LocalLLaMA) by a title keyword filter, with a combined 53,800 upvotes and 8,089 comments; 38 of them had 100 or more upvotes and 16 had 1,000 or more. I then picked the twelve below by hand as the most directly about limits, cost and tracking.

| Subreddit | Date | Upvotes | Comments | Title (as shown) |
|---|---|---:|---:|---|
| r/ClaudeAI | 2026-04-03 | 13,526 | 641 | [Taught Claude to talk like a caveman to use 75% less tokens.](https://www.reddit.com/r/ClaudeAI/comments/1sble09/taught_claude_to_talk_like_a_caveman_to_use_75/) |
| r/ClaudeAI | 2026-09-19 | 4,856 | 274 | [Asked Claude to waste my remaining usage before weekly reset. Very satisfied with the result.](https://www.reddit.com/r/ClaudeAI/comments/1wkqszd/asked_claude_to_waste_my_remaining_usage_before/) |
| r/ClaudeCode | 2026-07-21 | 2,403 | 192 | [Important Update to Claude Usage Limits](https://www.reddit.com/r/ClaudeCode/comments/1v2yoe4/important_update_to_claude_usage_limits/) |
| r/ClaudeCode | 2026-05-12 | 2,094 | 117 | [Clawdmeter - a small ESP32 usage limit monitor (source code in description)](https://www.reddit.com/r/ClaudeCode/comments/1takxpl/clawdmeter_a_small_esp32_usage_limit_monitor/) |
| r/ClaudeCode | 2026-08-31 | 1,779 | 223 | [Claude Max "20x" only applies to the 5-hour window. Weekly usage on the $200 plan is 2x the $100 plan](https://www.reddit.com/r/ClaudeCode/comments/1w38v98/claude_max_20x_only_applies_to_the_5hour_window/) |
| r/codex | 2026-08-16 | 1,703 | 341 | [Y'all need to make more noise on social media. Limits have been halved in the last 3 days](https://www.reddit.com/r/codex/comments/1vpz69p/yall_need_to_make_more_noise_on_social_media/) |
| r/ClaudeCode | 2026-03-27 | 1,610 | 601 | [It costs you around 2% session usage to say hello to claude!](https://www.reddit.com/r/ClaudeCode/comments/1s54q0d/it_costs_you_around_2_session_usage_to_say_hello/) |
| r/codex | 2026-08-28 | 1,591 | 181 | [Hitting your limits too quickly? OpenAI has been hiding this one weird trick](https://www.reddit.com/r/codex/comments/1w0nbos/hitting_your_limits_too_quickly_openai_has_been/) |
| r/codex | 2026-10-05 | 1,107 | 310 | [OpenAI offers 5x less value than Anthropic at same pricepoint (source: semianalysis)](https://www.reddit.com/r/codex/comments/1wyjx8u/openai_offers_5x_less_value_than_anthropic_at/) |
| r/ClaudeCode | 2026-04-03 | 951 | 537 | [Users hitting usage limits WAY faster than expected it's getting real now](https://www.reddit.com/r/ClaudeCode/comments/1sbggsf/users_hitting_usage_limits_way_faster_than/) |
| r/ClaudeCode | 2026-03-30 | 950 | 324 | [Investigating usage limits hitting faster than expected](https://www.reddit.com/r/ClaudeCode/comments/1s7zg7h/investigating_usage_limits_hitting_faster_than/) |
| r/ClaudeCode | 2026-09-14 | 934 | 391 | [The limits have been reduced even further now. It's September 14, and it really happened..](https://www.reddit.com/r/ClaudeCode/comments/1wfwl6k/the_limits_have_been_reduced_even_further_now_its/) |

The twelve together: 33,504 upvotes and 4,132 comments. Scores and dates are as the instance showed them on 2026-10-26.

Two further threads were large but are about companies, not developers' own plans, and were not verified here: a thread titled "Company Blew $500M On Claude AI In One Month Due To No Usage Limit On Licenses For Employees" (r/pcmasterrace, 2026-05-30, 10,728 upvotes, 529 comments) and one titled "Amazon scraps AI leaderboard to stop workers boosting usage scores" (r/technology, 2026-05-29, 10,685 upvotes, 531 comments). The first is a headline repeated by a forum, not a checked fact.

**What the threads want, in the posters' own terms.** To see a limit coming (an ESP32 monitor built just for it drew 2,094 upvotes); to know what consumed the allowance ("2% of session usage to say hello"); to spend fewer tokens (the 75% post); not to waste an unused weekly allowance; and clear rules for what a plan is worth (the 20x versus 2x thread). That is what desk. does first: where a limit went, what a percent costs in tokens, and whether a window will last.

**What they do not show.**
- Most of these threads are individuals complaining about a plan's limits, not engineering leads deciding team policy. They support the autopsy, the limit estimate and the runway forecast more than the policy loop, the canary or the signed dossier.
- Nothing here says anyone would pay for a third-party tool. Several of the loudest threads are about the vendor changing limits, which no tool of ours can change.
- Search was by my queries, top 25 per query, one year, one instance; it is not a census, and the on-topic filter and my hand selection are judgement.

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
