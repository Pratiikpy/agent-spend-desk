# Rival teardown: products that verify or gate AI agent actions

Date: 2026-10-18. Found on Hacker News "Show HN" (2026). Read: the ActionRail and rubric-attest READMEs (first pages, via the GitHub API), the public pages of Originary Agent Auditor, whatdidmyagentdo.com and keypost.ai (via a text proxy), and the Joy post. Not read: ActionRail's full docs, any rival's source code, tests or customers. Star counts and licences are from the GitHub API on the same day. Everything not read is **NOT VERIFIED**. No code was copied; ideas only unless a licence is noted.

## 1. The rivals

| Rival | What it is | Licence, activity | What it checks | What it says it does not check |
|---|---|---|---|---|
| ActionRail (ToolJet) | Runtime gate: before an agent's tool call runs, each argument is grounded against your live system of record; returns allow, hold for human, or block. Python, LangGraph adapter, beta | Apache-2.0, 37 stars, pushed 2026-08 | That an argument's value is right now, against live data (for example a refund on an already-refunded order) | Documents and free text, several disagreeing sources, and learning from overrides were not seen in the pages read |
| rubric-attest (Rubric Protocol) | Tamper-evident receipts for agent decisions: free to attest, $0.10 to verify over x402. SHA3-256 over JCS, per-agent chains, Merkle proofs, post-quantum threshold signatures, anchored to Hedera, offline verifier `@tenprint/verify` | Apache-2.0, 0 stars, pushed 2026-10 | That a decision record existed and was not altered | Its own stated limits: the signing federation is three regions run by Rubric, so it does not protect against the operator; the payload never leaves the client, so the content is not checked |
| Originary Agent Auditor (PEAC records) | Browser and CLI verifier for signed records: Ed25519 over compact JWS, strict I-JSON input, small-order key denylist, replay guard, HTTP message signatures, inclusion proofs | open CLI (`@peac/cli` 0.16.4); licence **NOT VERIFIED** | Signature valid, bytes unchanged | Its page lists as "not checked": whether the key belongs to the issuer, whether every related event was recorded, whether a policy or legal requirement was satisfied |
| whatdidmyagentdo.com (Originary) | Checker that scores whether pasted logs are independently verifiable | open source per the page | Evidence structure, heuristic score | States that a valid signature does not assert the claims inside are true |
| Keypost | In-path policy proxy for MCP: access control, parameter constraints, time windows, DLP and PII scans, rate limits, cost caps; swap one URL; claims under 2 ms policy overhead and over 10,000 requests per second (vendor figures, not tested) | commercial; licence **NOT VERIFIED** | Whether a call is permitted by deterministic policy | Not whether the values are right or the evidence supports them |
| Joy | Peer vouching and trust scores between agents | **NOT VERIFIED** | Reputation from past collaborations | Not decisions or evidence |

## 2. The pattern

Every rival says in its own words that a valid signature or an allowed call does not mean the claim is true. The gap is the content: are the facts right, do the sources agree, does each quote exist in its source, and can the system learn a rule without becoming looser. ActionRail is the closest, since it checks values against a live source, but it checks one system of record at a time; the others sign or gate.

## 3. What we take

1. **Say what is not checked, in the product.** PEAC and whatdidmyagentdo list "not checked" items on the page. Our dossier and verifier print a "what this verifies and what it does not" panel.
2. **Recheck against live state at release time** (ActionRail): the Release Broker rereads the governing facts at the moment of release, not only at decision time.
3. **Strict verifier hygiene** (PEAC): strict I-JSON input, a small-order key denylist and an optional replay guard, in addition to our RFC 8785 plus COSE or JWS plan.
4. **A verify-it-yourself command with a bundled sample** (`npx @tenprint/verify --example` in rubric-attest): the README gets one command that verifies a bundled dossier and one that must fail on a bundled tampered dossier.
5. **Honest limits written first** (rubric-attest): our README states what the signature does not prove, for example that the operator is not independent.
6. **Parameter constraints, time windows and DLP as release-gate policy** (Keypost), and a one-URL integration path for MCP tool calls so the product can sit in front of other people's agents.

## 4. Where we are ahead, and what must be proved

- Reconcile several disagreeing sources without overwriting any (none of the rivals claims this).
- A mechanical check that every claim's quote exists in its source, with a published false-accept rate.
- Rules learned from human overrides that provably cannot widen permissions.
- A dossier whose content a stranger can verify offline, not only its signature.

Each of these is a design claim until its PRD gate passes. The rivals may add pieces of this; re-run this teardown before the pitch is final.

## 5. Not done

No rival was installed or run; full documentation was not read; Keypost and Originary licences were not checked; no rival team was contacted.
