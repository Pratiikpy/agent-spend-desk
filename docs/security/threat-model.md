# Threat model and data handling

Written 2026-10-24, before any real user's logs are read. It says what desk. stores, what leaves the machine, who could reach what, which controls exist and are tested, and what is not covered. Engineering logs of coding agents can expose proprietary source code and operational detail, so this is the first thing a trial user is shown.

## 1. What the product touches

| Asset | Where it is | Sensitivity |
|---|---|---|
| Agent session logs (`~/.claude/projects`) | The user's disk, read-only | High: they hold prompts, code and tool output. desk. keeps almost none of it (section 2) |
| The ledger (`data/desk/ledger.db`) | The user's disk | Medium: usage counts, model names, project folder paths, branch names, edited file paths, commit hashes |
| Git repositories | The user's disk, read with `git` | High; read for commit metadata and changed file names, not content |
| The dossier signing key (`~/.desk/signer.key.pem`) | The user's disk, owner-only permissions | High: signs approvals and dossiers |
| Gate tokens (`DESK_GATE_TOKEN`, `DESK_GATE_OWNER_TOKEN`) | Environment | High: the owner token approves and pauses |
| Model API key (`MODEL_API_KEY` or `NVIDIA_API_KEY`) | `.env`, never committed | High |
| Zetaris credentials | `.env`, never committed | High |

## 2. What is stored, and what never is

Stored in the ledger: per model call, the model name, token counts by bucket, timestamps, tool names, a stop reason, the session id and a request id; per session, the project folder path, the git branch, the tool version; per tool call, its name and a hash of its input; per tool result, the number of characters; per person-prompt, only that one was sent and when; per edit, the path of the file written; per repository, its root path; per commit, the hash, time, changed file names, trailer flags and **a pseudonym of the author** (a truncated hash, never the e-mail address; it hides the address from a reader, but anyone who already knows an address can check it against the hash, so it is minimisation and not anonymity).

Never stored: the text of a prompt, the content of a tool input or result, the content of any file, a commit message, an e-mail address.

Before anything is stored, text taken from a log (folder path, branch, tool version, edited path) has credential-shaped strings masked: the known shapes (OpenAI-style, NVIDIA, GitHub, Slack, AWS, JWT, PEM private-key headers, `Bearer` tokens, `key=value` assignments) become `(redacted)`. Tests: `tests/desk/security.test.ts` plants a key in a working directory, a branch and an edited path and searches every column of every table; `tests/desk/outcomes.test.ts` checks the author pseudonym.

## 3. What leaves the machine

Only model calls leave it, and only to the endpoint the user configured (NVIDIA's API, or Meterless Nightshift on the same machine, which in turn calls NVIDIA). A request carries the question or task and **claims**: figures the code computed, model and tool-version names, dates, short labels for sessions (a folder name cut to plain characters, 60 at most) and the program the Planner wrote. It does not carry prompt text, code, tool output or file contents, because the ledger does not hold them.

Every request passes a mask: credential shapes and the port's own key are replaced before sending. Each request is logged to `data/desk/egress.jsonl` as a host, a role, a size, a hash and the number of secrets masked, never the text; `desk egress` prints the summary. Sample and offline runs send nothing. A secret in a server's error reply is masked before it can reach a trace (tested with a server that echoes the key).

Not sent anywhere by desk.: the ledger, the logs, the dossier key. Zetaris runs on the user's machine in Docker.

## 4. Who could reach what

| Actor | What they could do | Control | Status |
|---|---|---|---|
| A colleague with read access to the user's account | Read the ledger, the key file, `.env` | The signing key is created with owner-only permissions and refused if readable by others (POSIX); `.env` is gitignored; the ledger holds no prompt or code | Ledger and `.env` rest on the operating system's file permissions. **Encryption at rest is not built.** |
| Text inside a log (a hostile branch name, a prompt-injected folder name) | Try to steer the Planner or Explainer | Names are cut to plain characters and capped; the Explainer never reads the question; the Planner produces a typed program that code validates; unknown fields are refused | Names tested; no test drives a live model with a hostile name |
| A compromised dependency | Run code with the user's rights | Two runtime dependencies (`yaml`, `@resvg/resvg-js`); lock file; licence audit planned | No signature or provenance check of installs; **supply-chain verification is not built** |
| Another process on the machine | Call the gate or the UI | Both bind to 127.0.0.1 only; the UI checks the `Host` header; the gate has an agent token and a separate owner token, fails closed, refuses an approval without the echoed digest | Tokens in the environment are visible to same-user processes |
| A network attacker | Reach the UI or gate | Loopback binding only; Nightshift's hotspot is off and Windows Firewall blocks its inbound ports | A user who turns hotspot mode on widens exposure |
| A model that misbehaves | Return wrong or hostile text | The Auditor rejects a figure no claim supports; an Explainer sentence with no support is dropped; budgets are enforced in code | Tested with scripted models |
| A malicious policy file | Widen limits | The restrict-only check refuses an edit that widens the policy in force and prints a counterexample; fuzzed against an oracle | Tested |
| A forged or replayed approval | Release a held action | The approval carries the request id and the action digest, expires, and is decided once | Tested |
| A person reading the card, a screenshot or an export | See paths or secrets | The card redacts credential shapes, high-entropy tokens and absolute paths | Tested for the card; other exports share the same masking only where stated |

## 5. Retention and deletion

`desk forget --project <text>`, `--before <day>` or `--all` removes sessions and everything that hangs off them (calls, costs, tool calls, edits, results, prompts, outcomes, commit links, the log-file cursors, and the repositories and commits for a project or a whole forget), then truncates the write-ahead log and vacuums, so removed text is not left in free pages. Without `--yes` it only says what it would remove. A test searches the database file, its free pages and its write-ahead log for a planted project name after a forget and finds none. `--all` also removes the cards and the egress log.

Not covered: copies the user made of a card, a dossier or a trace; the model provider's own retention of requests already sent (read NVIDIA's terms); recorded replies under `data/sample/`, which come from a constructed sample, not from real logs.

## 6. Team mode (not built): the isolation it must start from

A server for several people is not built. Before it is, these are the rules it is built on, and each needs a test before the feature is claimed.

1. **One ledger file per tenant,** never a shared table with a tenant column. A query cannot cross tenants because it has no handle to another tenant's file.
2. **One signing key per tenant,** so a dossier proves which tenant signed it; keys are never shared and rotation is a signed event.
3. **Roles enforced where data is written,** not only in the interface: viewer, editor, approver, owner. An approver cannot approve their own policy proposal.
4. **Connectors with least privilege:** read-only credentials, stored encrypted, never returned by any API, scoped to one tenant.
5. **Per-person data is opt-in** and shown to the person it describes before a manager sees it.
6. **Audit:** every read of another person's data and every approval is an append-only, hash-chained event.
7. **Deletion works per person and per tenant,** with the same free-page guarantee as above.

## 7. Open items, in the order they should be closed

1. Encryption of the ledger at rest, with the key held by the operating system's store.
2. A test that drives a live model with a hostile log name and checks the plan is unchanged.
3. Install provenance: pin and verify dependencies; generate a software bill of materials.
4. Redaction of the file paths in `ingest_source` where a user's folder name is itself sensitive (the log file's name is a session id, but its directory is the project's).
5. A reviewed list of what each exported artefact (card, dossier, trace, egress log) may contain, with a test per artefact.
6. An external security review of the gate and the dossier (Phase 9).
