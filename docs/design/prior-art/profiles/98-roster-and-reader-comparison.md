# Roster and reader comparison (profile pass of 2026-10-16)

Every row is one repository, the module it was read for, who read it (agy is the Gemini CLI in plan mode; Haiku is the small Claude model at low effort), and the outcome. The reviewer (Claude, main session, which is also the session that wrote the verdicts, so this is not an independent check) spot-checked at least three cited facts per profile against the code and wrote or corrected every verdict; for profiles 42, 43, 51, 52, 53, 54 and 55 the checks covered licence, identity and file existence only, and the rest of those profiles is the reader's account. Local clones live under `research/` (gitignored); GitHub-only repositories were shallow clones in a temporary folder and were deleted after reading.

| # | Repository | Read for | Reader | Verdict |
|---|---|---|---|---|
| 01 | mem0ai/mem0 | M6 | Haiku | adapt |
| 02 | getzep/graphiti | M3, M6 | see header | adapt |
| 03 | dzhng/deep-research | M4 | Haiku | adapt |
| 04 | agiresearch/A-mem | M6 | Haiku | adapt |
| 05 | noahshinn/reflexion | M5, M6 | Haiku | adapt |
| 06 | gusye1234/nano-graphrag | M3, M6 | Haiku | adapt |
| 07 | langchain-ai/langgraph | M7 | see header | adapt |
| 08 | topoteretes/cognee | M3, M6 | see header | adapt |
| 09 | letta-ai/letta (landing page) | M6, M10 | agy | reject; see 48 |
| 10 | AkariAsai/self-rag | M5 | Haiku | adapt idea |
| 11 | princeton-nlp/ALCE | M4, M11 | Haiku | adopt metrics, adapt checker |
| 12 | shmsw25/FActScore | M4, M5 | Haiku | adapt |
| 13 | microsoft/autogen | M4, M5, M10 | agy | adapt |
| 14 | crewAIInc/crewAI | M4, M5, M6 | agy | adapt, reject delegation by string |
| 15 | openai/openai-agents-python | M5, M10 | agy | adapt, reject registry |
| 16 | princeton-nlp/tree-of-thought-llm | M4, M5 | Haiku | adapt |
| 17 | ReConcile | M3, M5 | Haiku | adapt |
| 18 | llm_multiagent_debate | M5 | Haiku | reference only, no licence |
| 19 | google-deepmind/long-form-factuality | M4, M5 | Haiku | adapt |
| 20 | joonspk-research/generative_agents | M6 | Haiku | adapt |
| 21 | ragas | M11 | Haiku | adapt, outside cross-check |
| 22 | langchain-ai/langmem | M6 | Haiku | adapt |
| 23 | langchain-ai/open_deep_research | M4 | Haiku | adapt |
| 24 | zilliztech/deep-searcher | M1, M2, M4 | Haiku | adapt |
| 25 | stanford-oval/WikiChat | M4 | Haiku | adapt |
| 26 | microsoft/graphrag | M3, M6 | agy | adapt |
| 27 | NirDiamant/Agent_Memory_Techniques | M6 | Haiku | reference, checklist |
| 28 | assafelovic/gpt-researcher | M4 | Haiku | adapt |
| 29 | TauricResearch/TradingAgents | M5, M6 | Haiku | adapt |
| 30 | AI4Finance/FinRobot | M1, audit | Haiku | adapt, strong match |
| 31 | Alibaba-NLP/DeepResearch | M4 | Haiku | adapt |
| 32 | ClinicalAgents-Code | M5 | Haiku | reference only, no licence |
| 33 | meterless/meterless | M6, M12 | Haiku | adopt specs |
| 34 | deepset-ai/haystack | M7, M1, M8 | agy | adapt |
| 35 | run-llama/llama_index | M1, M2, M6 | agy | adapt |
| 36 | stanford-oval/storm | M4 | agy | adapt |
| 37 | infiniflow/ragflow | M1, M2 | Haiku | adopt connector contract |
| 38 | vectimus/vectimus | M5, M8 | Haiku | adapt, close precedent |
| 39 | FoundationAgents/MetaGPT | M4, M10 | Haiku | adapt |
| 40 | bytedance/deer-flow | M4, M7 | Haiku | adapt |
| 41 | browser-use/browser-use | M1, M8 | Haiku | adapt |
| 42 | VectifyAI/PageIndex | M2 | Haiku | adapt |
| 43 | headroomlabs-ai/headroom | M7 | Haiku | adapt reversible markers |
| 44 | OSU-NLP-Group/HippoRAG | M6, M3 | agy | adapt |
| 45 | HKUDS/LightRAG | M6, M3 | agy | adapt |
| 46 | thedotmack/claude-mem | M6, M1, M8 | Haiku | adopt patterns |
| 47 | OpenHands/OpenHands (front end) | M5, M9 | Haiku | adapt event model; engine not read |
| 48 | letta-ai/letta-code | M6, M10 | agy | adapt |
| 49 | NousResearch/hermes-agent | M6, M13, M10 | agy | adapt; gate design is a negative example |
| 50 | vectorize-io/hindsight | M6 | agy | adapt |
| 51 | mastra-ai/mastra | M7, M13 | Haiku | adapt; TypeScript comparison |
| 52 | langgenius/dify | M7, M13 | Haiku | reference only (licence) |
| 53 | n8n-io/n8n | M1, M13 | Haiku | reference only (licence) |
| 54 | firecrawl/firecrawl | M1 | Haiku | reference only (AGPL) |
| 55 | bilawalsidhu/gods-eye-view | M10 | Haiku | adapt information architecture |
| 56 | openclaw/openclaw (sparse: src, docs, security) | M5, M13, M10, M7 | agy | adapt; approval binding is the closest precedent |

Not profiled, with reasons: the OpenClaw extensions, apps and skills directories (profile 56 covers the gateway, approvals, scheduler and docs only); `awesome-language-agents` (a curated list, nothing to read; used as a pointer list); `Agent-Reach` (installed on this machine and described in prior-art file 02). Not read: the OpenHands agent server and runtime (separate repositories), and the sponsor products Gaia, Relay and Swarms (binaries).

## Reader comparison (what the pass showed)

Both readers were accurate on facts that could be checked in one place (licences, file names, defaults, whether a file exists). Neither could be trusted on a verdict.

- **agy** (Gemini CLI, plan mode, local files only): 3 to 9 minutes per repository, 700 to 970 words, line citations on almost every claim, sharper on traps and on what the code does not do. Corrections needed were mostly wording; one wrong default (LightRAG top-k values) and one missing "documented, not silent" distinction. It refuses to guess: it wrote NOT VERIFIED where it could not read (the Letta landing page, commit dates). It needs explicit instructions to use no shell and no URL, otherwise it returns empty output.
- **Haiku** (low effort, capped tool calls): 1 to 2.5 minutes per repository, about 70 to 110 thousand tokens each, fast and cheap in wall time. It was wrong on defaults or formulas in several profiles (Self-RAG threshold, FActScore length penalty, ReConcile confidence buckets, DeepSearcher parser handling, LangMem dependency licence, generative-agents key handling) and sometimes called a logged fallback silent. Its verdict sections were the least reliable part.
- **Rule adopted:** the reader extracts; the reviewer writes every verdict and checks at least three cited facts; anything not read is NOT VERIFIED; a reader's own NOT VERIFIED marks are kept.
- **Cost note:** agy uses the Google quota and was run three at a time; Haiku subagents were run five at a time. Together the 56 profiles took one working session.

## Findings that changed the design (see `99`)

Several profiled repositories swallow errors or substitute defaults (register P-1 lists them; some only log); one agent SDK runs its input checks in parallel with tools by default and only on the first agent (profile 15); one popular agent runtime ships an approval gate that is off by default and fails open (profile 49); one retrieval method attaches invented facts to real ones by a zero cutoff; several vendors quote numbers that describe a different build. Each is a rule in `99` section A and a test in the PRD.
