# Redaction at read, and the egress manifest (2026-10-25)

Features DF-073 and DF-074 built. They answer two questions a trial user asks first: can a secret in my logs end up somewhere it should not, and where can this thing send my data.

## Redaction at read (DF-073)

Text from a log that the ledger keeps (the working folder, the branch, the tool version, an edited path) now passes three rules before it is written: the provider and credential shapes the card already knew, an exact value the port is told is secret, and, new, **a long random-looking word**. A word ends at a slash, dot, colon or space, so a path keeps its shape and the ledger can still find the repository. It is masked only when it is at least 24 characters, at least 4.5 bits per character, and mixes letters with digits; a hash (hex only), an id in the shape of a UUID and an ordinary long identifier are not. A dash is part of a word, so a URL-safe token that contains dashes is not cut into pieces too short to test. The rule is applied to what is stored, not to what is sent to a model: a general entropy rule over a message would mangle ids that a question needs.

Checked against the real ledger on this machine (39 distinct folder, branch and version strings, 15,033 distinct edited paths): the rule changes none of them, so it does not mangle ordinary data. That is also the limit of the check: this ledger holds no random-looking secret, so it shows no false masks, not that every real secret would be caught.

### The planted-secret gate

`tests/desk/security-e2e.test.ts` plants one credential in a session's working folder, branch and edited path, builds a sample around it and then looks for it, byte for byte, in everything the product writes or serves: the card text and card files, the ledger file with its write-ahead log, every screen the interface serves (brief, bill, autopsy, sessions, the session itself, outcomes, sources, evidence, silos, and now overhead, week, policy, canary, dossiers and an Ask answer), the bill exported as CSV and as JSON, the signed month dossier built from a month that holds the planted calls (6 calls, asserted), and the trace of an Ask run together with every request that run made to a model (the planner was asked, asserted). None contains it. The session itself is in the ledger with the credential masked.

What this gate cannot show: the month dossier carries no per-session rows, so the dossier check proves the credential did not travel into the figures and claims, not that a row-level field would have been masked.

## The egress manifest (DF-074)

`src/desk/security/net.ts` holds the destinations this product's own code may connect to, and a `fetch` that cannot reach anywhere else. Each call site builds its fetch from the one destination it is configured with: the model endpoint (`MODEL_BASE_URL`), the Zetaris instance (`ZETARIS_REST_URL`), the upstream a gateway forwards to, the lab proxy's upstream, and a webhook named with `--webhook`. A request to any other origin (another port, another scheme, a look-alike host, a non-http address) is refused before a socket is opened (`E_EGRESS_UNDECLARED`), and so is the following of a redirect, which a server could use to move a request somewhere nobody declared. The gate's hook client sends its bearer token only to a loopback address. `DESK_MODEL_PROFILE=local` allows only destinations on this machine, declared or not.

`desk egress manifest` and the Sources screen ("Where data can leave this machine") show the declared destinations, what is sent to each, whether it is on this machine, and the egress log's totals (requests, bytes, masked secrets), never a request's text.

### What ran

- `tests/desk/net.test.ts` (18): addresses and loopback; a declared destination reached; an undeclared one refused with **no connection seen by a listening server**; other port, scheme, look-alike host and non-http address refused; a redirect to an undeclared server not followed (the trap saw no connection); the local profile; the manifest text; and each call site: the model port (reached and logged as sent; redirect refused; local profile refuses a remote endpoint at once, once, without a retry and without logging it as sent), Zetaris (refused, key not in the message), the gate client (token to this machine only), an alert webhook.
- A static check over `src/` that lists every file that can open a connection by itself and fails on one that is not named, with its reason, in the test: today the guard, the hook client, the browser page, and the two files that talk to stand-in servers they start on loopback.
- `tests/desk/egress-monitor.test.ts` (4): a preload records every socket a Node process tries to open and every name it looks up, at the call and before a packet is sent. Controls show it sees what it should (a local connection is recorded; an attempt at a reserved documentation address is recorded as not on this machine). Then the card, the demonstration and an Ask, run offline on the sample, open **no connection to another machine**; and a model endpoint that is not on this machine is refused by the guard with no socket and no lookup.
- `tests/desk/ui/server.test.ts` and `tests/desk/ui/sources-egress.test.ts`: the Sources view lists destinations from the settings, marks refused ones in the local profile, and carries no request text.

### Defects found on the way

- The model port wrote an egress-log line for a request before it was made, so a refused request would have been logged as sent. The line is now written when the request goes out.
- A refused destination was caught as a network error and retried with a back-off. It is now a non-retryable error that names the address.
- The interface never read `.env`, and its Services card looked for `NVIDIA_*` names only, so on a machine configured the usual way it said "not configured" while the commands were configured. The interface now loads `.env` like the commands, and a service counts as configured under either set of names.
- A first draft of the static allowlist named a file that does not exist; the check for stale entries caught it.

### Not covered

- **Only the Desk's own code is guarded.** A tool the Desk watches, `claude -p` when `desk enforcement test --live` runs it, and a program you name with `--notify-command` make their own connections.
- The monitor hooks Node's `net` and `dns` modules in the process it is loaded into. A native addon, or a child process that opens a socket, is not seen.
- The monitor test runs the card, the demonstration and an Ask, not every command; the static check is what covers the rest, by naming every file that can connect.
- A webhook's destination is declared by the flag that names it, so the guard enforces the profile and the redirect rule for it, not a second list.
- Zetaris is reached by its own port; a Zetaris instance on another machine is a declared destination like any other, and is refused only in the local profile.
