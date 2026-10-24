# OpenCode reader, checked against the Lab's own accounting (2026-10-24)

`desk ingest --agent opencode` reads OpenCode's database (`~/.local/share/opencode/opencode.db` by default) into the ledger. One finished assistant message is one model call: provider, model, time, finish reason, and input, output, reasoning, cache-read and cache-write tokens. Tool names are taken from the message's tool parts; no message text, tool input or tool output is stored. The file is opened read-only, the reader names the three tables it uses (`session`, `message`, `part`), and it never selects from the account and credential tables the database also holds. Ledger schema version 6 allows the new source kind.

## What was read, and what it showed

- The real database on this machine (OpenCode 1.15.6, written in May 2026): 109 messages, 74 finished model calls, 12 sessions. 70 of the 74 had no reasoning tokens to check; in the 4 that did, the message's own step totals confirm that OpenCode counts reasoning apart from output (`total` = input + output + reasoning + cache read + write). The ledger therefore stores output as output plus reasoning, as Claude Code's logs do, and does that only when the step totals do not contradict it.
- All 74 calls are unpriced: they went through NVIDIA, Kilo, Cloudflare and one OpenAI model, and the price book holds first-party Anthropic prices only. A model reached through another provider is stored as `provider/model` so a first-party price is never applied to it.

## The reader against an independent count

The Lab runs OpenCode behind an accounting proxy, so for each Lab run there are two independent counts of the same calls: the agent's own database, and what the proxy saw on the wire. For the 7 finished spike runs on this machine:

| Compared | Result |
|---|---|
| Calls, prompt tokens (input + cache), completion tokens (output + reasoning) per run | **7 of 7 equal, to the token**, once one call per run is set aside |

The call set aside is OpenCode's own title call: a small request at the start of every session (799 to 997 prompt tokens, 389 to 1,866 completion tokens on Nemotron) that OpenCode does not store as a message. It is invisible in the agent's database and was 16% to 60% of a run's completion tokens in these runs. A reader of OpenCode's database alone undercounts every session by that call; the proxy does not. One run had a further call the endpoint answered with no usage (an empty reply, retried by the proxy), which has no tokens on either side. The check is `node scripts/lab-reconcile-opencode.ts data/lab/spike-d1 <work folder>`.

## Not covered

One OpenCode version for the real database (1.15.6) and one for the Lab runs (1.17.13); other versions may store tokens differently, **NOT VERIFIED**. Only Nemotron, kimi, minimax and a few free models were seen, none priced, so the dollar path for OpenCode rests on the Claude Code and Codex tests, not on an OpenCode invoice. OpenCode's own `cost` field is kept on the parsed call and not stored in the ledger; it was 0 for 73 of 74 calls here. The title call is not recoverable from the database, so a ledger built only from it is low by that call for every session. Gemini CLI, Cline, Copilot and Cursor have no reader.
