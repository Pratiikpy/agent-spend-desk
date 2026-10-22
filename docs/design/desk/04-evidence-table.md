# Evidence table for the Desk documents

Every demand, competitor and counter claim cited by number in `00-architecture-master-spec.md`, `02-feature-list.md` and `03-product-requirements.md`, reproduced from the research database so that a reader of this repository can check it. Each row gives the claim id used in the documents, the source URL and the date it was fetched, and the exact words recorded from the page. **No quote here was re-opened after it was recorded** (the final re-open round did not run), so every quote is as first captured and may have changed on the live page. A row marked NOT VERIFIED is flagged in the database and carries no weight.

Claims listed: 146. Kinds: fact, inference or guess as recorded.

| Claim | Kind | Source (fetched) | Recorded quote or statement | Status |
|---|---|---|---|---|
| 52 | fact | https://github.com/anthropics/claude-code/issues/16157 (2026-10-20) | Did not use Claude Code for three days. Never hit usage limits in the last three months. Now hitting usage limits after 2 hours of continous usage. | not re-opened |
| 53 | fact | https://github.com/anthropics/claude-code/issues/38335 (2026-10-20) | the 5-hour session window on Claude Max plan is being exhausted abnormally fast when using Claude via the CLI (Claude Code). | not re-opened |
| 54 | fact | https://github.com/openai/codex/issues/28879 (2026-10-20) | my ChatGPT Plus Codex budget drains in 2–3 prompts on `gpt-5.5`, where the same model/plan/app previously gave 20+ prompts. | not re-opened |
| 55 | fact | https://github.com/openai/codex/issues/14593 (2026-10-20) | Am I the only one still seeing my tokens burning very fast following today's extension update? | not re-opened |
| 56 | fact | https://news.ycombinator.com/item?id=47586176 (2026-10-20) | semi-quietly reduce limits while keeping the price the same | not re-opened |
| 57 | fact | https://news.ycombinator.com/item?id=47586176 (2026-10-20) | I was shocked to see after the last prompt that I had somehow hit my limit until 5:00pm. | not re-opened |
| 60 | fact | https://www.reddit.com/r/ClaudeCode/comments/1vyff2x/is_something_wrong_with_claude_code_usage_limits/ (2026-10-20) | I'm seeing **17.5M cache read tokens and 11M cache write tokens**, which seems unusually high. | not re-opened |
| 61 | fact | https://github.com/openai/codex/issues/23794 (2026-10-20) | I cannot tell when a thread is getting close to compaction, context pressure, or possible context loss. | not re-opened |
| 62 | fact | https://github.com/anthropics/claude-code/issues/42796 (2026-10-20) | essentially -- starting in February, we have noticed a degradation performing complex engineering tasks. | not re-opened |
| 63 | fact | https://github.com/anthropics/claude-code/issues/42796 (2026-10-20) | Claude has regressed to the point it cannot be trusted to perform complex engineering. | not re-opened |
| 117 | fact | https://github.com/mksglu/context-mode (2026-10-20) | And when the agent compacts the conversation to free space, it forgets which files it was editing, what tasks are in progress, and what you last asked for. | not re-opened |
| 118 | fact | https://github.com/anthropics/claude-code/issues/34556 (2026-10-20) | Claude Code has no persistent memory between context compactions. | not re-opened |
| 119 | fact | https://github.com/anthropics/claude-code/issues/34556 (2026-10-20) | After 59 documented compactions across 26 days of daily use, I built a complete memory persistence system from scratch because one didn't exist. | not re-opened |
| 120 | fact | https://github.com/anthropics/claude-code/issues/19471 (2026-10-20) | CLAUDE.md instructions completely ignored after context compaction | not re-opened |
| 136 | fact | https://news.ycombinator.com/item?id=46810282 (2026-10-20) | Claude Code daily benchmarks for degradation tracking | not re-opened |
| 514 | fact | https://arxiv.org/abs/2604.22750 (2026-10-20) | runs on the same task can differ by up to 30x in total tokens | not re-opened |
| 654 | fact | https://github.com/anthropics/claude-code/issues/38335 (2026-10-20) | [BUG] Claude Max plan session limits exhausted abnormally fast since March 23, 2026 (CLI usage) | not re-opened |
| 655 | fact | https://github.com/anthropics/claude-code/issues/16157 (2026-10-20) | [BUG] Instantly hitting usage limits with Max subscription | not re-opened |
| 656 | fact | https://www.reddit.com/r/ClaudeCode/comments/1uv6ns4/dear_anthropic_this_has_to_stop/ (2026-10-20) | Every day, we have to keep checking our limits and worrying about whether | not re-opened |
| 657 | fact | https://www.reddit.com/r/ClaudeAI/comments/1vx0k69/lifting_the_curtain_the_max_x5_and_max_x20_usage/ (2026-10-20) | The observation that Max20 is at best a little over x2 (compared to Max5) on your weekly limit did not change. | not re-opened |
| 658 | fact | https://www.reddit.com/r/ClaudeAI/comments/1vx0k69/lifting_the_curtain_the_max_x5_and_max_x20_usage/ (2026-10-20) | recording usage automatically by using the fact that the CLI reports session + weekly usage % every turn | not re-opened |
| 659 | fact | https://news.ycombinator.com/item?id=47559293 (2026-10-20) | everything shows up as aggregate usage. Total tokens, total cost, maybe per model. | not re-opened |
| 702 | fact | https://www.reddit.com/r/ClaudeAI/comments/1t11mmy/i_accidentally_burned_6000_of_claude_usage/ (2026-10-20) | The dashboard has a multi-day reporting lag, so I had no idea anything was wrong until the limit email landed. | not re-opened |
| 749 | fact | https://qiita.com/blogjiraiya377/items/12dbfb4f8344885bbe68 (2026-10-20) | 料金の約6割は、AIが書いた分ではなく、会話の履歴の読み直しでした。 | not re-opened |
| 953 | fact | https://hacker-news.firebaseio.com/v0/item/46810282.json (2026-10-20) | "descendants":354 | not re-opened |
| 969 | fact | https://github.com/ninjahawk/livenerf (2026-10-20) | Nobody has had a clean day-0 baseline to check against | not re-opened |
| 980 | fact | https://capitalandcompute.net/blog/how-to-tell-if-claude-is-nerfed/ (2026-10-20) | A dip on one day, or even one window, is not a nerf under the rule. | not re-opened |
| 1074 | fact | https://nz.trustpilot.com/review/manus.im (2026-10-20) | Those credits were also consumed attempting to fix existing problems. | not re-opened |
| 1076 | fact | https://nz.trustpilot.com/review/manus.im (2026-10-20) | they refused to refund the entire amount spent. | not re-opened |
| 1077 | fact | https://www.trustpilot.com/review/replit.com (2026-10-20) | Replit repeatedly crashed and consumed credits while its Agent looped through attempts to fix errors it had introduced. | not re-opened |
| 1079 | fact | https://www.trustpilot.com/review/cursor.com (2026-10-20) | Instead of having a flexible month limit, there's now a week limit, a quota, and it's just it just sucks. | not re-opened |
| 1081 | fact | https://www.trustpilot.com/review/cursor.com (2026-10-20) | used Claude for just 10 minutes, and 30% of my fast credits vanished instantly. | not re-opened |
| 1088 | fact | https://preuve.ai/blog/manus-ai-review (2026-10-20) | it's too late, you can only cancel to not be charged the next time. | not re-opened |
| 1133 | fact | https://zenn.dev/ojisan_ai_lab/articles/claude-code-idle-compaction-20261019 (2026-10-20) | 55.6分後、その会話は13,522トークンまで圧縮されていました。 | not re-opened |
| 1134 | fact | https://zenn.dev/ojisan_ai_lab/articles/claude-code-idle-compaction-20261019 (2026-10-20) | 圧縮のあと、Claude Code はこの会話で最近読んだファイル5本を読み直しています。 | not re-opened |
| 1153 | fact | https://forum.cursor.com/t/167153 (2026-10-20) | I use this Usage window closely to keep tabs on my daily/active spending | not re-opened |
| 1154 | fact | https://forum.cursor.com/t/167153 (2026-10-20) | Today, the $$ amount is replaced by token amount which is completely useless. | not re-opened |
| 1165 | fact | https://community.openai.com/t/1378663 (2026-10-20) | The system stops immediately (hard stop) | not re-opened |
| 1166 | fact | https://community.openai.com/t/1378663 (2026-10-20) | The agent cannot checkpoint progress | not re-opened |
| 1167 | fact | https://community.openai.com/t/1378663 (2026-10-20) | no visibility into remaining usage | not re-opened |
| 1168 | fact | https://www.reddit.com/r/cursor/comments/1t2gjtl/cursor_silently_switched_models_while_i_was_deep/ (2026-10-20) | My session silently routed to a different model path. | not re-opened |
| 1169 | fact | https://www.reddit.com/r/cursor/comments/1t2gjtl/cursor_silently_switched_models_while_i_was_deep/ (2026-10-20) | I did not checkpoint that progress early enough with git commits. | not re-opened |
| 1187 | fact | https://community.openai.com/t/1381431 (2026-10-20) | I cannot find a clear way in the Codex web/app interface to see how many tokens were consumed by a specific Codex conversation, task, or run. | not re-opened |
| 1272 | fact | https://www.itworld.co.kr/article/4190247/%ec%bd%94%eb%94%a9-%ec%97%90%ec%9d%b4%ec%a0%84%ed%8a%b8-%ec%93%b8%ec%88%98%eb%a1%9d-%ec%bb%a4%ec%a7%80%eb%8a%94-%ed%86%a0%ed%81%b0-%eb%b9%84%ec%9a%a9-%ec%9d%b8%ea%b1%b4%eb%b9%84-%ec%a7%80%ec%b6%9c.html (2026-10-20) | 티야기는 기업이 AI 코딩 에이전트를 실험 단계에서 대규모 배포 단계로 빠르게 전환하고 있지만, 토큰 비용을 과소평가하는 경우가 여전히 많다고 지적했다. | not re-opened |
| 1275 | fact | https://horadecodar.com.br/claude-code-limits/ (2026-10-20) | Sua vigésima pergunta não custa o que uma pergunta custa, ela custa a pergunta MAIS todo o acumulado da conversa até ali | not re-opened |
| 1277 | fact | https://dev.classmethod.jp/articles/claude-code-keep-sessions-short/ (2026-10-20) | Claude Code はすべてのリクエストで完全な会話を送信し | not re-opened |
| 1290 | fact | https://redresscompliance.com/microsoft-copilot-adoption-2026 (2026-10-20) | Plan for sustained weekly active use of 30 to 55 percent of purchased seats in the first year. | not re-opened |
| 1291 | fact | https://redresscompliance.com/microsoft-copilot-adoption-2026 (2026-10-20) | Three causes come up again and again: users were never told which task Copilot should change | not re-opened |
| 1292 | fact | https://redresscompliance.com/microsoft-copilot-adoption-2026 (2026-10-20) | Every assigned seat bills at list whether or not the user opens Copilot | not re-opened |
| 1293 | fact | https://www.toriihq.com/articles/seven-tools-to-manage-microsoft-365-copilot-licenses-and-spend (2026-10-20) | Companies are paying for licenses nobody opens. | not re-opened |
| 1294 | fact | https://www.toriihq.com/articles/seven-tools-to-manage-microsoft-365-copilot-licenses-and-spend (2026-10-20) | The native Copilot Dashboard shows who holds a seat, but it never shows what you spend or which licenses to pull back. | not re-opened |
| 1412 | fact | https://community.crewai.com/t/7726 (2026-10-20) | N agents each independently deciding to spend money, with no shared awareness of a budget across the crew | not re-opened |
| 1413 | fact | https://community.crewai.com/t/7568 (2026-10-20) | no native way to cap what a crew spends before it runs | not re-opened |
| 1557 | fact | https://github.com/crewAIInc/crewAI/issues/5802 (2026-10-20) | A retry of the same logical tool call should return the original result without re-executing the side effect. | not re-opened |
| 1558 | fact | https://github.com/langchain-ai/langgraph/issues/7417 (2026-10-20) | it gets silently re-dispatched from the last checkpoint while the original is still running | not re-opened |
| 1559 | fact | https://community.crewai.com/t/at-least-once-tool-calls-retries-can-double-fire-your-side-effecting-tools-in-a-crew/7697 (2026-10-20) | when an agent retries a tool call, non-idempotent tools double-fire | not re-opened |
| 1560 | fact | https://current.tinyfish.ai/issue/31/practitioners-corner/article/18051/retries-were-built-for-a-deterministic-world (2026-10-20) | an agent double-charge a test customer $847 because the Stripe API call timed out | not re-opened |
| 1561 | fact | https://tianpan.co/blog/2026-07-05-the-idempotency-key-your-agent-forgot-to-send (2026-10-20) | The catch is that the first call already succeeded. | not re-opened |
| 1562 | fact | https://github.com/modelcontextprotocol/modelcontextprotocol/issues/3394 (2026-10-20) | 2 external effects for 1 logical operation | not re-opened |
| 1603 | fact | https://github.com/anthropics/claude-code/issues/46829 (2026-10-20) | silently changed the prompt cache TTL default from 1 hour to 5 minutes | not re-opened |
| 1604 | fact | https://www.theregister.com/2026/04/13/claude_code_cache_confusion/ (2026-10-20) | if you leave your computer for over an hour then continue a stale session, it's often a full cache miss. | not re-opened |
| 1605 | fact | https://propakistani.pk/2026/10/16/claude-reportedly-resets-your-cache-to-charge-you-more/ (2026-10-20) | Changing models causes Claude Code to read the entire conversation history again with no cache hits. | not re-opened |
| 1606 | fact | https://startdebugging.net/ja/2026/09/claude-code-now-names-the-likely-cause-of-a-prompt-cache-miss/ (2026-10-20) | 見えるのは遅い 1 ターンと請求額だけです。 | not re-opened |
| 1607 | fact | https://www.80aj.com/2026/04/25/claude-code-cache-bug/ (2026-10-20) | 大量重复上下文被反复计费，致使 API 费用在一小时内激增至 200 美元 | not re-opened |
| 1608 | fact | https://smartscope.blog/blog/claude-code-token-consumption-cache-bug/ (2026-10-20) | 残量の減り方だけではキャッシュバグと断定できない。 | not re-opened |
| 1720 | fact | https://qiita.com/yitaya/items/f1130fc860b33ef37016 (2026-10-20) | 日本語の指示を最軽量モデルで英訳し、以降の作業を英語で行い、最終回答だけ日本語で返す | not re-opened |
| 1724 | fact | https://tianpan.co/blog/2026/07/02/the-tokenizer-tax-and-the-locale-quality-gap (2026-10-20) | A 2x fertility language means 2x input cost and 2x output cost for the same conversation, forever. | not re-opened |
| 1735 | fact | https://www.v2ex.com/t/1249920 (2026-10-20) | 然后直接被 CC 截断，然后偷懒根本就不读全文，就开始继续往下干 | not re-opened |
| 1736 | fact | https://codex.danielvaughan.com/2026/08/29/agents-dont-paginate-first-chunk-selection-tool-response-codex-cli/ (2026-10-20) | Across every over-budget tool response observed, the count of agent-initiated pagination requests was zero. | not re-opened |
| 1737 | fact | https://codex.danielvaughan.com/2026/08/29/agents-dont-paginate-first-chunk-selection-tool-response-codex-cli/ (2026-10-20) | The truncation at step E happens silently inside the framework. | not re-opened |
| 1738 | fact | https://www.agentpatterns.ai/tool-engineering/graceful-tool-output-truncation/ (2026-10-20) | the agent treated the preview as the complete file, rules in the un-read portion were silently absent from context, and no signal reached the operator | not re-opened |
| 1739 | fact | https://github.com/anthropics/claude-code/issues/82606 (2026-10-20) | large rg/grep outputs have long tokens lossily rewritten in tool results | not re-opened |
| 1754 | fact | https://habr.com/ru/articles/1004994/ (2026-10-20) | Compaction освобождает место, но не гарантирует сохранность workflow state | not re-opened |
| 1964 | fact | https://benjamincongdon.me/blog/2026/04/29/Tokenmaxxing-is-Goodharting/ (2026-10-20) | ceases to be a useful metric | not re-opened |
| 1967 | fact | https://www.hcamag.com/au/news/general/amazon-shuts-down-ai-leaderboard-after-tokenmaxxing/577191 (2026-10-20) | The trouble, according to the report, was that the leaderboard rewarded volume over value. | not re-opened |
| 1970 | fact | https://www.latent.space/p/unsupervised-learning-2026 (2026-10-20) | They don’t care about the quality. | not re-opened |
| 1990 | fact | https://www.v2ex.com/t/1243519 (2026-10-20) | 不确定的副作用永远不自动重试 | not re-opened |
| 2044 | fact | https://lemmy.ml/post/42699840 (2026-10-20) | Made some adjustments based on lessons learned. Combined: roughly 200-400x cheaper heartbeat operation. | not re-opened |
| 2173 | fact | https://arxiv.org/abs/2606.13003 (2026-10-20) | consistently underperform CoT-SC despite being up to 10x more expensive | not re-opened |
| 2176 | fact | https://hackernoon.com/why-adding-more-ai-agents-doesnt-always-make-your-system-smarter (2026-10-20) | many reported MAS gains are better explained by compute and context effects than by inherent architectural superiority. | not re-opened |
| 2191 | fact | https://hackernoon.com/why-adding-more-ai-agents-doesnt-always-make-your-system-smarter (2026-10-20) | token usage by itself explains 80% of the variance | not re-opened |
| 2274 | fact | https://www.ifanr.com/1657675 (2026-10-20) | 有人实测单次心跳消耗高达 17 到 21 万 Token，而且触发频率有时会远超设定的间隔。 | not re-opened |
| 2275 | fact | https://www.ithome.com/0/930/011.htm (2026-10-20) | 一晚上烧掉近 30 元 | not re-opened |
| 2276 | fact | https://global.hk01.com/%E6%95%B0%E7%A0%81%E7%94%9F%E6%B4%BB/60329715/openclaw%E7%88%86%E5%8D%B8%E8%A3%85%E9%BE%99%E8%99%BE%E6%BD%AE-%E5%AE%89%E5%85%A8%E6%88%90%E7%96%91%E5%A4%96%E6%97%A5%E7%83%A7-150%E5%85%83token%E8%B4%B9-%E5%85%BB%E4%B8%8D%E8%B5%B7 (2026-10-20) | 有人才开著几小时，帐单就烧了过千元！ | not re-opened |
| 2277 | fact | https://www.ithome.com/0/930/011.htm (2026-10-20) | 短短一周 API 账单就飙升 3000 多元 | not re-opened |
| 2324 | fact | https://www.reddit.com/r/developersIndia/comments/1wps41c/ (2026-10-20) | keeps a background/orphaned agent running, or lets auto top-up refill your credits all night. | not re-opened |
| 2334 | fact | https://api.juejin.cn/search_api/v1/search?aid=2608&uuid=7&spider=0&query=Claude%20Code%20%E9%A2%9D%E5%BA%A6%20%E6%B6%88%E8%80%97%E5%A4%AA%E5%BF%AB&id_type=0&cursor=0&limit=15&search_type=0&sort_type=0&version=1 (2026-10-20) | 你买了 3 个 Claude 账户，以为能用 15 小时，实际只用到 5~6 小时 | not re-opened |
| 2335 | fact | https://api.juejin.cn/search_api/v1/search?aid=2608&uuid=7&spider=0&query=Claude%20Code%20%E9%A2%9D%E5%BA%A6%20%E6%B6%88%E8%80%97%E5%A4%AA%E5%BF%AB&id_type=0&cursor=0&limit=15&search_type=0&sort_type=0&version=1 (2026-10-20) | 我用 AI 编程工具之后，最先遇到的并不是模型不够用，而是订阅越来越碎。 | not re-opened |
| 2337 | fact | https://github.com/Wei-Shaw/claude-relay-service (2026-10-20) | 让 Claude、OpenAI、Gemini、Droid 订阅统一接入，支持拼车共享，更高效分摊成本 | not re-opened |
| 2338 | fact | https://github.com/Licoy/Quosparr (2026-10-20) | track Codex, Claude Code and Grok quotas, resets, API-equivalent cost and local sessions, with multi-account and API relay switching | not re-opened |
| 2339 | fact | https://github.com/Folkbench/folkbench (2026-10-20) | Open-source AI API relay benchmark, rankings & switcher for Claude Code / Codex | not re-opened |
| 2340 | fact | https://www.reddit.com/r/developpeurs/comments/1qkwff5/ (2026-10-20) | Je dois avoir 4 ou 5 abonnement et ça suffit toujours pas | not re-opened |
| 2341 | fact | https://www.reddit.com/r/brdev/comments/1vls9p5/ (2026-10-20) | Atualmente estamos rachando uma única conta do Claude entre nós | not re-opened |
| 2555 | fact | https://uiuret.hatenablog.com/entry/2026/02/22/024509 (2026-10-20) | 最近AIをやりすぎている。自分でもわかるくらい頭がおかしくなっている。 | not re-opened |
| 2556 | fact | https://uiuret.hatenablog.com/entry/2026/02/22/024509 (2026-10-20) | 現在だと常時3~5並列でAIエージェントを動かして仕事をしている | not re-opened |
| 2557 | fact | https://uiuret.hatenablog.com/entry/2026/02/22/024509 (2026-10-20) | 夜寝たい時間になってベッドに入っても興奮は収まらずに数時間は寝付けないことが多い。 | not re-opened |
| 2559 | fact | https://note.com/erukiti/n/n20daf914bac1 (2026-10-20) | 「判断」が、大量に高速に、そして強度の高く、常に求められるようになった。 | not re-opened |
| 2560 | fact | https://note.com/erukiti/n/n20daf914bac1 (2026-10-20) | 何かしらの対策を打たない限り今年は、メンタルを壊す人が増えるだろう。 | not re-opened |
| 2561 | fact | https://caddi.tech/2026/04/07/110000 (2026-10-20) | これらを並列で実行しているのが辛い | not re-opened |
| 2562 | fact | https://caddi.tech/2026/04/07/110000 (2026-10-20) | AIエージェントのタスク完了まで面倒を見るのが辛い | not re-opened |
| 2563 | fact | https://caddi.tech/2026/04/07/110000 (2026-10-20) | 設計とPRレビューのボトルネック化 | not re-opened |
| 2564 | fact | https://hbr.org/2026/02/ai-doesnt-reduce-work-it-intensifies-it (2026-10-20) | AI Doesn’t Reduce Work—It Intensifies It | not re-opened |
| 2565 | fact | https://www.ptt.cc/bbs/Tech_Job/M.1785240246.A.C43.html (2026-10-20) | 看code啊 他寫這麼快 理解根本跟不上 | not re-opened |
| 2582 | fact | https://www.reddit.com/r/developpeurs/comments/1ree504/les_développeurs_qui_utilisent_abusivement_de_lia/ (2026-10-20) | Enjoy your burnout. | not re-opened |
| 2583 | fact | https://www.reddit.com/r/developpeurs/comments/1qp5a6c/fatiguée_du_manque_de_qualité/ (2026-10-20) | J'ai commencé cette boîte il y a 3 mois et je suis à l'aube d'un burnout. | not re-opened |
| 2584 | fact | https://www.reddit.com/r/developpeurs/comments/1unyavv/lia_ma_volé_mon_job/ (2026-10-20) | Le métier que je connaissais disparait au profit d'un métier où je passe mon temps à lire des trucs produit par l'IA et à corriger/review du code écrit par l'IA. | not re-opened |
| 2595 | fact | https://type.jp/et/feature/31834/ (2026-10-20) | AIでコード生成は加速、でも人間の確認が追いつかない問題 | not re-opened |
| 2596 | fact | https://type.jp/et/feature/31834/ (2026-10-20) | 大量に生まれたコードの正しさを誰が判断するのか。 | not re-opened |
| 2598 | fact | https://raw.githubusercontent.com/thechangelog/transcripts/master/news/changelog-news-179.md (2026-10-20) | A good day can give you maybe 3 to 4 hours of deep, focused coding. | not re-opened |
| 2775 | fact | https://www.clien.net/service/board/park/19277423 (2026-10-20) | 어쩌다 보니 GPT Pro100에 클로드 Team 계정 두 개까지 사용하고 있습니다. | not re-opened |
| 2776 | fact | https://www.clien.net/service/board/park/19277423 (2026-10-20) | 처음에는 GPT만 썼는데, 클로드에 비해 결과가 아쉬운 작업도 있었고 사용량 때문에 버거울 때도 있더군요. | not re-opened |
| 2784 | fact | https://www.clien.net/service/board/park/19277293 (2026-10-20) | 코덱스가 아스트라 기준 크레딧이 너무 달달 녹아서 | not re-opened |
| 2845 | fact | https://www.clien.net/service/search?q=%ED%81%B4%EB%A1%9C%EB%93%9C+%EC%BD%94%EB%93%9C&sort=recency&boardCd=&isBoard=false (2026-10-20) | 클로드코드와 ChatGPT 서로 알아서 대화하게 만드는 방법 없나요? | not re-opened |
| 2846 | fact | https://www.clien.net/service/search?q=AI+%EC%97%90%EC%9D%B4%EC%A0%84%ED%8A%B8&sort=recency&boardCd=&isBoard=false (2026-10-20) | GPT 코덱스 서브에이전트 간 컨텍스트 캐시 재사용 | not re-opened |
| 2870 | fact | https://discuss.ai.google.dev/t/stuck-for-60-days-with-19-000-bill-due-to-gemini-privilege-escalation-on-a-legacy-2018-maps-key-case-id-72347951/179135 (2026-10-20) | Stuck for 60 days with $19,000 bill due to Gemini privilege escalation on a legacy 2018 Maps key | not re-opened |
| 2871 | fact | https://discuss.ai.google.dev/t/stuck-for-60-days-with-19-000-bill-due-to-gemini-privilege-escalation-on-a-legacy-2018-maps-key-case-id-72347951/179135 (2026-10-20) | we are stuck in a loop of agents asking for "5 to 7 more business days" to get a response from leadership | not re-opened |
| 2872 | fact | https://discuss.ai.google.dev/t/unrestricted-api-key-ai-studio-silently-enabled-gemini-14k-bill-on-a-small-family-brazilian-tire-shop/170943 (2026-10-20) | Over 600k Gemini API calls were made using that old 2021 key | not re-opened |
| 2873 | fact | https://discuss.ai.google.dev/t/unrestricted-api-key-ai-studio-silently-enabled-gemini-14k-bill-on-a-small-family-brazilian-tire-shop/170943 (2026-10-20) | the billing data took 10 hours to appear, and I only received an automated "suspicious activity" alert 2 hours after the attack | not re-opened |
| 2874 | fact | https://hackmag.com/news/gemini-api-key (2026-10-20) | Google secures the platform, while users are responsible for protecting their own keys. | not re-opened |
| 2875 | fact | https://hackmag.com/news/gemini-api-key (2026-10-20) | 82,314 in charges, mainly using the Gemini 3 Pro Image and Gemini 3 Pro Text models. | not re-opened |
| 3107 | fact | https://www.microsoft.com/en-us/research/?p=1170556 (2026-10-20) | runs on the same task can differ by up to 30x in total tokens | not re-opened |
| 3172 | fact | https://community.crewai.com/t/multi-agent-crews-and-runaway-spend-anyone-solved-delegation-without-a-shared-budget-ceiling/7726 (2026-10-20) | I've got N agents each independently deciding to spend money, with no shared awareness of a budget across the crew. | not re-opened |
| 3174 | fact | https://community.crewai.com/t/multi-agent-crews-and-runaway-spend-anyone-solved-delegation-without-a-shared-budget-ceiling/7726 (2026-10-20) | the budget control is always going to be somewhat advisory. | not re-opened |
| 3175 | fact | https://community.crewai.com/t/multi-agent-crews-and-runaway-spend-anyone-solved-delegation-without-a-shared-budget-ceiling/7726 (2026-10-20) | a ceiling tells you when the crew has spent enough and says nothing about which calls it needed. | not re-opened |
| 3176 | fact | https://arxiv.org/abs/2606.04056v1 (2026-10-20) | a catalog of 63 confirmed production incidents from 21 orchestration frameworks (2023-2026) | not re-opened |
| 3177 | fact | https://github.com/EmanueleCell4/agent-budget-benchmark (2026-10-20) | A gateway that reserves budget before a call and only releases it when the call *completes* normally will keep phantom spend on the books for aborted calls | not re-opened |
| 3395 | fact | https://code.claude.com/docs/en/costs (2026-10-20) | The figure is an estimate, so for authoritative billing see the Usage page | not re-opened |
| 3396 | fact | https://code.claude.com/docs/en/costs (2026-10-20) | Usage inside the seat allowance isn't metered in dollars. | not re-opened |
| 3400 | fact | https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor (2026-10-20) | pushed 2026-07-05T04:52:21Z | not re-opened |
| 3401 | fact | https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor (2026-10-20) | fix: Claude 5 model recognition, Opus 5 pricing, and P90 limit legibility | not re-opened |
| 3402 | fact | https://github.com/Maciek-roboblog/Claude-Code-Usage-Monitor (2026-10-20) | fix(reader): keep the complete record when a message spans several JSONL lines | not re-opened |
| 3403 | fact | https://github.com/ccusage/ccusage (2026-10-20) | 19082 stars pushed 2026-10-20T03:35:27Z | not re-opened |
| 3405 | guess | none recorded | Pausing a run needs a per-tool hook; tools without a pause API cannot be paused, so the headline wow beat works only on tools with hooks. Not tested. | NOT VERIFIED |
| 3406 | guess | none recorded | No fetched evidence that a forecast from task text beats a very wide interval for a stochastic agent; the pre-run forecast could be correct only by being useless-wide. | NOT VERIFIED |
| 3465 | fact | https://code.claude.com/docs/en/statusline (2026-10-20) | Percentage of the 5-hour or 7-day rate limit consumed, from 0 to 100 | not re-opened |
| 3466 | fact | https://code.claude.com/docs/en/hooks (2026-10-20) | After the session's model changes, including changes Claude Code makes on its own, such as restoring the model when you resume a session | not re-opened |
| 3467 | fact | https://code.claude.com/docs/en/hooks (2026-10-20) | quota_auto_resume_fired, quota_auto_resume_stale, quota_auto_resume_disabled | not re-opened |
| 3468 | fact | https://code.claude.com/docs/en/settings-reference (2026-10-20) | Wait in the open session and [continue the task automatically](/docs/en/interactive-mode#wait-for-a-usage-limit-to-reset) after a claude.ai usage limit resets | not re-opened |
| 3470 | fact | https://hn.algolia.com/api/v1/search?query=claude%20code%20usage%20limit&tags=story&hitsPerPage=8 (2026-10-20) | Show HN: Claumon - forecasting Claude Code usage limits with a Gamma process | not re-opened |
| 3472 | fact | https://github.com/search?q=claude+code+usage&type=repositories (2026-10-20) | Windows taskbar widget for Claude Code, Codex, Cursor and more. Track usage limits and reset times. Free and open source. | not re-opened |
| 3758 | fact | https://ai-startups.dealroom.co/news/feed/mintlify-acquires-open-source-ai-observability-platform-helicone (2026-10-20) | Mintlify has acquired Helicone, an open-source LLM observability platform and AI gateway. | not re-opened |
| 3760 | fact | https://helicone.ai/ (2026-10-20) | Helicone is no longer part of Mintlify. Details to come soon. | not re-opened |
| 3769 | fact | https://claude.com/blog/giving-admins-more-visibility-and-control-over-claude-usage-and-spend (2026-10-20) | Spend-threshold alerts notify admins at 75% and 90% of an org-level spend limit | not re-opened |
| 3770 | fact | https://claude.com/blog/giving-admins-more-visibility-and-control-over-claude-usage-and-spend (2026-10-20) | Every formula is visible in the tab, and the inputs are adjustable. | not re-opened |
| 3771 | fact | https://langfuse.com/changelog/2026-06-19-monitors.md (2026-10-20) | Catch a quality drop when an evaluation score falls below your bar. | not re-opened |
| 3774 | fact | https://vantaige.io/ai-tool/helicone (2026-10-20) | Teams choosing Helicone today are choosing a product in wind-down | not re-opened |
