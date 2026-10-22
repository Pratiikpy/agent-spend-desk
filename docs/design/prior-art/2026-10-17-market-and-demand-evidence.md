# Market and demand evidence for a release gate (2026-10-17)

Purpose: test the product as a company, not only as a hackathon entry. Two independent web researchers (Sonnet) ran on 2026-10-17: one mapped existing products, one looked for real incidents, practitioner demand, surveys and regulation. Both ran out of search budget part way, so every "not found" below means "not found by this pass", not "does not exist". Anything without a source is NOT VERIFIED. Vendor numbers are labelled as vendor claims. Facts were not re-fetched by the reviewer; the links are the researchers' and should be opened before any of this is quoted in the README, deck or video.

## 1. Who already sells parts of this

Confirmed by the researcher from the vendors' own pages or press releases:

- Large security vendors have bought the guardrail start-ups, which shows that buyers exist and that the standalone category is being absorbed: Lakera by Check Point (announced 2025-09-16), Invariant Labs by Snyk (2025-06-24), Protect AI by Palo Alto Networks (completed 2025-07-22), Prompt Security by SentinelOne (2025-08-05). Prices undisclosed.
- Agent security platforms: Zenity, Lasso, Pillar (funding NOT VERIFIED). Runtime guardrail toolkits: NVIDIA NeMo Guardrails (Apache-2.0), Guardrails AI.
- Authorization and identity for agents: Permit.io (lists an MCP gateway), Auth0 for AI Agents.
- Agent payments with limits: Skyfire (agent identity token and wallet), Payman (policy engine in front of a bank core, audit trail; sells to banks and credit unions), Stripe (scoped shared payment tokens), Google AP2 (signed payment mandates that prove user intent to a merchant; Apache-2.0 spec). Nekuda has pivoted to merchant tooling.
- Human approval: HumanLayer has moved to a coding-agent IDE; gotoHuman offers review workflows and an inbox.
- MCP gateways: Docker MCP Gateway (credential injection, isolation, call logs; no approval or evidence checks mentioned).
- Open source, small: agentidentityprotocol (MCP policy proxy with approval and audit, 38 stars), tool-use-firewall (1 star), Trust-Receipt-Verifier (JWS receipts verifiable offline, 0 stars, 2026-10-13). A cluster of small Show HN gates (Vectimus, Railguard, FlowLink, AgentPort) with under 10 points each.

Not checked (fetch failed): Oso, Descope, Stytch, Okta, Cloudflare MCP, Visa Intelligent Commerce, Mastercard Agent Pay, Coinbase x402, Forrester, and all analyst figures from Gartner pages.

## 2. What nobody was found to do

Not found does not mean absent. In the pages read:

1. A gate decision (allow or block) as a signed record that anyone can verify offline. The nearest are AP2 mandates (they sign the user's intent, not the gate's decision) and one tiny receipt repository.
2. Restrict-only rule learning from human overrides, with replay over past traffic.
3. Exact minimal explanations of a block (the smallest set of facts that caused it).
4. A pre-execution evidence check on the counterparty or payee. Payman and Stripe limit what an agent may do; neither was found checking who the money goes to.
5. One gate spanning MCP, payments and approval with a verifiable record.

## 3. Real incidents (independent press or first-person accounts)

- 2025-07, Replit agent deleted SaaStr's production database during a code freeze (The Register, 2025-07-21).
- 2025-07-22, Gemini CLI deleted a user's files (first-person post, 304 Hacker News points).
- 2026-04-26, PocketOS: an agent in Cursor with Claude Opus 4.6 deleted the production database and its backups in one Railway API call, 9 seconds (founder's own account; Hacker News thread 860 points, about 1,000 comments).
- Reported 2026-02, Amazon Kiro tied to a 13-hour disruption (The Register citing the FT); AWS blamed misconfigured access controls and added mandatory peer review for production access afterwards.
- NOT VERIFIED: any sourced case of an agent paying the wrong party, emailing the wrong person, or prompt injection leading to a payment. The search for these failed.

## 4. Practitioner demand, surveys, regulation

- Framework feature requests for approval hooks: vercel/ai #8718 (2025-09-17) and pydantic-ai #9107 (2026-03-20). Few reactions (5 and 0); frameworks are building it themselves.
- Ask HN threads show mild interest: top advice was fine-grained credentials, not a gate; "does human approval exist in your agent stack" drew one comment.
- Gartner forecast (2025-06-25): over 40% of agentic AI projects cancelled by end of 2027, citing "inadequate risk controls" among causes. A forecast, not a measured survey.
- SailPoint vendor survey: 82% of organisations use agents, 44% have policies to secure them. Vendor claim, date not captured.
- EU AI Act Article 14 (human oversight) and Article 12 (automatic logging) apply to high-risk systems only; application dates beyond 2 August 2026 are NOT VERIFIED. FINRA's 2026 oversight report names agents acting without human validation, acting beyond scope and weak auditability as risks. Visa has published a Trusted Agent Protocol.
- NOT VERIFIED: willingness to pay, any buyer for a signed record specifically, any network rule on liability for agent errors.

## 5. What this means for the product

1. Pain is best evidenced for coding and infrastructure agents (destructive calls, over-broad credentials, no enforceable freeze). Payments have regulator and network language but no sourced incident.
2. The free alternative is closing: Claude Code, Cursor, the Vercel AI SDK and pydantic-ai ship permission prompts or approval hooks, and small open-source gates are appearing. A plain "ask the user first" gate is not a company. The defensible parts are the ones in section 2.
3. Buyer with the strongest paper case: regulated firms that must show oversight and logs (FINRA-type, EU high-risk). Whether they will pay is unproven.
4. Hero demo: no recommendation. Earlier leanings (coding first, then payments first) were withdrawn on 2026-10-17 at Prateek's direction; the hero is chosen only after research on the use cases the tracks ask for (D-027).

## 7. Payment-release fraud demand (second pass, 2026-10-17)

Same limits as above: a researcher with a search cap, links not re-fetched by the reviewer. The figures are from the FBI and from an industry body, not from vendors.

- FBI IC3 2025 report: business email compromise (BEC) losses $3,046,598,558 over 24,768 complaints; IC3 2024: $2,770,151,146 over 21,442. IC3 2023 total NOT VERIFIED. Links: ic3.gov/AnnualReport/Reports/2025_IC3Report.pdf and 2024_IC3Report.pdf.
- AFP Payments Fraud survey 2025 (2024 data): 79% of organisations hit; BEC the top route at 63%; vendor-imposter fraud cited by 45%, up 11 points; only 22% recovered 75% or more of lost funds, down from 41%. AFP 2026 survey (2025 data, 465 respondents): 76% hit; its BEC and control-failure figures were not extracted.
- Microsoft threat report (2026-09-10): a campaign of over 1,000,000 emails impersonating executives to get finance staff to send ACH transfers of nearly $50,000; whether AI was involved was not established.
- Basware agreed to buy Trustpair on 2026-08-26 (price undisclosed; a later release says it completed). Trustpair verifies supplier bank-account ownership and checks payment files before money moves; Series B about $20M in 2022 (aggregator figures), 600+ customers (vendor claim). This is a real, consolidating category and also a direct competitor for the payment pack.
- Unsourced or unread: any incident of an AI agent paying the wrong party; the SSRN paper "AI Agents as BEC Attack Vectors" (title only); card-network statements on liability; pricing and ROI of any competitor; UK Finance, Europol and IC3 2023 totals.
- Reviewer inference, not sourced: the card-network agent frameworks (Visa, Mastercard, AP2, Stripe) verify the agent and its mandate; none of the snippets seen checked who owns the payee account, and Trustpair does that for people-driven payments, not as a signed gate decision.

## 8. Hackathon-side findings (third pass, 2026-10-17)

- GenAI Works lists past events (4,127 to 5,000+ participants) but no winners, judges or judge quotes: NOT VERIFIED whether winning leads to funding.
- A public competitor repository (`Karthik0809/procurement-fraud-investigator`, Track 3, explainable procurement fraud) is a close neighbour. Its `docs/HACKATHON_RULES.md` is a secondhand summary that lists different dates and says Zetaris is optional; our copy of the organizers' welcome guide says 22 to 27 October with Zetaris and Meterless required. The conflict is recorded in `docs/intel/06-source-gaps-and-discrepancies.md` terms: re-read the Official Rules on HackOS.
- Zetaris positions itself on governed access across scattered data, with finance and compliance use cases (AML, fraud, credit); its knowledge base has MCP guides. Meterless (`meterless.ai`, Nightshift) serves local models through one OpenAI-compatible base URL. Which fit the gate best is an inference, NOT VERIFIED as the sponsors' judging view.

## 9. Use cases the tracks ask for (fourth and fifth passes, 2026-10-17)

Two researchers, neither steered to payments. Search caps hit again; the domain pass is thin. Links are the researchers' and were not re-fetched.

Open-source and launch signals (GitHub API and Hacker News, read 2026-10-17):
- Deep research is the most demanded agent category: "Introducing deep research" 593 points (2025-02-03); gpt-researcher 30k stars, deer-flow 84k stars. Top criticism: hallucinations and wrong answers with no proof.
- Fabricated citations have reached real reports: EY Canada (326 points, 2026-05-30) and a White House report (198 points, 2025-05-30).
- Memory complaints: mem0 #7283 (faithfulness check before memory write), mem0 #7376 (proof and chain of custody), graphiti #1707 (episodes silently dropped), graphiti #1728 (edge invalidation retires unrelated facts). HN: "one poisoned line of text" affects everything downstream.
- Crowded: tracing and observability (Langfuse 36k stars, Phoenix, about 8 YC start-ups), text-to-SQL and semantic layers (Cube, WrenAI, vanna), entity resolution libraries (splink, dedupe, zingg). Reconciliation-agent repos found were 0 to 5 stars: thin evidence, not proof of low demand.
- Product Hunt and Reddit not checked.

Domain signals:
- Legal AI is funded and crowded: Harvey raised $200M at $11B (CNBC, 2026-03-25, headline only); Legora over $250M.
- Agent runtime security: Arrakis raised $8M (2026-08-02).
- Insurance document linking with source per value: Parsewise (YC Spring 2025), vendor copy, no funding found.
- SOC triage: Dropzone AI sells an AI SOC analyst, funding NOT VERIFIED.
- Healthcare prior authorisation: CMS-0057-F metrics reporting from 2026-01-01, API requirements due 2027-01-01 (CMS fact sheet). No company verified.
- McKinsey: 40% of large organisations report scaling agents (27% before). a16z 2025: innovation budgets fell from 25% to 7% of LLM spend. Gartner: over 40% of agentic projects cancelled by 2027 (forecast, body not read); only 15% consider fully autonomous deployments (The Register, 2025-10-01).
- Procurement, supply chain, energy, public sector, HR, sales ops, IT ops, data governance: nothing verified.

Reading of the evidence (judgement, not verified):
1. Two product directions fit the engine and tracks 1 and 2: an evidence layer that settles conflicts between sources with provenance, and a claim-by-claim verifier that keeps an audit record.
2. Domains worth testing next: insurance claims, healthcare prior authorisation (hard 2027 deadline), security alert triage.
3. Crowded, so avoid as the lead: legal review, coding agents, tracing, plain text-to-SQL.

## 6. Gaps in this evidence

Both passes hit their search limits. Unread: Reddit practitioner threads, McKinsey, KPMG and Deloitte surveys, Mastercard, Coinbase, Oso, Descope, Stytch, Okta, funding amounts for most start-ups. The next pass should cover these and look for payment-side incidents and any sign of willingness to pay.

## 10. Demand by track, news pass of 2026-10-18 (search summaries only; every figure NOT VERIFIED until the primary source is opened)

| Track | Pain | Evidence as reported | Primary source to open |
|---|---|---|---|
| 1 Fragmented intelligence | Agents cannot reach the data they need | 46% name data silos their top challenge; average organization runs about 957 applications with only 27% connected; 94% explore AI but 15% say data is very ready (vendor surveys: Reltio, Cloudera, Jitterbit) | the survey reports themselves; vendor surveys favor their own product |
| 2 Explain why | Regulators now ask for per-decision reasons and reconstruction | CFPB Circular 2026-03 (5 May 2026) on specific adverse-action reasons for complex models; 23 states and DC adopted the NAIC AI bulletin by late 2025; EU AI Act Annex III high-risk date moved from 2 Aug 2026 to 2 Dec 2027 by Regulation (EU) 2026/1744 | the CFPB circular, NAIC bulletin, Official Journal text |
| 3 Reasoning architecture | Agents fail in production, errors compound | 78% have a pilot, 14% scaled; 88% of pilots never reach production; 56.6% aggregate success across 6,259 production agents; 60% single-run success falls to about 25% over eight runs; Gartner: over 40% of agentic projects cancelled by 2027 | the March 2026 studies named in each article; several of these pages are low-quality aggregators |

Reading: one product that reconciles scattered sources, explains with per-decision reasons, and is measured over repeated runs meets all three. Regulators' reconstruction-on-demand requirement is the strongest pull for the signed, replayable dossier.

## 11. Reddit pass of 2026-10-18 (rdt-cli, top posts of the last year; individual voices, not a survey)

| Thread | What people say | Reading for us |
|---|---|---|
| r/medicine, "Prior authorization; or How I Became Radicalized" (1,206 votes) | An interventional radiologist's CT follow-up is denied on the day of the scan despite thorough notes; the vendor says it cannot handle the appeal, so the process restarts. Top replies: 30 minutes on hold for a drug that costs $4 elsewhere; a PCP's Ozempic denial asks for a diabetes history that fills the note; "let us bill for the time" (643 and 371 votes) | The pain is documentation ignored, restarts and unpaid time: matches reconcile (the note says it), explain (the exact criterion) and appeal replay |
| r/dataisbeautiful, a chart that prior authorization consumes more clinician full-time equivalents than the projected US physician supply (14,638 votes, 849 comments) | Very large public interest | The topic has mass attention; the chart's data source is not yet checked (**NOT VERIFIED**) |
| r/medicine, UnitedHealthcare to remove prior authorization for 30% of services (699); a post on federal AI used to deny care for seniors (524) | Mixed: reform is arriving, and distrust of AI denials is high | Our rule that the system never denies is the right promise |
| r/AI_Agents, "A client paid me to rip the AI out of the tool I built them" (784) | An LLM ticket router was right about 92% of the time, which meant 7 or 8 misrouted tickets a day; the client wanted it removed. Replies (33, 32, 18 votes): use a deterministic engine wherever rules already exist, use the model only for fuzzy parts | Strong support for our design: the rules, the quote check and the release gate are code; the model proposes |
| r/AI_Agents, "Stop building AI agents" (1,634) and similar titles | Builders warn that many agents should not exist | The market distrusts generic agents; a narrow, verifiable one stands out |
| r/dataengineering, agent hype threads | Skepticism about agents writing SQL and replacing engineers | Data-side buyers want checkable output, not autonomy |

Not found in this pass: r/MachineLearning and r/ExperiencedDevs searches returned little on regulator-grade explanation or audit trails. Comments were read for two threads only.

## 12. Wide sweep of 2026-10-18: Reddit (36 searches, 335 posts, 28 subreddits, top of the last year) and Hacker News (Algolia)

Method limits: Reddit "top this year" is noisy (it returned game, Plex and model-release posts, which were dropped); comments were read for only a few threads; Hacker News threads are small; all are individual voices. Scores are Reddit votes. Nothing here is a survey or a market size.

### Track 1, fragmented intelligence and reconciliation
- r/Accounting (326 votes): someone automated a bank reconciliation and the company now wants it rebuilt "in AI". Reconciliation is a daily job that people already pay for.
- r/dataengineering: entity resolution is still a standalone open-source topic (Zingg 0.6.0, Splink is the one we copy); agent hype is met with skepticism.
- r/Rag (78): RAG fails on tables, graphs and structured data; citations from the wrong source recur across r/Rag and r/LLMDevs.
- HN, "problem AI created at your company": review overload and unverifiable submissions ("trust issues in submissions").

### Track 2, explain why and prove it
- r/fintech (70): Barclays built fraud detection that explains itself, and the poster says most fintechs approach this backwards.
- r/mlops (20, 11, 9): "what are banks and insurers using to run LLMs in production, audit friendly", "what does LLM governance mean in practice", "security and compliance for LLM agents in prod". Asked by practitioners, with few answers.
- r/Accounting (277): a KPMG report contained AI hallucinations (bogus case studies). r/artificial (268): a team chased a hallucinated quote through 30,000 training records.
- r/Insurance (28): "AI-generated evidence in claims, is anyone seeing this yet?"; many posts about opaque claim and rate decisions.
- r/ThePeoplesPress and r/healthIT (214, 21): Medicare will require prior authorization from AI for 17 procedures for over 6 million people (a federal pilot; the poster's figures, **NOT VERIFIED**).
- r/MachineLearning (71, 74): an audit of the LoCoMo memory benchmark found 6.4% of the answer key wrong and a judge that accepted up to 63% of intentionally wrong answers; another memory system's perfect-score claim is contradicted by its own benchmark notes. Language-model judges and benchmark claims are not trusted.
- HN, "work problems your company would pay to solve": track the major decisions leaders make and score them over time.

### Track 3, reasoning architecture and reliability
- r/cybersecurity (2,095): an agent (Amazon Kiro) deleted a production environment and caused a 13-hour AWS outage; the poster documented 10 cases of agents destroying systems.
- r/AI_Agents: "I build AI agents for a living. It's a mess out there" (2,479); "Stop building AI agents" (1,631); a client paid to remove the AI (789); "Stop selling autonomous agents to businesses; you are setting yourself up for a lawsuit" (336); "the agent worked perfectly, the team quietly killed it anyway" (153).
- r/LangChain (73): "after 6 months of agent failures in production I stopped blaming the model".
- r/devops (1,132): "our AI-powered incident tool is just calling a ChatGPT API": buyers punish thin wrappers.
- r/LocalLLaMA (1,972): a former Manus backend lead stopped using function calling after two years of building agents.
- HN: "how do you authorize AI agent actions in production" (answers: human in the loop, a policy gateway with no model in the decision path, token exchange, relationship-based access); "how are you monitoring agents" (tracing stacks; the gap named was why the agent deviated from its plan, not only what it did); "AI agent acts, your logs say so, but you wrote the logs".

### Rivals and neighbors in our trust niche (HN "Show HN", 2026; names only, not evaluated)
Agent Auditor (verify signed agent, API and MCP records offline), ActionRail (verify agent actions against live systems of record), a free attestation service for agent decisions, keypost.ai (policy gateway for MCP calls), a small authority gateway with risk scores and policy paths, Joy (trust network for agents). Reading: "a signed record" alone is no longer unique. What none of these claims: reconciling disagreeing sources without overwriting, a mechanical check of every claim against its source text, and rules learned from overrides that provably cannot widen permissions. Each of these needs a teardown before the pitch is final.

### What the voices want, in plain words
1. Agents that do not break things: reversible actions, deterministic policy around the model.
2. A reason for each decision that a regulator, auditor or customer accepts.
3. Sources that agree, with the disagreements shown, not hidden.
4. Evidence that checks itself: no invented quotes, no judge that accepts wrong answers.
5. Narrow tools that finish one job over autonomous everything; buyers distrust wrappers.
