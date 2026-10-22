# Module 01: Source Fabric and the Zetaris Silo Port

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Zetaris is now the primary path for internal sources, not an optional sponsor profile: REST at the local install (bearer API key, `X-Org-ID`, per-request UUID `X-Request-ID`, `POST /sql-editor/sqls/run`), typed views only, outside web APIs registered as tables, files placed where the Zetaris server can reach. The embedded store is the fallback when Zetaris is absent. (Setup Guide, D-018.)
- Candidate source for the hero pack: the Zetaris Unified Semantic Layer as one governed vendor view across ERP, contracts, payments and registry sample, provenance per source kept; gated by an ablation (D-024). NOT VERIFIED until an instance runs.
- Add from the repository study (D-017, D-020): browser channel for sources with no API (browser-use pattern), Composio-style tool connectors with authentication, the doctor with fix prescriptions, capability discovery in a SKILL.md, headless-first operation.


## Integration revision (2026-10-13)

Source: `99-integration-register.md` (pass 2). The blueprint below now states the resolved design; sections the register does not touch are unchanged.

**Applied** (id: what changed, where):
- INT-003: three digest kinds. `requestKey`, `parsedHash`, `contractHash`, `fileSetHash`, `indexHash`, `manifestHash`, `RoutingPlan.version` are `DocHash`; `bodyHash`, blob keys, `termsHash` are `RawHash`; the account mask and any non-public `bodyHash` are `Commitment`. Section 1 types; components 2, 5, 6, 11c, 11i, 12.
- INT-006: `LicenceStatus`, `SiloRole`, `FetchState`, `WriteOrigin` and `Evidence` come from conventions; `Evidence.use`, `resolver` and typed `erased` / `cassette_miss{reason}` errors added; `isDecisionAdmissible` derived from `use`. Section 1; components 5, 8, 11h, 17.
- INT-008: `SiloRole` is the shared data-access identity; M13's `RbacRole` maps to one role through a data table M1 accepts as input. Component 12.
- INT-019: M8 owns the compartment mechanism and claim; M1's in-process guard is a second control and never the claim; "network denied" appears only beside the probed backend. Component 6, Spec feedback 2.
- INT-020: one network port, `ctx.net` (M8, `ports/egress.ts`); M1 decides how to fetch, M8 whether it may leave; one `send` per hop; manifest schema is M8's with `disclosureProfile`. Components 2, 6, 10, 22.
- INT-021: names are declared disclosure parameters that leave only in minimised form (identifier when one exists); `identifier_only` and `offline` kept as profiles. Components 10, 18.
- INT-023: query construction is deterministic by default; the LLM discovery role is conditional on M14's ablation. Component 18.
- INT-024: `last_write_origin` (shared `WriteOrigin`), `last_write_actor`, `last_write_at`, `change_request_id`, `request_origin`, `editor_sub` in the silo contract, planted by M11; missing column is `UNTRUSTED`. Components 8, 12, 17.
- INT-040: `erase` is a request to the M9 erasure service and returns its receipt hash; replay of an erased entry is `cassette_miss{reason: "erased"}`. Component 5.
- INT-041: new channel 11j (document intake) with three fixed-label sources and a `documents` view; M2 receives a `DocumentRef`. Components list, 11j, 12.
- INT-042: two cassette layers with a defined contract; `cassette_miss` is class `fatal`; virtual clock selects versions; `entriesRoot` for the M9 bundle. Component 6, Spec feedback 1.
- INT-043: blobs live in the one shared store behind `StorePort` (addressed by `RawHash`, partitioned by class); M1 keeps metadata only. Component 5.
- INT-045: wording already matched; Spec feedback 4 marked resolved. INT-046: M1 owns and publishes the silo contract at a stable path; M11 reads it. Components 12, 17. INT-056: `NetPort`, `FsPort`, `StorePort` come from M7/M8, not from M1. Section 1, component 22.
- Interface matrix 2.1 (no INT id): `requiredChannels` and `origins.json` per pack (M1 to M3); `SiloPort.version(view)` and the `ofac.listVersion` feed (M1 to M13). Components 8, 11c, 12, 18.
- Applied by consequence, not naming M1: INT-010 (the hashed OFAC index stores integer document frequencies, no floats); INT-048 (cassette manifest and cache root carry the tenant, `tn_default` on the judge path); INT-004 (`resolver` and `doc` locator in the evidence builder).

**Named M1 but not applied:** INT-044 (no edit: the `cassette_miss` hint already prints the live command); INT-062 (h) and INT-065 items for SF3, SF7 and SF10 (spec-text corrections; the design already states them, items marked resolved).

**New contradictions found:**
1. `NetPort` (register 2.2) returns `hops`, which suggests the port follows redirects, and `CallCtl` has no carrier for M1's connect-time address policy. Here: redirects off, one `send` per hop, policy object passed in `ctl`. M7 and M8 must confirm.
2. INT-041 gives intake evidence `bodyHash: RawHash`; INT-003 and INT-006 require `Commitment` above `public`; and `Locator.docSha` is a `RawHash`, which would expose the plain digest of a non-public document in a bundle. Here: `Commitment` plus an internal store key. M2 and M9 must decide `docSha` for non-public documents.
3. INT-006 (`erased` is a `FetchError` kind) and INT-040 (`CassetteMiss{reason: erased}`) overlap. Here: cache or store reads give `erased`, replay gives `cassette_miss{reason: "erased"}`. M7 should adopt both.
4. `jcs:`, `sha256:` and `com:` prefixes contain a colon, invalid in Windows file names. M1 uses the hex part in paths; M7 and M9 stores must do the same.
5. The account `Commitment` must be one function shared by M1's `salted_hash` mask and `ReleaseBinding.accountCommit` (M8, M13), and its salt is per deployment here but per tenant under INT-048.
6. `SourceMeta.rate` carries fractional requests per second in a manifest that is hashed and drift-checked (INT-010 forbids floats there). Not changed here; needs an integer scale.

Status: design blueprint. Nothing here is built or measured; every design claim is a hypothesis with a named test. Refines spec v3.1 sections 6 and 19 (and the M1 parts of sections 4, 5, 16, 21). Conventions, shared types and the document template are in `00-conventions-and-shared-types.md`. Probes and file reads dated 2026-10-13.

## 1. Scope and contract

**Job.** Give every other module typed, replayable, policy-bounded access to two kinds of source: **public channels** (GLEIF, SEC EDGAR, OFAC SDN, Wikidata, CourtListener, RSS, direct web fetch, Jina Reader for discovery, a simulated account-verification channel) and **internal silos** (ERP vendor master, contracts and payments, document lake index, employee-adjacent attributes) read through the `SiloPort`, which has a Zetaris implementation (REST, JDBC bridge, MCP fallback) and an embedded file-backed implementation with the same schema and role rules.

**Inputs.** Typed queries built from labelled values (`SubjectRef`, `SubQuestion`, channel query records); run configuration (mode, profile, budgets); the pack's authority table, silo contract and rights registry (data files, JCS-hashed).

**Outputs.** `FetchOutcome` values carrying `Evidence` (shared type) or a typed failure plus `coverage`; `RoutingPlan` traces (F-DISCOVER); doctor reports; egress manifest entries (M8 schema); cassettes; silo results with audit witnesses; `DocumentRef` blob references for M2 (11j). Nothing leaves M1 as free text.

**Spec sections refined.** 6 (channels, evidence record, fetch states, authority, authorship, rights gate, MCP client), 19 (Zetaris candidates, minimum viable integration), 21 F-DISCOVER, F-DOWNLOAD, F-SAMPLE, F-PERSONS, F-ZROLE, F-DATAREADME.

**Depends on.** M7 ports (`ctx.clock`, `ctx.rng`, `ctx.ids`, `ctx.tools`, `ctx.fs` (`FsPort`), `ctx.net` (`NetPort`), `StorePort` for blobs, budgets, trace). M7 declares `NetPort` and `FsPort`; M8 implements the network port in `ports/egress.ts` (INT-020, INT-056). M8 owns the trust lattice (`combine`), the permission matrix and the egress manifest schema; M9 owns the erasure service; M1 owns the (source, attribute, producer) to level table's *data* and the function that applies it.

**Depended on by.** M2 (document blob references from 11j), M3 (assertions from Evidence, authority tables, silo rows), M4 (L0 re-checks locators against stored bodies), M5 (SOR facts, coverage), M9 (evidence blobs, cassette manifests, egress manifest), M12 (Zetaris adapter proof, audit cross-check), M13 (broker re-reads release fields through the `broker` role; TOCTOU re-screen through the `ofac.listVersion` feed and `SiloPort.version`), M11 (fault injection, generators).

**Types introduced here** (everything else is from the conventions file):

```ts
// Shared, from conventions (INT-006, INT-008): LicenceStatus (termsHash is a RawHash of the normalised terms text; SPDX id or
// "LicenseRef-Plumbline-Unverified"), FetchState, Evidence, Locator, WriteOrigin, SiloRole. M1 introduces only the following.
type FetchError =
  | { kind: "blocked_by_policy"; rule: "allowlist" | "scheme" | "port" | "userinfo" | "ssrf_literal" | "ssrf_resolved" | "redirect" | "size" | "content_type" | "robots" | "egress_class" | "sample_mode_egress" | "rights" | "personal" }
  | { kind: "rate_limited"; retryAfterMs: number | null; window: string; budgetExhausted: boolean }
  | { kind: "auth_required" | "forbidden" | "not_found" | "gone" }
  | { kind: "upstream_error"; status: number }
  | { kind: "timeout" | "network" | "tls" | "challenge_page" | "empty_unexpected" }
  | { kind: "parse_error"; parserVersion: string; bodyHash: RawHash; at: string }
  | { kind: "cassette_miss"; reason: "absent" | "erased"; requestKey: DocHash; nearest: string[]; hint: string }   // replay only; ErrorClass fatal (INT-042)
  | { kind: "erased"; bodyHash: RawHash; receipt: Hash }                          // cache or store read of a body removed by the M9 erasure service (INT-006, INT-040)
  | { kind: "contract_drift"; expected: DocHash; observed: DocHash; diff: string[] }
  | { kind: "tool_surface_changed"; expected: DocHash; observed: DocHash }
  | { kind: "needs_human"; reason: "input_required" | "elicitation" };
interface Coverage { checked: string; method: string; versionTag: string | null; excludes: string[]; limits: string[] } // absence is not falsity
interface FetchOutcome<R> { state: FetchState; evidence: Evidence[]; error?: FetchError; coverage: Coverage; attempt: AttemptRecord; value?: R }
interface AttemptRecord { channel: string; requestKey: DocHash; servedFrom: ServedFrom; attempts: number; bytes: number; durationMs: number; rateWaitMs: number; bodyHash?: RawHash }
type ServedFrom = "network" | "cache_fresh" | "cache_revalidated" | "cache_stale_if_error" | "run_memo" | "cassette";
interface ListVersion { publishDate: string; fileSetHash: DocHash; observed: { folderDate: string; lastModified: string; etag: string };
                        recordCountDeclared: number; recordCountObserved: number | null }   // 11c; also served as a feed
```

## 2. Component list

1. Channel contract and registry
2. Request identity and the transport policy pipeline (allowlist, SSRF with DNS pinning, redirects, size caps, response classification)
3. Rate limiting and retry policy
4. Structured credential redaction
5. Evidence builder, evidence and index stores, blobs through `StorePort`
6. Cassette record and replay, SAMPLE_MODE egress guard
7. Doctor and canary probes
8. Authority tables, authorship, self-declared tier, trust assignment
9. Rights gate and licence metadata
10. Egress manifest entries, disclosure profiles and label hand-off to the egress funnel (M8)
11. Connectors: 11a GLEIF, 11b SEC EDGAR, 11c OFAC SDN with a locally generated index, 11d Wikidata, 11e CourtListener, 11f RSS, 11g direct web fetch, 11h Jina Reader, 11i simulated account verification, 11j document intake
12. SiloPort, typed data contract, role-scoped views
13. Zetaris REST transport (decoder and fault injection)
14. Zetaris JDBC bridge
15. Zetaris MCP client (fallback)
16. Audit-log cross-check
17. Embedded silo store
18. Source discovery and routing (F-DISCOVER)

## 3. References register (what was read; later components cite these ids)

Metadata from `gh api` on 2026-10-13 unless stated; "read" means the named file was read this session, otherwise the item is from a prior-art file.

| Id | Item | Licence / meta | What we read | What its evaluation does not show |
|---|---|---|---|---|
| R1 | Agent Reach (clone outside the repo, commit `a19a171`, 02 §1.10) | MIT | `utils/url.py`, `utils/text.py`, `channels/web.py`, `channels/base.py` read; rest via 02 §1 | No fetch layer for structured data; SSRF gate has no DNS step; no cassettes (02 §0) |
| R2 | LlamaIndex (`research/track-1-fragmented-intelligence/llama_index`) | MIT | `selectors/llm_selectors.py` read; ingestion cache via 02 §2 | Selector quality; the LLM selector has no failure branch beyond a parse error |
| R3 | Haystack (`research/.../haystack`) | Apache-2.0 | `components/routers/conditional_router.py` header read; fetcher via 02 §3 | Routing correctness; no SSRF defence (02 §3.4) |
| R4 | `nodejs/undici` | MIT, 7,709 stars, pushed 2026-10-13 | `docs/docs/api/Client.md` (`connect`, `maxResponseSize`, `autoSelectFamily`), `lib/interceptor/decompress.js` (`maxSize` default 0 = unlimited), `lib/interceptor/redirect.js` | Behaviour under our proxy-less setup; `connect.lookup` pass-through to `net.connect` is stated by the doc ("every tls.connect() option") and not exercised |
| R5 | `azu/request-filtering-agent` | MIT, 28 stars, pushed 2026-09-29 | `src/request-filtering-agent.ts` read in full: wraps `lookup`, validates every returned address (`all: true`) with `ipaddr.js` `range() === "unicast"`, also checks literal-IP hosts | Built for `http.Agent`, not undici; small user base |
| R6 | `stripe/smokescreen` | MIT, 1,363 stars, pushed 2026-10-12 | README: hostname ACL per role, resolves each name and requires a publicly routable address, allow/deny ranges, DNS timeout | Go; proxy, not an in-process library |
| R7 | OWASP SSRF Prevention Cheat Sheet | fetched | allowlist first; bind the connection to the validated IP while keeping Host and SNI; disable redirect following or re-validate; "treat parser disagreement as a rejection" | Summarised by the fetch tool |
| R8 | IANA IPv4 and IPv6 special-purpose registries | fetched | columns incl. "Globally Reachable"; IPv4-mapped, 6to4, Teredo, ULA, link-local are not globally reachable; NAT64 `64:ff9b::/96` is marked reachable (and embeds an IPv4 address) | Registry contents change |
| R9 | `kevin1024/vcrpy` | MIT, 3,021 stars | `vcr/cassette.py`, `record_mode.py`, `config.py` read: modes `all/any/new_episodes/none/once`; `none` is strict replay; default `match_on` is method, scheme, host, port, path, query (no body, no headers); each recorded response plays once unless `allow_playback_repeats` | Python; no content addressing; no integrity check |
| R10 | `npm/cacache` | ISC (LICENSE.md; GitHub shows NOASSERTION), 301 stars | `lib/content/path.js`: `content-v2/<alg>/<ab>/<cd>/<rest>`; README: lockless, verified reads, index separate from content | Windows crash behaviour |
| R11 | `moov-io/watchman` | Apache-2.0, 512 stars | `pkg/sources/ofac/download.go` (URL template, files `sdn.csv add.csv alt.csv sdn_comments.csv`), `reader.go` (per-file hash, concatenated into `ListHash`, merges comment spill-over), `docs/cache-data-files.md` (refresh 12 h, S3 redirects, cache proxy with stale serving) | Match quality (that is bake-off 3) |
| R12 | `dgunning/edgartools` | MIT, 2,786 stars | `edgar/httpclient.py`, `httprequests.py` (header greps): per-host cache rules, ~9 req/s throttle, "revalidation consumes rate limit", identity must be set, retry 1 s to 60 s, SSL errors not retried | Not a design for evidence |
| R13 | Jina Reader (`jina-ai/reader`) | Apache-2.0, 12,146 stars, pushed 2026-05-22 | README (fetched): page cache lifetime 3,600 s unless `x-no-cache`; anonymous traffic most aggressively limited; data retention not stated | Retention, accuracy of its markdown |
| R14 | Vendor and source pages fetched | n/a | SEC fair access (10 req/s, declared User-Agent, no botnets); GLEIF LEI Data Terms (CC0, "provided by Third Parties", no numeric rate limit); Wikimedia User-Agent policy (descriptive agent with contact, no browser mimicry); CourtListener v4 docs (token auth, 5/min, 50/h, 125/day, rolling windows); Node 22 permission docs; RFC 5861 `stale-if-error` | RFC 9110 Retry-After text could not be fetched (fetch tool truncation): its form is **NOT VERIFIED** here |
| R15 | Node 22 permission model | docs fetched | stable since v22.13; flags `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`; **no network flag** | Installed Node is 22.17.0 |
| R16 | Probes (mine) | observed | GLEIF record shape and relationships; OFAC export set and sizes; Wikidata ids | Point in time |
| R17 | Dong, Saha, Srivastava, "Less is More: Selecting Sources Wisely for Integration", PVLDB 6(2), 2013 | pages 1 to 2 read | integrating more sources can lower fused quality; select sources by marginal gain against marginal cost | Their accuracy estimates need ground truth we declare instead |
| R18 | MCP: spec revision and `modelcontextprotocol/typescript-sdk` | 13,571 stars; licence file says transition MIT to Apache-2.0, mixed | 12 §10.1 (spec facts, MCPTox 10 §A10); SDK files read: `shared/transport.ts` (`FetchLike`, redirect helpers), `client/client.ts` (`listChanged`, `jsonSchemaValidator`) | Whether `StreamableHTTPClientTransport` accepts an injected `fetch`: NOT VERIFIED |
| R19 | Zetaris docs readout and integration notes | `docs/sponsors/` | REST/JDBC facts, string-typed results, `LOAD USL`, DQ, grants, no audit read path (readout §2) | No account was used; every behaviour is documented text |
| R20 | nomenklatura, FollowTheMoney, yente (07 §1.3); BODS 0.4 (07 §3.3); provenance semirings and PROV-O (07 §4) | MIT / MIT / MIT; BODS NOASSERTION | per-statement storage, judgement edges, five source types | Company-attribute coverage is thin |
| R21 | `substrait-io/substrait` (Apache-2.0), `apache/calcite` (Apache-2.0), `sqlancer/sqlancer` (MIT), `bitol-io/open-data-contract-standard` (Apache-2.0), `NaturalIntelligence/fast-xml-parser` (MIT), `inikulin/parse5` (MIT), `adaltas/node-csv` (MIT) | metadata only | **not read**; used only to name alternatives | No behavioural claim is made about them |

## 4. Component 1: channel contract and registry

**References.** R1 `channels/base.py`; R3 component contract (02 §3.2); R2 `ResourcesReaderMixin` (02 §2.2).

**What they do.** R1's `Channel` has `can_handle` and `check` only; `active_backend` lives on a module-level singleton and `check()` mutates it (read in `base.py`), so state is shared between runs. Overrides only reorder backends. R3 builds typed sockets from `run` signatures at class creation and refuses mismatches, which is a constructor-time conformance check. R2 splits "enumerate, describe, fetch one".

**Decision.** Adapt. Keep R1's ordered backends, "active only by proof", reorder-only overrides; keep R3's construction-time conformance; drop shared mutable state; add typed results, metadata and licence. Reject copying R1's `can_handle`-only contract because nothing could be fetched through it.

**Design.**

```ts
interface SourceMeta {
  id: string; title: string; tier: 0 | 1 | 2;                   // 0 keyless, 1 key or declared identity, 2 needs setup
  evidenceUse: "decision" | "discovery";                         // jina is "discovery"
  termsUrl: string; licence: LicenceStatus;
  auth: { kind: "none" | "user_agent" | "token"; envVar?: string; uaPattern?: string };
  rate: { documentedMaxRps?: number; ourBudgetRps: number; burst: number;
          windows?: { seconds: number; max: number }[]; source: "documented" | "observed" | "unknown"; docUrl?: string };
  allowed: { origin: string; pathPrefixes: string[]; methods: ("GET"|"HEAD")[]; redirectTo?: { hostSuffix: string; pathPrefix: string }[] }[];
  queryKeys: Record<string, string[]>;                           // per path prefix: closed set of query parameter names
  expectedContentTypes: string[]; maxBodyBytes: number; maxDecodedBytes: number;
  timeouts: { connectMs: number; headersMs: number; bodyMs: number; totalMs: number };
  freshness: { ttlSeconds: number; staleIfErrorSeconds: number }; // application policy, see component 5
  emptyMeaning: "not_found" | "suspect" | "valid_no_match";
  egress: EgressEntryRef[];                                      // refs into M8's EgressEntry manifest (INT-020)
  notVerified: string[];
}
interface SourceChannel<Q, R> {
  readonly meta: SourceMeta; readonly backends: readonly BackendDecl[];
  canHandle(s: SubjectRef, attribute: AttrId): { ok: boolean; why: string };   // pure, never substring matching
  buildRequest(q: Q): Result<PlannedRequest, FetchError>;                         // pure; only labelled params accepted
  parse(res: RawExchange): Result<ParsedRecords<R>, FetchError>;                  // pure, versioned
  readonly parserVersion: string; readonly canaries: Canary[];
}
```

Backend selection is per run: `ChannelState` is created by the registry for each run (no singletons). `activeBackend` is set only by a probe whose `evidence` is `executed` or `replayed`. Override `SOURCE_<ID>_BACKEND` (environment beats file; documented; unknown names produce a doctor warning, never silence; reorder only).

Registry construction runs the conformance checks: unique ids; `ourBudgetRps <= documentedMaxRps / 2` when documented; every allowed origin is `https`; `queryKeys` present for every path prefix; `licence` complete; `canHandle` returns a boolean for a 200-case URL fuzz corpus including AR's lookalike set (`x.com.evil.test`, `x.com@evil.test`, bad ports, trailing dot, upper case); `parse` is pure (called twice on the same bytes, equal output); each channel ships at least one canary and one golden parse. Failure of any check aborts startup (no silent degradation).

**Tests.** `SF-REG-01..06` registry conformance; `SF-REG-07` a channel mutated to share state between two runs fails a concurrency test (two runs, interleaved probes, no leak of `activeBackend`); `SF-REG-08` override ordering property test (result is always a permutation).

**Risks.** Over-specified metadata may rot; `notVerified` is surfaced by the doctor so rot is visible.

**Build notes.** First; unblocks everything. Contract tests of `prior-art/02` §6.8 group 1 and 2.

## 5. Component 2: request identity and transport policy pipeline

**References.** R1 (`url.py`, `web.py`), R4, R5, R6, R7, R8, R12, R14, R15.

**What they do.** R1 `normalize_public_http_url` rejects control characters, userinfo, `%` in hosts, a block list of names, single-label hosts, and non-global literal IPs including legacy IPv4 spellings via `inet_aton`; it never resolves DNS and never validates redirects, which is acceptable only because Jina does the fetch (read in `web.py`: the request goes to `r.jina.ai/<url>`). Its web channel also sends a browser User-Agent. R5 validates inside the `lookup` the socket itself uses, for every returned address, so check and connect cannot disagree (no rebinding window). R6 applies a per-role hostname ACL, then resolves and requires public addresses. R7 states the same three rules plus "disable redirect following". R4 gives `connect` (custom lookup), `maxResponseSize` (default unlimited) and a decompression interceptor whose `maxSize` defaults to 0, meaning no limit: both limits must be set explicitly or there is none.

**Decision.** Adopt undici as the HTTP engine (maintained by the Node project, MIT), constructed and called only inside the egress port (`ports/egress.ts`, M8, the one module that imports network libraries, INT-020). Own the policy layer around it (adapt R5's lookup validation and R7's rules, re-implemented for undici's `connect.lookup`). Own the address classifier (generated from R8, not `ipaddr.js`) so classification is a tested table we can hash and the verifier can cite. Reject: Node's global `fetch` (cannot disable redirects reliably across versions and hides the dispatcher), a Node permission-model network deny (R15: no such flag in Node 22), and relying on a URL regex.

**Design.**

*Request identity.*

```ts
function requestKey(p: PlannedRequest): DocHash {               // pure; `jcs:<hex>`
  const url = canonicalUrl(p.url);                               // WHATWG URL; host lowercased, default port dropped, fragment dropped, query sorted by (key, value), percent-encoding normalised
  return docHash("plumbline/m1/request/v1", jcs({ channel: p.channel, method: p.method, url, accept: p.accept ?? null, bodyHash: p.bodyHash ?? null }));
}
```

Excluded from the key (so cassettes need no secrets): User-Agent, Authorization, Cookie, Accept-Encoding. No floats in the key (JCS profile). Unknown query keys fail `buildRequest` (closed `queryKeys`), so nothing unexpected can enter a URL or a cassette.

*Division of labour (INT-020).* Every network exchange is one `ctx.net.send(req, labels, ctl)` per hop. M1 decides *how*: steps 1, 2, 4, 6 and 7 run in M1, and step 3's address classification and step 5's wire limits are M1 policy objects (the `classifyAddress` table, per-channel limits) passed in `ctl` and enforced inside the port's dispatcher. M8's egress interceptor decides *whether this may leave* (label check against the manifest, `hosts`, the SAMPLE_MODE guard). Redirects are off inside the port, so each hop is egress-checked separately.

*Per-request pipeline (live and record; replay jumps to step 8 from the cassette).*

1. **Pre-parse rejection.** Reject raw strings containing backslash, whitespace, control characters, `@` before the host, or `%` in the host; this is R7's "parser disagreement is a rejection". Parse with the WHATWG `URL` (which canonicalises decimal, hex and octal IPv4 spellings, replacing R1's `inet_aton` step). Require the parsed `href` to re-parse to itself.
2. **Allowlist.** Scheme must be `https` (no channel needs `http`); exact host (or declared subdomain), port 443, no userinfo, path prefix, method. Only `web-direct` may reach arbitrary public hosts, and only for a `UrlCandidate` (component 18), never a model-supplied string.
3. **Resolve and pin.** The port's dispatcher is built with M1's `connect.lookup`; the lookup calls the system resolver with `all: true`, classifies every returned address with `classifyAddress`, rejects the whole answer if any member is not globally reachable unicast, and hands the vetted list to the socket. Host header and TLS server name stay the hostname (R7). `autoSelectFamily` stays on; all candidate addresses were already vetted. Deny classes: everything R8 lists as not globally reachable, IPv4-mapped, NAT64 (embeds an IPv4 address; we never need it), 6to4, Teredo, multicast, and any address whose embedded IPv4 is itself denied. `classifyAddress` is a pure function over a generated CIDR table; the table file is committed with its source registry date and hash.
4. **Redirects.** `maxRedirections: 0`; our loop follows at most 5 hops. Each hop resolves `Location` against the current URL, re-runs steps 1 to 3 and re-checks the allowlist; a hop to a different origin is permitted only if the channel declares `redirectTo` (OFAC declares `hostSuffix: ".s3.us-gov-west-1.amazonaws.com"`, observed 2026-10-13, `pathPrefix: "/Published/"`); `Authorization` and `Cookie` are never forwarded across origins; https to http is rejected; the hop list (redacted) goes into the evidence record.
5. **Limits.** Per channel: connect, headers, body and total deadlines; `maxResponseSize` (wire bytes) and the decompress `maxSize` (decoded bytes) both set; `Content-Length` over the cap rejects before reading; `Accept-Encoding: gzip` only; a hard cap on header size.
6. **Response classification** (pure, table-driven): status to `FetchError` per the table below; `Content-Type` must match `expectedContentTypes` (HTML where JSON is expected is a `challenge_page` candidate); text bodies decode with strict UTF-8 (`fatal: true`), failure is `parse_error` with a byte offset, never a replacement character; **challenge detection** on the first 4 KiB of decoded text of HTML or text responses only, using a versioned marker file adopted from R1 (`warning:` plus `requiring captcha` together with a challenge structure marker, or the Cloudflare "attention required" title together with a ray id or challenge path); negative tests prove that a page merely discussing these words does not trigger; `emptyMeaning` decides what a 200 with zero records means.
7. **Hash and hand over.** `bodyHash = RawHash(decoded bytes)` (`sha256:<hex>`); bytes go to `StorePort` (component 5).

| Observation | FetchState | Retry |
|---|---|---|
| 2xx, parsed, records present or `valid_no_match` | `ok` (or `partial` when pagination or a cap stopped it, with the reason in `coverage`) | n/a |
| 404 or 410, or 200 with zero records under `not_found` | `not_found` | no |
| 401, 403 | `unavailable`, `auth_required` or `forbidden`, remediation text (SEC without a compliant agent returns 403) | no |
| 429 | `rate_limited` | bounded, component 3 |
| 408, 500, 502, 503, 504, connection reset, timeout | `unavailable` | bounded |
| TLS certificate error | `unavailable`, `tls` | never (R1 V2EX rule, R12) |
| challenge page, unexpected content type, parse failure | `unavailable` | no |
| blocked by any step above | `blocked_by_policy` | no |
| served from stale cache after 5xx or timeout within `staleIfErrorSeconds` | `stale` | n/a |

`stale` follows RFC 5861's rule (R14): stale content only after an error that would otherwise be a 500, 502, 503 or 504, bounded by an age.

**Concurrency and determinism.** One undici `Agent` per channel with a connection cap; per-run isolated memo (component 5). In replay mode this pipeline is never entered, and steps 3 to 5 are exercised by a stub resolver in tests.

**Security notes.** The SAMPLE_MODE egress guard is in component 6. DNS answer order and TTL are not trusted; a lookup that returns a mix of public and private addresses fails. Residual: the destination host sees our address and request volume (component 10).

**Tests.** `SF-SSRF-01` AR's matrix (file, ftp, localhost, single-label, `home.arpa`, metadata host, `127.1`, `0`, decimal, hex, octal, `[::1]`, `[::ffff:127.0.0.1]`, trailing dot, backslash, userinfo) with an assertion that the dispatcher is never invoked. `SF-SSRF-02` stub resolver returning `127.0.0.1`, `10.0.0.5`, `169.254.169.254`, `::ffff:7f00:1`, `64:ff9b::7f00:1`, `2002:7f00:1::`, and mixed public plus private answers: all rejected, zero connections. `SF-SSRF-03` redirect to a private address, to an unlisted origin, https to http, a loop of 6 hops, credential stripping on cross-origin hops. `SF-SSRF-04` rebinding: the resolver returns a public address for the first call and a private one for the second; the connection must use the first call's vetted result (assert on the socket's remote address). `SF-SIZE-01..04` body exactly at the cap passes, one byte over fails, gzip bomb stopped by `maxSize`, slow-loris body stopped by `bodyMs`. `SF-CLS-01..` each table row from a stubbed server, including "no success result with an empty value unless the schema allows it". `SF-CHL-01..` marker positives and negatives. Property test: `classifyAddress` agrees with the committed registry CIDR table on 10^6 random addresses and with an independent reference (Node `net.BlockList` built from the same table).

**Metrics.** Block rate on the hostile corpus must be 100% (a gate, not a statistic); zero connections on blocked cases; silent-wrong parses 0 on goldens.

**Risks / NOT VERIFIED.** That undici passes `connect.lookup` to `net.connect` unchanged for HTTPS (documented, not exercised); that `all: true` lookups are what undici's `autoSelectFamily` path issues; IPv6 resolver behaviour on the judge's network; IDN homograph handling beyond punycode canonicalisation (only allowlisted hosts and `UrlCandidate` hosts are reachable; homograph risk applies to `web-direct`, mitigated by showing the punycode form in the trace).

**Build notes.** Needs component 1. Unblocks every live connector. Contract groups 2 and 3 of `prior-art/02` §6.8.

## 6. Component 3: rate limiting and retry policy

**References.** R12 (throttle, "revalidation consumes rate limit", retry window, SSL not retried), R14 (SEC 10 req/s, CourtListener windows), R1 (`_github_get_with_retry`, 02 §1.7), R3 (UA rotation per call, 02 §3.2).

**What they do.** R12 throttles to roughly 9 req/s and retries with exponential waits from 1 s to 60 s, not retrying SSL errors. R3 retries on any 4xx, which wastes budget and rotates User-Agent strings, which we must not do (R14 Wikimedia policy). LlamaIndex's SEC reader loses its limiter silently if an import fails (02 §2.3).

**Decision.** Own (a small component; the known failure is silent degradation). Reject `bottleneck` (last push 2024-01-23, 2,005 stars) as a dependency: windows persisted across processes and fail-closed construction are our requirements and it provides neither.

**Design.**

```ts
interface Limiter { acquire(channel: string, cost: 1, deadline: Iso): Promise<Result<Grant, FetchError>> }
// token bucket (burst, ourBudgetRps) + concurrency cap + sliding windows (CourtListener: 60 s/5, 3600 s/50, 86400 s/125)
// window counters persist in the store (state/ratelimit/<channel>.json, atomic write) so daily quotas survive restarts
```

- Construction fails closed: a channel cannot be registered without a limiter that initialised, and a limiter whose state file is unreadable returns `rate_limited{budgetExhausted: true}` rather than allowing traffic.
- Revalidation (conditional GET) consumes a grant (R12).
- Retry policy (pure function `nextAttempt(error, attempt, ctx)`): retry only 408, 429, 500, 502, 503, 504 and connection-level transients, at most 3 attempts total, GET and HEAD only; wait = `max(Retry-After, jitter(base 1 s * 2^n, cap 30 s))` with jitter from `ctx.rng`; if the wait exceeds the stage's remaining budget the call returns `rate_limited{retryAfterMs}` immediately instead of sleeping; each retry is reserved and charged by M7. A single honest User-Agent per run (`PlumblineFabric/<version> (<operator contact>)`); no rotation, no referer spoofing.
- `Retry-After` is parsed as an integer number of seconds or an HTTP date; the exact grammar of RFC 9110 section 10.2.3 was not readable in this session (**NOT VERIFIED**), so the parser accepts only those two forms and treats anything else as absent, with a unit test fixed from the RFC text before build.
- In replay mode the limiter is not consulted; a test asserts zero acquire calls.

**Tests.** `SF-RL-01` budget never exceeded across 32 concurrent callers (fake clock); `SF-RL-02` windows persist across a simulated restart; `SF-RL-03` limiter init failure aborts the channel; `SF-RL-04` 4xx other than 408 and 429 is never retried; `SF-RL-05` TLS errors never retried; `SF-RL-06` retry charged to budget; `SF-RL-07` wait larger than remaining stage budget returns immediately. Contract group 7.

**Risks.** Anonymous GLEIF, Wikidata and CourtListener limits are NOT VERIFIED (R14 gives only CourtListener authenticated figures; the fabric applies the same figures to anonymous use until measured). Clock skew on persisted windows.

**Build notes.** After component 2; before the connectors go live.

## 7. Component 4: structured credential redaction

**References.** R1 `utils/text.py`, `config.py` masking, `doctor.py` output boundary, tests `test_scrub_credentials.py` (02 §1.4).

**What they do.** R1's three regexes (read in `text.py`) redact URL userinfo and query values for keys such as `token`, `key`, `signature`, `sig`; the key list is anchored right after `?`, `&`, `#`, so `X-Amz-Security-Token` and `X-Amz-Signature` are not matched (02 §1.4, reproduced by running a copy on a synthetic URL). `Authorization: Bearer ...` and `Cookie:` strings in free text are not covered. OFAC's export redirects to a pre-signed object-store URL (R16), so this gap is exercised by the first source we wire.

**Decision.** Own (adapt R1's boundary discipline, replace regex-over-text with structured redaction).

**Design.** `redactUrl(url)` parses and rebuilds: userinfo removed; query values replaced by `<redacted>` unless the key is in the channel's `queryKeys` allowlist (an allowlist, not a deny list, so unknown keys are removed by default), and any key matching `/^x-amz-/i`, `/signature|token|credential|secret|key|sig|auth|session|cookie/i` is removed even if allowlisted by mistake (the registry check rejects such an allowlist entry). `redactHeaders(h)` keeps an allowlist (`content-type`, `content-length`, `content-encoding`, `etag`, `last-modified`, `date`, `cache-control`, `retry-after`, `location` after `redactUrl`). Free text is never regex-scrubbed as a primary defence; the boundary rule is: **every string that crosses into a trace line, doctor output, error message, cassette or MCP output passes `redactUrl` for each URL-typed field**, enforced by making those sinks accept only a `Redacted<string>` brand produced by the functions above (module-private constructor and runtime registry, M8's mechanism). A last-line scanner (`secretLike(text)` over high-entropy tokens and known prefixes) runs on cassettes and doctor output as a test oracle, never as the defence.

**Tests.** `SF-RED-01` the OFAC redirect URL with `X-Amz-Security-Token`, `X-Amz-Signature`, `X-Amz-Credential`; `SF-RED-02` userinfo, `Authorization`, `Cookie`, `token`/`key`/`password` in query and fragment; `SF-RED-03` a sink given an unbranded string fails type check and a forged brand fails the registry test; `SF-RED-04` golden: no recorded cassette contains a query value outside the allowlist. Contract group 8.

**Risks.** A secret in a response body is outside this component (bodies are data; the cassette rights gate and `scripts/secret_scan.py` over committed files cover it).

## 8. Component 5: evidence builder, evidence and index stores, blobs through StorePort

**References.** R10 (cacache layout and verified reads), R3 `Document._create_id` (content-derived ids, 02 §3.2), R2 `get_transformation_hash` (02 §2.2), R12 (per-host cache rules), R14 (`stale-if-error`), R20 (nomenklatura per-statement storage).

**What they do.** cacache stores bytes under their own digest and keeps a separate index; reads re-verify; writes are temp-then-rename; it does not delete by default and is lockless. Haystack ids hash content plus sorted-key metadata, so a volatile field in metadata changes the identity. LlamaIndex keys a transform cache on input content plus transform configuration. GLEIF sends `cache-control: private, must-revalidate`, `pragma: no-cache`, `expires: -1` and no validators on records (R16), so a standards cache would never reuse a record; our reuse is therefore an explicit application policy, not HTTP caching.

**Decision.** Adapt cacache's layout (own implementation; we need a retention and erasure model it lacks). Blob bytes live in the one shared content store behind M7's `StorePort`, addressed by `RawHash`, partitioned by confidentiality class (`public`, `case-visible`, `internal-sensitive`) and carrying tombstones (INT-043); M1 keeps only metadata (evidence records, retrieval index, attempts, limiter state) in its cache directory. Own the evidence record and its id rule.

**Design.**

```
cache/                         # root from config, one per tenant namespace (tn_default on the judge path, INT-048); never inside the repo tree
  meta.json                    # { schemaVersion, toolVersion }
  evidence/<ev_id>.json        # immutable JCS records (metadata; blobs are in StorePort, not here)
  index/<requestKey hex>.jsonl # append-only retrieval events; last line wins; history kept
  attempts/<yyyy-mm-dd>.jsonl  # AttemptRecord stream (failures included)
  state/ratelimit/<channel>.json
```

*Evidence id.* `ev_` plus the first 32 hex characters of the `DocHash` of `{ channel, requestKey, bodyHash, parsedHash, parserVersion, retrievedAt }` (tag `plumbline/m1/evidence/v1`). `retrievedAt` is the time of the network exchange that produced or revalidated the bytes (from `ctx.clock`; in replay it is the cassette entry's recorded time, so replay reproduces identical ids). A cache-fresh hit returns the earlier record unchanged (same id). No fetch metadata beyond that enters identity (the Haystack caveat).

*Evidence content.* Raw body stays in the blob; `Evidence.raw` carries the record subset used, `normalised` the typed form, `parsedHash` the `DocHash` of `{raw, normalised}` (tag `plumbline/m1/parsed/v1`). `bodyHash` is the `RawHash` of the decoded bytes for `public` channels and a `Commitment` when `conf` is above `public` (silo rows, case attachments; INT-003, INT-006); the evidence file then also keeps the `RawHash` store key as an internal field that is never exported. `use` is copied from `SourceMeta.evidenceUse`. `locator` is `{ kind: "url", ref: urlRedacted }` for exchanges, `{ kind: "record", ref: "<system>:<view>:<pk>" }` for silo rows and index hits, with `field` a JSON Pointer (RFC 6901 form) into `raw`; `resolver` is `json-pointer` for those, `bytes` for a byte range of a stored body and `csv-cell` for OFAC list rows (M9 defines the ref syntax); document evidence (11j) uses `{ kind: "doc", ref, docSha }` and every locator into it is M2's. `effectiveAt` is the source's own date (GLEIF `meta.goldenCopy.publishDate`, OFAC `Publish_Date`, SEC filing date), never our clock.

*Run scope.* Within one case run the first retrieval of a `requestKey` is memoised (`servedFrom: "run_memo"`), so reconciliation sees one snapshot even when a TTL expires mid-run. Across runs, freshness is `meta.freshness`: fresh inside `ttlSeconds`; revalidate with `If-None-Match` or `If-Modified-Since` when validators exist (the OFAC target has both; GLEIF records have neither, observed); `stale-if-error` up to `staleIfErrorSeconds`, state `stale`.

*Writes.* Through `ctx.fs.writeAtomic` (temp file in the target directory, `fsync`, rename) and `StorePort.putBlob`; `FsPort` refuses any symlinked path component (`lstat` each component plus a real-path containment check; `O_NOFOLLOW` is not available on Windows, so a race remains and is documented). POSIX modes 0700 and 0600; on Windows the directory inherits the parent ACL and the doctor reports permissions as `inspected`, not enforced. Reads recompute the blob digest; a mismatch is `fatal` in replay and evict-and-refetch live. Erasure: `erase(bodyHash, reason)` is a request to the M9 erasure service, the only deleter (INT-040, INT-043; method `delete+salt-destroy`, `crypto_erase` or `tombstone`); it returns the M9 receipt hash. Later reads return a typed `erased` error, replay of an entry whose blob was erased raises `cassette_miss{reason: "erased"}`, and the Evidence keeps its hashes. Path components use the hex part of any prefixed hash (`jcs:`, `sha256:` and `com:` contain a colon, which Windows file names forbid).

**Tests.** `SF-ST-01` kill the process during a write at every step (fault harness): no partial file visible; `SF-ST-02` flipped blob byte detected; `SF-ST-03` same body fetched twice gives equal ids when `retrievedAt` is pinned and different ids otherwise; `SF-ST-04` replay reproduces the ids of the recorded run; `SF-ST-05` symlinked cache directory refused; `SF-ST-06` erasure through the M9 service returns its receipt hash, leaves a verifiable tombstone and a typed `erased` read error, and replay raises `cassette_miss{reason: "erased"}`; `SF-ST-07` run memo gives one snapshot across a TTL boundary; `SF-ST-08` directory entry with parser version bump but unchanged golden hash fails the parser-drift gate.

**Risks / NOT VERIFIED.** Atomic rename semantics and crash behaviour on NTFS (tested, not assumed); a `private` cache directive is respected by treating the store as a single-user private cache; large blobs (29 MB OFAC XML) hashed in a stream.

**Build notes.** After 1 to 4. Unblocks 6 and every connector. Contract groups 5 and 9.

## 9. Component 6: cassette record and replay, SAMPLE_MODE egress guard

**References.** R9 (modes, play counts, default matching), R11 (watchman cache proxy; `INITIAL_DATA_DIRECTORY`), 02 §6.5 (our earlier layout), spec §4 (M7 effect cassettes).

**What they do.** vcrpy's `none` mode is strict replay, which is the behaviour we want, but its default matcher ignores bodies and headers, so two requests differing only in a body collide, and each recorded response plays once by default. Watchman's answer to government endpoints that redirect to short-lived URLs and go down for days is an external cache with stale serving; it has no record of what was served.

**Decision.** Own. Cassettes sit at **our transport port**, below parsing, so replay re-runs hashing, parsing, trust assignment and evidence building (a parser regression shows in replay). This is layer 2 of a two-layer design (INT-042). Layer 1 is M7's effect record for `source.fetch`, `{slot, reqHash, respHash, outcome}`, looked up by slot with request-hash verification; `requestKey` is an input to `reqHash`, `respHash` is the `DocHash` of the canonical `FetchOutcome` without bodies plus the list of `bodyHash` values, and its `bodyPolicy` is `blob` (bodies in the content store, not hash-only). Replay re-runs layer 2 and the result must equal layer 1's `respHash`, so equality is checked twice. Reject interception libraries (nock, MSW, Polly) because they patch `http` internals and would not cover undici's dispatcher consistently, and because `ctx.net` is the only door.

**Design.**

```
cassettes/<scenario>/
  manifest.json            # { schemaVersion, scenario, tenant, recordedAt, tool, entries:[{requestKey, versionIdx, bodyHash, class}], entriesRoot, contractHash?, manifestHash, banner }
  entries/<requestKey hex>/<n>.json   # versions ordered by recordedAt
  blobs/sha256/..                 # public-partition objects of the shared store (INT-043), same layout; only class "public_body" or "synthetic_body"
```

`class` is one of `public_body` (redistributable, verified licence, no personal data; blob committed), `local_body` (blob only in the local cache directory; manifest holds hashes and metadata, so replay on a judge's machine needs `--evidence-dir` or falls back to a labelled synthetic twin), `synthetic_body` (generated by our seeded generator, labelled). An entry stores request (redacted), hop list, allowlisted headers, `recordedAt`, `latencyMs`, `bodyHash`, `excerpt?` (declared rule plus full-body hash; a screening result built on an excerpt must print "SAMPLE excerpt of list <version>, not a complete screening").

*Replay.* Look up `requestKey` (a `DocHash`; `entriesRoot` is a Merkle root over the sorted `(requestKey, versionIdx, bodyHash)` leaves, built with M9's tree construction, and the M9 bundle carries it next to layer 1's root); choose the latest version with `recordedAt <= ctx.clock.now()` (in replay, the virtual clock M7 replays from the recorded `at`; this models a list that changed between approval and execution: M13's TOCTOU test records two versions); no match raises `cassette_miss{reason, requestKey, nearest[], hint}` where `nearest` lists up to three entries of the same channel sharing the longest path and the most query parameters, and `hint` states the exact commands to record the missing request or to run the case live (error class `fatal`, M7's `E_CASSETTE_MISS` with the `RUN_LIVE` hint; `reason` is `erased` when the erasure service removed the blob). Repeated identical requests replay the same entry (idempotent GETs), with a use counter in the trace. No network call is possible: the dispatcher is never constructed in replay.

*Record.* Live exchange plus write; the recorder refuses an entry if redaction left a denied header or query value, if `class` cannot be assigned by the rights gate (component 9), or if the per-channel personal-data classifier flags the record (GLEIF `entity.category = SOLE_PROPRIETOR`, any natural-person list entry: F-PERSONS).

*SAMPLE_MODE egress guard.* `SAMPLE_MODE=true` forces replay. The guard that counts is at the network port: `ctx.net` (`ports/egress.ts`, M8) throws `blocked_by_policy{sample_mode_egress}` (INT-020). M1 also installs an in-process guard making `net.Socket.prototype.connect`, `dns.lookup`, `dns.resolve*` and undici dispatch throw the same error; it is a second, weaker control for our own code paths and never counts as the compartment claim (INT-019). Node 22's permission model has no network flag (R15), so the in-process guard does not stop a native addon or a child process. The run is therefore started with `--permission` and without `--allow-child-process`, `--allow-addons`, `--allow-worker`, `--allow-wasi` (all deniable in Node 22.13 and later, R15) and file access limited to the cache, cassette and output directories. The clean-room verifier additionally records the run under an OS-level block (a no-network sandbox or firewall rule) as independent evidence. M8 owns the compartment mechanism and claim: network denial is stated only beside the backend M8 probed and recorded (`os-netns`, `node-net-permission` or `node-flags-only`), and a judge machine without a container reports `node-flags-only` and says so. The guard is installed before any module that opens sockets loads.

*Integrity and hygiene.* `plumbline cassette verify`: manifest hash over sorted entries, every blob present and hashing, no orphan blobs, no secret-like values, rights gate satisfied per entry, no personal flag, banner and scenario named, unused-entry report from the last full replay (dead entries fail CI). Drift check (`doctor --drift`, live only): re-run each cassette canary and compare structure (key set, record-count band), report only.

**Tests.** `SF-CAS-01` replay equality (same trace and state hash across two runs and two machines); `SF-CAS-02` zero sockets in replay (a listening spy server receives nothing); `SF-CAS-03` miss names the key and nearest entries; `SF-CAS-04` body-only difference between two requests yields two keys (the vcrpy default would collide); `SF-CAS-05` version selection by clock (two recorded list versions); `SF-CAS-06` mutated blob or manifest rejected; `SF-CAS-07` recorder refuses an entry containing a signed-URL parameter, a natural-person record, or an unverified licence; `SF-CAS-08` guard test: with the guard on, `net.connect`, `dns.lookup`, undici `request`, `fetch`, `http.get`, `ctx.net.send` and `child_process.spawn` (denied by the permission flags) all fail; `SF-CAS-09` dead-entry detector. Contract group 4.

**Risks / NOT VERIFIED.** The in-process guard is a control against our own code paths, not against hostile native code; whether Windows Firewall or a container is available on the verifier machine; replay of rights-gated sources depends on synthetic twins, which test the code path and not the real data.

**Build notes.** After 5. Unblocks `SAMPLE_MODE`, F-SAMPLE scenarios, and all connector goldens.

## 10. Component 7: doctor and canary probes

**References.** R1 `probe.py`, `doctor.py`, `tests/test_doctor*.py`, `test_home_isolation.py` (02 §1.3, §1.4, §1.9).

**What they do.** Probes classify `ok | missing | broken | timeout | error`, choose the narrowest side-effect-free request, and say what was executed versus inspected (read in `probe.py` header and 02). The doctor isolates each channel's exception, scrubs messages at the output boundary and is tested as zero-write. Weaknesses carried by 02 §1.3 and §1.12: the web channel is never probed, `ok` is structurally unreachable for `github`, there is no per-task canary, the process exits 0 regardless, and the JSON has no schema version.

**Decision.** Adapt R1's discipline; beat it with real canaries (our sources are keyless public APIs, so a real request is cheap and cacheable) and gateable exit codes.

**Design.** `HealthStatus = ok | degraded | unverified | off | error`; evidence type `executed | replayed | inspected | assumed`; the rule "ok requires executed or replayed" is enforced in the report type. Report fields: schema version, tool version, mode, per channel `{status, activeBackend, backends[], canary{requestKey, httpStatus, bodyHash, assertions[]}, limits, licence, message, remediation, notVerified[]}`. Exit codes: 0 all required channels ok, 1 a required channel in error, 2 degraded or unverified required channel, 3 configuration error. Canaries:

| Channel | Canary | Assertions |
|---|---|---|
| gleif | record of a fixed LEI | `data.type = lei-records`; `attributes.lei` equals the request; `meta.goldenCopy.publishDate` within 14 days or `degraded` |
| sec-edgar | submissions for a fixed CIK | user agent configured; top-level shape per the first cassette (key names NOT VERIFIED) |
| ofac-sdn | ranged read of the first 1 KiB of the XML | `Publish_Date` and `Record_Count` parse; index version equals or is older than the live date (stale index is `degraded`) |
| wikidata | `Special:EntityData` for Q312 (verified 2026-10-13 as Apple Inc.) | entity id and an English label present |
| courtlistener | none live by default (daily quota of 125); replayed cassette, one live canary per day when `--live` and quota remains | counted against the persisted window |
| rss | conditional GET of each configured feed | 200 or 304; parse OK |
| web-direct | pinned page | content type, no challenge |
| jina | `example.com` through the reader | non-empty, no challenge marker; rate headers read (20 per 60 s observed anonymous) |
| **negative canaries** | literal private and metadata addresses through `web-direct` | must come back `blocked_by_policy`; a pass here is an `error` |

The doctor never reads credentials (it checks that an environment variable exists and that a User-Agent matches `uaPattern`), writes nothing outside the cache directory, and a channel that throws becomes `error` without stopping the report. A `--terms` mode fetches each `termsUrl`, hashes normalised text and reports drift against the registry (warning only).

**Tests.** `SF-DOC-01` exit codes; `SF-DOC-02` JSON validates against its schema; `SF-DOC-03` `ok` impossible with `inspected` or `assumed`; `SF-DOC-04` a throwing channel isolated; `SF-DOC-05` zero-write on an empty temp home; `SF-DOC-06` credentials and signed URLs scrubbed in output; `SF-DOC-07` negative canary failing the SSRF gate turns the report red; `SF-DOC-08` stale-index detection. Contract group 10, 11.

**Risks.** Canary assertions on an upstream we do not control produce false alarms; they report `degraded` with the observed structure, never failing the offline suite.

**Build notes.** Needs 2 to 6; first connector to ship with it is GLEIF.

## 11. Component 8: authority tables, authorship, self-declared tier, trust assignment

**References.** R20 (BODS source types, FollowTheMoney statements), spec §5 and §6, 07 §3.3, 15 §4, review SEC-03/SEC-04/SEC-05, 10 §D.2.

**What they do.** BODS `source.type` distinguishes `selfDeclaration`, `officialRegister`, `thirdParty`, `primaryResearch`, `verified`. FollowTheMoney keeps raw and normalised values and dataset per statement. GLEIF's own record carries `registration.corroborationLevel` and `validatedAt` (observed `FULLY_CORROBORATED`, `RA000598` for the sampled record), a source-supplied signal of whether the register confirmed the entry.

**Decision.** Own the table format and the pure assignment function; adopt BODS names as vocabulary only (licence NOASSERTION, not vendored).

**Design.** Pack data (`packs/procurement/authority.json`, JCS-hashed and listed in the run manifest):

```ts
type Shape = "identifier" | "enum" | "date" | "number" | "bounded_string" | "free_text";
interface AuthorityRow {
  attribute: string;                       // e.g. "entity.status", "lei", "sanctions.listed"
  channel: string; field: string;          // JSON Pointer or column
  tier: AuthorityTier; authorship: Authorship; shape: Shape;
  rank: number;                            // declared, per attribute; M3 resolves by it (declare, do not infer)
  conditions?: { when: string; tier: AuthorityTier }[];   // closed predicate language over the record, e.g. GLEIF corroborationLevel != "FULLY_CORROBORATED" lowers tier to self_declared
  coverage: { appliesTo: string; excludes: string[] };
}
function assignTrust(row: AuthorityRow, producer: "parser" | "model" | "internal_system", recordTier: AuthorityTier, lastWriteOrigin?: WriteOrigin): TrustLevel; // pure
```

Rules (a proposal M8 must approve, as it owns the lattice):
- `VERIFIED` only when `recordTier ∈ {authoritative, regulated_register}`, `authorship ∈ {authority, third_party}`, `shape ≠ free_text`, and the value passed the closed schema (shape narrowing); a deterministic parser preserves but never raises a level.
- `free_text` is always `UNTRUSTED`, whatever the channel (registry names, remarks, other names, case names, feed summaries). It may be compared by deterministic code and may enter a prompt only through the quarantined extractor.
- `self_declared`, `secondary` and Jina or web content are `UNTRUSTED`; `synthetic` is `VERIFIED` only for rows flagged `simulatedAuthority` (the account-verification channel), and every such Evidence carries `synthetic: true` so the dossier labels it SIMULATED.
- A silo field is `SOR` iff it was read under an authenticated identity and `lastWriteOrigin ∉ {vendor_portal, vendor_email, unknown}` (review SEC-02; `WriteOrigin` is the shared type, INT-006; `attested`, `internal_initiated` and `system_migration` are not downgraded here, and M8's permission matrix decides what each may be used for). The vendor master contract therefore exposes `last_write_origin`, `last_write_actor`, `last_write_at`, `change_request_id`, `request_origin`, `editor_sub` and, for bank fields, `days_since_change` as derived columns with their own lineage (INT-024). **Default-deny:** a missing or null provenance column makes the field `UNTRUSTED`. `editor_sub` is what M5 reads as `actors.vendor_master_editor`. Human confirmation never changes the level.
- Consequence recorded deliberately: a parsed OFAC identifier extracted from remarks is `UNTRUSTED` (free-text origin). That is safe because sanctions evidence only adds holds, and it is noted so no one expects it to be `VERIFIED`.
- Consequence for registries: an unvalidated GLEIF record (`corroborationLevel` other than fully corroborated) lowers its `legalName`-adjacent identifiers to `self_declared` through `conditions`; the exact enumeration of `corroborationLevel` values is NOT VERIFIED beyond the observed value.

The table also records per attribute the **ordered authority list** the router uses (component 18), `requiredChannels` (the channel ids M3 requires before it may call a cell `silent`; one name, read by M3 as data) and the BODS-style `sourceType` for export; the origin DAG (channels that share an origin) ships beside it as the pack file `origins.json`.

**Tests.** `SF-AUTH-01` every Evidence field in every golden parse has a table row (an unmapped field fails); `SF-AUTH-02` free-text fields never exceed `UNTRUSTED` (property test over goldens); `SF-AUTH-03` taint run: no derived trust above its parents (M8's propagation test, fed from M1 outputs); `SF-AUTH-04` vendor-master row with `last_write_origin = vendor_portal`, or with a missing provenance column, yields `UNTRUSTED` bank fields; `SF-AUTH-05` a counterparty-authored name in a registry arrives `UNTRUSTED` (attack `SEC-I10` fixture); `SF-AUTH-06` condition predicates reject unknown operators.

**Risks.** The table is authored by us; the review's circularity concern (GRT-01) applies to evaluation, so the pack's domain reviewer signs it off (open item).

**Build notes.** With 1; M3 and M8 consume it early.

## 12. Component 9: rights gate and licence metadata

**References.** R14 (GLEIF CC0 with the "do not misrepresent" reservation; Wikidata CC0 via 02 §5), 15 §4 (OFAC no terms read; OpenSanctions CC BY-NC 4.0; BODS NOASSERTION), spdx/license-list-data (706 stars, pushed 2026-09-16, metadata only).

**What they do.** Nothing in the three studied repositories gates redistribution; Watchman ships list-handling code but no data and depends on the vendor's terms at runtime.

**Decision.** Own. SPDX identifiers where one exists, `LicenseRef-Plumbline-Unverified` otherwise.

**Design.** `rights/registry.json` holds one `LicenceStatus` (conventions type) per channel. `committable(entry)` is true iff `redistributable = "yes"`, `verifiedOn` is not null, `termsHash` is not null (hash of the normalised terms text when verified), `scope` covers the artefact class (`body`, or `derived` for an index built from the body), and the personal flag is false. Defaults: GLEIF `CC0-1.0` yes (attribution not required; the terms forbid misrepresenting modified data, so excerpts carry the banner), Wikidata `CC0-1.0` yes; SEC, OFAC, CourtListener `unknown` (hash and metadata only); OpenSanctions: never fetched into the repository, local evaluation use only. A derived index counts as a body (review AUD-03): the OFAC index is generated locally and not committed. Three CI checks: `rights.lint` (every cassette entry satisfies `committable` for its class), `rights.drift` (terms hash older than 180 days warns), `data.readme` (generated `data/README.md` lists URL, licence, subset, record count, regeneration command; stale means CI failure, F-DATAREADME). Verification is a human act recorded as a commit authored by the reviewer; the registry stores `verifiedBy`.

**Tests.** `SF-RIGHTS-01` an entry with an unknown licence cannot be recorded as `public_body`; `SF-RIGHTS-02` stale verification blocks; `SF-RIGHTS-03` derived-index commit attempt rejected; `SF-RIGHTS-04` banner present on every excerpt-based screening.

**Risks.** Whether SEC, OFAC and CourtListener terms permit fixtures stays NOT VERIFIED; the design makes that a data change, not a code change.

## 13. Component 10: egress manifest entries and disclosure profiles

**References.** R6 (central egress with per-role ACL and logging), 10 §D.5 (typed queries only, `internal-sensitive` has no path to a query), spec §5 (confidentiality join), review REC-04, SEC-06.

**What they do.** Smokescreen centralises egress and enforces ACLs by role and resolved address. 10 §D.5 states the rule we need and the residual timing and volume side channel.

**Decision.** Own the population of the manifest and the disclosure profiles. The manifest schema (`EgressEntry`) and the enforcement point (the egress interceptor in `ports/egress.ts`) belong to M8: one chokepoint as in R6, without a proxy process. M1 decides how to fetch; M8 decides whether this may leave (INT-020).

**Design.** `egress-manifest.json` (M8's `EgressEntry` schema, generated from `SourceMeta`, the model profile and the Zetaris config, checked for drift in CI) lists per destination: origin, purpose, allowed methods, `disclosureProfile`, and per parameter `{name, maxClass: Confidentiality, personalAllowed: boolean, disclosure: boolean, justification}`. Counterparty names are `internal-sensitive` by class and are declared **disclosure parameters**: they may leave only in the minimised form, the LEI or CIK when the `SubjectRef` has one and the name only when no identifier exists, with the justification "a lookup discloses a relationship" (REC-04, INT-021). `QueryBuilder` accepts only `Labelled<string>` values and hands the `LabelSet` of every value that reached the URL, body or header to `ctx.net.send`; M8's interceptor joins them and fails with `blocked_by_policy{egress_class}` when any value exceeds the manifest maximum and is not a declared disclosure parameter in its minimised form. The **`disclosureProfile`** (`public_lookup | identifier_only | offline`; a different axis from M8's `modelProfile`, and both are recorded in the run header) selects behaviour: `public_lookup` is the minimised rule above; `identifier_only` sends LEI and CIK only and never a name; `offline` forbids public lookups and relies on the local OFAC index and cassettes. The OFAC local index exists partly for this reason: screening discloses nothing. A GLEIF golden-copy local mirror is a roadmap item (download URLs NOT VERIFIED). The trace records, per outbound call, destination, parameter names, classes and byte counts (hash-only content). Residual (stated, not closed): which queries were made, when and how often.

**Tests.** `SF-EGR-01` property test (`SEC-P4` family): random labelled values never appear in any outbound URL, body, header, trace line or error message above their class, except a declared disclosure parameter in its minimised form; `SF-EGR-02` an unlabelled string cannot be passed to the builder (type test plus runtime registry); `SF-EGR-03` manifest drift (a connector adds a parameter without a manifest entry) fails CI; `SF-EGR-04` `identifier_only` profile sends no name in a full hero-case run (assert over the recorded request log); `SF-EGR-06` under `public_lookup` a name leaves only when the `SubjectRef` has no identifier; `SF-EGR-05` Jina and web-direct URLs are classified and logged.

**Risks.** The funnel covers the `ctx.net` path only (the same limitation as component 6).

## 14. Component 11: connectors

Common design for all connectors: a `SourceChannel` (component 1), typed queries, closed response schemas (unknown top-level shape is `parse_error`, not repaired), `Coverage` on every outcome, a parser with a version, golden parses per cassette entry (`parsedHash` pinned), authority rows (component 8), licence row (component 9), egress entries (component 10), canary (component 7). Common test: `SF-CONN-<id>-01..` golden parse, hostile-body fixtures (huge strings, deep nesting, prompt-injection text inside free-text fields must come out `UNTRUSTED` and unchanged), empty and truncated bodies, a replay equality test, and an `allowed`-origin test. Per connector below.

### 11a GLEIF
- **Observed 2026-10-13** (R16): `GET /api/v1/lei-records/<LEI>` returns `application/vnd.api+json`; `data.attributes` keys `lei, entity, registration, bic, mic, ocid, qcc, gem, spglobal, conformityFlag`; `entity.legalName.name`, `otherNames[].type`, `legalAddress`, `headquartersAddress`, `registeredAt.id`, `registeredAs`, `jurisdiction`, `category`, `legalForm.id`, `status`, `creationDate`; `registration.status`, `nextRenewalDate`, `managingLou`, `corroborationLevel`, `validatedAt`, `validatedAs`; relationships `managing-lou, lei-issuer, field-modifications, direct-parent, ultimate-parent, direct-children, ultimate-children, isins`; `meta.goldenCopy.publishDate`. No rate-limit headers; cache headers as above. Filter by `filter[entity.legalName]` and paging respond 200 (page-size maximum and `fuzzycompletions` parameters: NOT VERIFIED; the API documentation page was unreadable through the fetch tool).
- **Queries.** `{kind: "lei", lei}` (regex `^[0-9A-Z]{18}[0-9]{2}$`); `{kind: "name", name}` (egress class, component 10); `{kind: "parents", lei}` for ownership links (direct and ultimate parent: the relationship documents carry reporting exceptions, shape NOT VERIFIED).
- **Authority.** `lei`, `registration.status`, dates, `managingLou` identifiers: `regulated_register`, authority-authored, VERIFIED. `legalName`, `otherNames`, addresses: counterparty-supplied then LOU-validated (`corroborationLevel`), free text, UNTRUSTED but usable for matching. No LEI is not evidence of anything (`not_found` with coverage "LEI registry only; entity may exist without an LEI").
- **Effective date.** `meta.goldenCopy.publishDate`. Personal-data flag: `category = SOLE_PROPRIETOR` or an individual-like `legalForm` is not committable and routed to `not_applicable` under the strict profile.
- **Test extras.** `SF-CONN-GLEIF-05` parent chain fixture (a record whose direct parent differs from the ultimate parent).

### 11b SEC EDGAR
- **Verified facts** (R14): maximum 10 requests per second, a declared User-Agent with company name and contact, no botnets or crawling. `data.sec.gov` endpoints worked with a descriptive agent; `www.sec.gov` files returned 403 for our probe agent (02 §5) and are **not wired** until tested with a compliant agent. Edgartools refuses to run without an identity (R12); we do the same: the channel is `off` unless `SEC_USER_AGENT` matches `^.+ \S+@\S+\.\S+$`, and the doctor prints the fix.
- **Queries.** `{kind: "submissions", cik}` and `{kind: "companyfacts", cik}` (about 3.8 MB for a large filer; cap 16 MiB). CIK validated as digits and zero-padded. Name to CIK resolution is not done here: a CIK comes from a pack input, from Wikidata (property P5531 "Central Index Key", verified to exist 2026-10-13) as a UNTRUSTED candidate, or a human; `not_applicable` when none exists.
- **Parsing.** Closed schemas for the keys we use (names of keys in the submissions document: NOT VERIFIED beyond 02 §5; they are fixed from the first recorded cassette and drift fails). Filer-supplied names and former names are `self_declared` free text, UNTRUSTED; CIK, accession numbers, form types, filing dates are VERIFIED.
- **Budget.** 5 req/s, concurrency 2. No conditional validators were observed, so repeated lookups rely on `freshness.ttlSeconds` (default 24 h).

### 11c OFAC SDN with a locally generated index
- **Observed 2026-10-13** (R16, R11): the service URL `https://sanctionslistservice.ofac.treas.gov/api/PublicationPreview/exports/<file>` serves `SDN.XML` (29,189,135 bytes, `Publish_Date` 10/13/2026, `Record_Count` 19,431, root `sdnList`; the header element is spelled `publshInformation`) and, in lower case, `sdn.csv` (5,732,937 bytes), `add.csv`, `alt.csv`, `sdn_comments.csv` (the same four files Watchman downloads). A GET answers one redirect to a pre-signed object on `wc2h-sls-prod-public-published.s3.us-gov-west-1.amazonaws.com` under `/Published/<id>/2026-10-09/<id>/<FILE>` with `ETag` (32 hex, stable across two reads), `Last-Modified` (Tue 13 Oct 2026 14:02 GMT) and ranged-read support (206). CSV files are headerless, quoted, with the null marker `-0- `; `sdn.csv` rows have 12 fields, `add.csv` 6, `alt.csv` 5, `sdn_comments.csv` 2 (observed positions; field names NOT VERIFIED, to be fixed from Watchman's mapper and OFAC's own documentation before build). **Three version signals disagree** (folder date 2026-10-09, `Last-Modified` 13 Oct, XML `Publish_Date` 10/13/2026), and the endpoint name says "PublicationPreview": its stability as a supported API is NOT VERIFIED.
- **Decision on formats.** Build the index from the CSV quartet (5.7 MB for the main file; a streaming XML parse of 29 MB adds a dependency and no attribute the matching needs), and read only the first 1 KiB of the XML by ranged GET for `Publish_Date` and `Record_Count`. The two are cross-checked: CSV row count against `Record_Count` is a reported consistency check, not an assumption. If a richer pass over the XML (structured dates of birth, ID lists, nationality) is later needed, the parser comes from bake-off 3.
- **Version identity.** `ListVersion` (type in section 1) `= { publishDate (XML header), fileSetHash = DocHash of the sorted [{name, bodyHash}], observed: {folderDate, lastModified, etag}, recordCountDeclared, recordCountObserved }`. It is also a feed, `ofac.listVersion(ctx)` (the ranged header read of the refresh step, no download), which M13's execution-time re-screen and M5 call. Never label a date "list published" unless it came from the XML header.
- **Index build** (`tools/build-ofac-index`, build time or first live use; never on the judge path): own RFC 4180 state-machine CSV parser (quotes, embedded newlines, CRLF, strict field counts per file, strict UTF-8, error with line and byte offset); normalise names (NFKD, strip combining marks, case-fold, punctuation to space, collapse, declared legal-form suffix set, token-sorted variant); inverted indexes over normalised tokens (integer document frequencies are stored and idf weights are computed in memory at query time, because the index is hashed and carries no floats, INT-010) and character trigrams; listed identifiers parsed from remarks by closed regexes into typed `ListedIdentifier{type, number, country}`; sorted-key output with no timestamps so the same inputs give a byte-identical index with `indexHash` (a `DocHash`). The index is derived data: stored in the cache directory, hash recorded in the run manifest, **not committed** (rights gate).
- **Query** `{kind: "screen", names[], recallProfile}` returns candidates, not verdicts: a recall-oriented blocking union (trigram overlap, idf-weighted token containment, exact identifier match), at most K per name, each with full provenance (`uid`, matched alias, program, list version). Link decisions belong to M3. Every outcome carries `coverage { checked: "OFAC SDN list only", method: <recallProfile + thresholds>, versionTag, excludes: ["OFAC consolidated non-SDN lists", "EU, UN and UK lists", "ownership aggregation"], limits }`; zero candidates is `ok` with `matches: []` and is never rendered "clear" (spec §6).
- **Refresh.** At most once per UTC day in live mode: ranged header read; download the CSV quartet only when `Publish_Date` is newer than the index; log bytes (F-DOWNLOAD). Size caps: 16 MiB per CSV, 4 KiB for the header range. Redirect allowance as in component 2; the signed URL is never logged or cassetted.
- **Judge path.** The synthetic list (labelled `synthetic: true`, entries named so as to be unmistakably fake) is emitted by the generator in the **same CSV formats** and passes through the identical parser and index builder, so the real code path runs. A real-list run happens only locally and live.
- **Metrics.** `blockingRecall@K` on a Finansinspektionen-style perturbation set built from public list names (removed or replaced letters, transliteration, diacritics, word order, honorifics, legal-form suffixes; 02-research; spec §16), reported with a cluster-bootstrap interval against Watchman, yente and edit-distance baselines; index build time and memory (not claimed before measured).
- **Tests.** `SF-CONN-OFAC-01` CSV edge cases (embedded quotes and newlines, `-0- `, ragged row fails); `SF-CONN-OFAC-02` byte-identical rebuild; `SF-CONN-OFAC-03` field-count drift fails closed; `SF-CONN-OFAC-04` three-signal disagreement reported, not resolved silently; `SF-CONN-OFAC-05` row count vs `Record_Count` mismatch becomes `degraded`; `SF-CONN-OFAC-06` stale index versus live header detected; `SF-CONN-OFAC-07` a zero-candidate result never renders "clear" (lint on templates).

### 11d Wikidata
- **Verified** (R14, probes): Wikimedia requires a descriptive User-Agent with contact and forbids browser mimicry; `wbgetentities` and `Special:EntityData/<QID>.json` return 200 (Q312 is "Apple Inc."; P856 "official website", P1278 "Legal Entity Identifier", P5531 "Central Index Key" exist). Terms and rate limits: NOT VERIFIED beyond the policy page. CC0 for structured data (02 §5).
- **Role.** Alias and identifier *discovery* only (spec §6). Authorship `third_party` (crowd-edited), tier `secondary`, everything `UNTRUSTED`; never a decision source for identity, ownership or sanctions. SPARQL is deliberately not wired (its use would turn Wikidata into an ownership source; reopening condition: a measured benefit and an authoritative cross-check).
- **Queries.** `{kind: "search", text}` (`wbsearchentities`, name egress class) and `{kind: "entity", qid}`. Outputs: labels, aliases, `P856` as a `UrlCandidate{origin: "wikidata:P856"}` (never auto-fetched), external ids as candidate links. Entity JSON carries `last-modified` and `cache-control: private, s-maxage=0, max-age=0` (02 §5); revalidation by `If-Modified-Since`.

### 11e CourtListener
- **Verified** (R14): v4, token via `Authorization: Token <token>`; authenticated limits 5 per minute, 50 per hour, 125 per day on rolling windows, all applied at once; one account per project; anonymous limits NOT VERIFIED; search (`type=o`) answered anonymously while dockets returned 401 (02 §5). Reuse terms NOT VERIFIED.
- **Role.** A US search aid (spec §6), authority `secondary`; party and case names are third-party-authored free text, UNTRUSTED. Query `{kind: "opinions", phrase, court?, filedAfter?}`; phrase queries (name egress class). First page only: `count` larger than the page makes the outcome `partial` with the count in `coverage`; zero results is `ok` with "not a litigation clearance". The persisted windows (component 3) make daily budget exhaustion a typed `rate_limited` that the router uses as a rejection reason.
- **Tests extras.** `SF-CONN-CL-05` window exhaustion across restarts; `SF-CONN-CL-06` token never appears in trace, doctor or cassette.

### 11f RSS and Atom
- **Design.** Feeds are pack data (URL, purpose, secondary tier); no feed was verified (02 §5). Fetch by conditional GET (one fetch per TTL). Parser: pre-scan rejecting any document containing `<!DOCTYPE` or `<!ENTITY` before it reaches the XML library (defence against entity expansion without depending on library flags), then `fast-xml-parser` with entity processing off (metadata verified, not read: **its entity and nesting limits are NOT VERIFIED**, and a hostile-feed fuzz set decides whether it stays), item cap 200, field length caps, strict RFC 822 and RFC 3339 date parsing (an item without a parseable date gets no `effectiveAt` and a flag). Evidence per feed fetch with `locator.field` pointing at the item. Titles and summaries are free text, UNTRUSTED. Item links become `UrlCandidate{origin: "rss-item"}` only.
- **Tests.** `SF-CONN-RSS-01` billion-laughs and external-entity fixtures rejected before parsing; `SF-CONN-RSS-02` 304 handling; `SF-CONN-RSS-03` duplicate guid handling; `SF-CONN-RSS-04` date edge cases.

### 11g Direct web fetch (`web-direct`)
- **Design.** Reaches arbitrary public hosts only for a `UrlCandidate` (component 18), through the full pipeline of component 2 including DNS pinning. Identifiable agent `PlumblineFabric/<version> (<contact>)`; robots.txt fetched and honoured (the Robots Exclusion Protocol, RFC 9309, not read this session) with a cached per-origin decision; allowed content types `text/html`, `text/plain`, `application/pdf`, `application/json`; caps 5 MiB (PDF 25 MiB by config). HTML to visible text by a deterministic extractor on a spec-compliant HTML parser (`parse5` is the candidate; metadata verified, behaviour not read): drop `script`, `style`, `template`, `noscript`; count and record text under `hidden`, `aria-hidden`, inline `display:none`, `visibility:hidden`, zero font size as a **hidden-text signal** (parity with M2's hidden-text defence); links become candidates. Output is `UNTRUSTED` text bytes plus `visibleText` bounded at 200,000 characters, consumed only by the quarantined extractor. PDFs are stored and handed to M2 unparsed.
- **Tests.** `SF-CONN-WEB-01` robots deny; `SF-CONN-WEB-02` hidden-text fixture counted; `SF-CONN-WEB-03` meta-refresh and JavaScript redirects are not followed (reported as unfollowed hops); `SF-CONN-WEB-04` SSRF corpus again through this channel.

### 11h Jina Reader (discovery only)
- **Facts** (R13, 02 §5): `GET https://r.jina.ai/<absolute URL>`; the target URL is disclosed to a third party; pages are cached for 3,600 s unless `x-no-cache`; anonymous traffic is the most aggressively limited (observed `20 per 60 s`); retention is not stated. R1's `WebChannel.read` wraps it with a 30 s timeout, a 5 MiB cap and the challenge detector (read).
- **Role.** `evidenceUse: "discovery"`. Its output may suggest queries, candidate aliases and candidate URLs; `Evidence.use` is `"discovery"` and `isDecisionAdmissible(ev)` (pure, in M1, derived from `use`, INT-006) returns false, and M3 and M4's L0 refuse to cite it (spec §6 and review REC-03). The proxy is recorded in the evidence `authenticity` dimension (retrieved through a third-party renderer, body is its transformation). Egress class for the target URL is logged. Never used for private documents (the pipeline rejects URLs whose host is not public, and the egress guard rejects any `internal-sensitive`-labelled value).
- **Tests.** `SF-CONN-JINA-01` discovery evidence cannot be admitted as a citation (M4 contract test); `SF-CONN-JINA-02` 429 handling with `Retry-After`; `SF-CONN-JINA-03` challenge fixture; `SF-CONN-JINA-04` cache staleness noted in coverage.

### 11i Simulated account-verification channel (`acct-verify-sim`)
- **Why.** No public authoritative source exists for bank-account ownership (15 §4); release fields accept `SOR` or a `VERIFIED` fact from an account-verification channel or attestation (spec §5). Payee-verification schemes exist; their legal texts were not read (15 §4), so this channel *models* the interface and claims nothing about real schemes.
- **Design.** Backend: seeded synthetic directory generated by M11 (`data/silos/acct_verification.jsonl`), always `synthetic: true`, authority `synthetic`, `simulatedAuthority: true`. Query `{payeeId, accountCommit}` where `accountCommit` is the `Commitment` produced by the silo view's `salted_hash` mask (class `case-visible`; a raw account number is unrepresentable in the query type). Response `AccountVerification { outcome: "match" | "close_match" | "no_match" | "unable_to_verify", method: "callback" | "name_match" | "bank_letter", verifiedAt, verifierId, ageDays }`, bands only (no floating scores). Scenarios supplied by the generator: verified callback, name mismatch, not found, stale verification (older than a pack threshold), account owned by a third party, recently changed account. Every dossier line using it prints SIMULATED. The channel is behind the same contract as a future real provider, so a real adapter needs only its own parser and licence row. It never mints an attestation (M13/M8 own typed attestation steps).
- **Tests.** `SF-CONN-ACCT-01` raw account number cannot reach the query; `SF-CONN-ACCT-02` outcome table covers every generator scenario; `SF-CONN-ACCT-03` SIMULATED label present in every rendering (lint).

### 11j Document intake (`doc-intake`)
- **Why.** Nothing else delivers the hero case's audit, certificate and contract to M2 (INT-041). The labels are a security decision (M8 §C9), so they are fixed here by source and never supplied by a caller.
- **Three sources.** (a) Case attachments from M10/M13 intake: authorship `counterparty` unless the pack declares the submitter role otherwise, trust `UNTRUSTED`. M13's `submitCase` carries `attachments: {name, mediaType, size, bodyHash}[]` and delivers the bytes to the content store by hash. (b) The internal document lake through `SiloPort` (the `documents` view of section 15: metadata plus the bytes as a base64 column under a per-cell cap): trust ceiling `EXTRACTED`, authorship from repository metadata. (c) Web-fetched documents (`web-direct`, 11g): `UNTRUSTED`, `third_party`.
- **Output.** `Evidence` with a `Commitment` `bodyHash` (INT-003; the `RawHash` store key stays internal), `locator: { kind: "doc", ref, docSha }`, a rights class (`local_body` unless synthetic) and size and type caps, plus `DocumentRef { evidenceId, docSha: RawHash, mediaType, size }` for M2, whose input is a blob reference and not a channel. M1 re-hashes delivered bytes against the declared hash and rejects a mismatch. Intake caps (count, size, type) are M13's and M1 re-checks size and type; content checks are M2's.
- **Tests.** `SF-CONN-DOCIN-01` hash mismatch rejected; `SF-CONN-DOCIN-02` each source gets exactly its fixed authorship and trust, whatever label the caller sends (property test); `SF-CONN-DOCIN-03` oversize and disallowed type rejected before storage; `SF-CONN-DOCIN-04` the lake path cannot return a base table.

**Risks / NOT VERIFIED (all connectors).** Field names of SEC documents, GLEIF paging limits, the stability of the OFAC "PublicationPreview" endpoint, Wikidata and anonymous CourtListener limits, reuse terms of SEC, OFAC and CourtListener, EU, UN and UK list terms.

**Build notes.** Order: GLEIF (CC0, simplest, exercises everything), Wikidata, OFAC (index builder is the largest piece), SEC, CourtListener, RSS, web-direct, Jina, account-verification sim, document intake (11j, with the content store).

## 15. Component 12: SiloPort, typed data contract, role-scoped views

**References.** R19 (Zetaris readout ideas 1, 2, 3, 5; `LOAD USL`, DQ, grants), R21 (Substrait, Calcite, ODCS named only), R20 (FollowTheMoney statement storage), 07 §3 (bitemporal), 10 §D.2.

**What they do (documented, not run).** Zetaris compiles scalar-typed DDL into a USL, activates a table with `ACTIVATE USL TABLE ... AS SELECT` after checking the query matches the declared schema, returns the model as JSON with `LOAD USL`, evaluates PK, UNIQUE and FK rules with `RUN DQ` (total, valid, invalid counts), and grants `SELECT` on views to roles under an explicit-allow model; row and column policies are UI-configured and have no SQL form in the command reference; most create, grant and register commands are administrator-only (readout §2.4, §2.5). Substrait and Calcite are standards or frameworks for expressing a relational plan once and emitting several engines' SQL; we did not read either, so they are named only as the alternative to the small IR below.

**Decision.** Own a small relational-view IR and a contract file. Reject adopting Substrait or Calcite: we need about six operators over a handful of tables, a JVM or Rust dependency would break the judge path, and our compilation targets are exactly two (an interpreter and Spark SQL) plus ANSI SQL for test oracles. Revisit if the view language grows past joins, filters, projections, masks and ordering. Reject free SQL from any agent (spec §19 rejection of NL-to-SQL).

**Design.**

```ts
interface SiloContract {                       // silo-contract.v1.json, JCS-hashed => contractHash
  version: 1; systems: SystemDecl[]; tables: TableDecl[]; views: ViewDecl[]; roles: RoleGrant[];
}
interface TableDecl { system: string; name: string; columns: ColDecl[]; primaryKey: string[]; uniques?: string[][]; foreignKeys?: FK[]; bitemporal?: boolean }
interface ColDecl { name: string; type: "string" | "int" | "decimal" | "date" | "timestamp" | "bool"; precision?: number; scale?: number;
                    nullable: boolean; conf: Confidentiality; personal: boolean }
interface ViewDecl { id: ViewId; params: ParamDecl[];            // typed; string params use hex-literal passing (below)
                     plan: Plan;                                 // scan | filter | join(on keys) | project(expr) | orderBy | limit
                     columns: OutCol[];                          // type, conf, personal, source column(s), masker
                     orderBy: string[];                          // mandatory total order (SQL has no implicit order)
                     maxRows: number; lineage: { system: string; table: string }[];
                     versionExpr?: string }                      // column or aggregate (for example max(recorded_at)) read by SiloPort.version
type Masker = "raw" | "mask_last4" | "salted_hash" | "omit";
interface RoleGrant { role: SiloRole; views: { id: ViewId; maskers: Record<string, Masker> }[] }  // base tables are never granted
```

*Ownership (INT-046).* M1 owns the contract (tables, columns, types, `conf`, `personal`, the `last_write_*` and `editor_sub` columns, views including `documents`, masks, roles); it is published at the stable path `packs/procurement/silo-contract.v1.json` and hashed as `contractHash` (a `DocHash`). The M11 generator reads that file only, never system code, records `contractHash` in `gen-manifest.json` and emits conforming data plus planted violations declared as labelled deviations.

*Roles* (5; INT-008 settles the 3 versus 4 in the spec): `agent` (every automated and LLM-bearing component; masked and hashed fields only; never raw bank details), `buyer` (human, masked), `reviewer` (human, full), `approver` (human, full), `broker` (M13 only; raw account for payment and independent confirmation; no other tables). In Zetaris each role is a user identity bound to a role granted `SELECT` on views only; embedded enforces the same grants in code. `SiloRole` is the shared data-access identity; M13's `RbacRole` maps to exactly one `SiloRole` through a data table that M1 accepts as input and never infers (default `agent` for automated components; a principal with no mapping gets no `SiloPort`).

*Masks.* `mask_last4(x)`; `salted_hash(x)` is a `Commitment` (`com:<hex>`, SHA-256 over the salt, the domain tag `plumbline/m1/mask/v1` and `normalise(x)`, INT-003) and is the value `ReleaseBinding.accountCommit` carries, which the broker recomputes from its raw `broker`-role read; the salt is per deployment and kept outside the data (the readout's "salted sha2"; availability of `sha2` in the event instance NOT VERIFIED); `normalise` strips spaces and case for IBAN-like values. Equal hashes across systems detect reused accounts without exposing the number. The salt is visible to a Zetaris administrator; stated residual.

*Parameters and injection.* Zetaris REST takes SQL text without documented bind parameters (readout §2.2), and several parameters (names) come from untrusted documents. The SQL compiler therefore **never interpolates a string**: string parameters are rendered as `decode(unhex('<hex>'), 'UTF-8')` over a validated `[0-9a-f]*` literal (any Unicode value representable, no quote or escape path), integers and dates only after strict regex, and the compiled statement is checked to contain no `;` (one statement per execution is a Zetaris rule). Availability of `unhex` and `decode` on the instance is NOT VERIFIED and is the first contract test on a trial.

*Typed results.* `SiloResult<V> = { rows: Row<V>[]; rowCountDeclared: number | null; rowCountReceived: number; completeness: "complete" | "partial"; contractHash: DocHash; serverVersion: string | null; transport: "rest" | "jdbc" | "mcp" | "embedded"; auditCorrelationId: string | null }`. Each row becomes an `Evidence` (`locator: record`, `raw` the wire strings, `normalised` the typed values, `parserVersion` the decoder version), trust assigned by component 8 using `last_write_origin`, `conf` taken from column declarations (a masked column drops to the masked class); `bodyHash` is a `Commitment` over the canonical row because `conf` is above `public`. A page is `partial`, never silently truncated, when `rowCountReceived > maxRows` (query `maxRows + 1`) or the count mismatches.

*Contract pinning.* At connect, the port computes `deployedHash` by canonicalising the live model (`LOAD USL` JSON or `DESCRIBE`) into the contract's subset and compares it with `contractHash`; mismatch is `contract_drift` (fail closed, diff listed). Unmappable live fields are listed, not ignored. Optional `RUN DQ` counts are compared with the generator's planted counts (administrator-only). Authority and tier data are **never read from Zetaris** (readout idea 6): the repository's table is authoritative and catalog tags serve only as a drift detector that can add an escalation.

*SiloPort.*

```ts
interface SiloPort {
  readonly id: string; readonly contractHash: DocHash; readonly role: SiloRole;
  query<V extends ViewId>(q: SiloQuery<V>, ctx: Ctx): Promise<Result<SiloResult<V>, SiloError>>;
  describe(ctx: Ctx): Promise<Result<ContractProbe, SiloError>>;
  version(view: ViewId, ctx: Ctx): Promise<Result<{ view: ViewId; version: string; observedAt: Iso }, SiloError>>;   // cheap change token from the view's versionExpr; M13 world re-validation
  probe(ctx: Ctx): Promise<Probe>;               // runs the canary view
}
```

*Canary view* `silo_canary`: one fixed row with an int, a decimal with scale, a date, a timestamp, a string with a quote and a non-ASCII character, a bool and a null; the live decode must equal the expected typed row. It proves the decoder and the contract on the real instance in one call.

*Federation.* Candidate retrieval views may join across systems on deterministic keys (reused account hash, reused tax id, payments to ids absent from the master) because Zetaris can reach several backends; aggregates are never used as evidence (M4 needs row-level evidence) and every output row keeps `source_system`, `record_id` (readout idea 1 constraints). In the embedded layer the same views run over multiple tables.

**Tests.** `SF-SILO-01` role matrix (agent reads the masked view; base table refused; raw column refused) on embedded and, when available, Zetaris with identical visible columns; `SF-SILO-02` injected-document test: a hostile name is rendered through hex literals and the compiled SQL contains only `[0-9a-f]` inside the literal (property test over arbitrary Unicode); `SF-SILO-03` contract mutation (drop a key, change a type, rename a view) gives `contract_drift`; `SF-SILO-04` ablation: with the embedded layer set to no masking and the gate disabled, raw account numbers appear in prompt logs, with masking none do; `SF-SILO-05` `last_write_origin = vendor_portal` row, or a row with a missing provenance column, yields `UNTRUSTED` bank fields; `SF-SILO-06` differential: 200 planted cases through embedded and Zetaris (or its recorded cassette) give identical evidence sets ignoring order; `SF-SILO-07` ordering: row order equals the declared `orderBy` on every transport; `SF-SILO-08` role map: an unmapped principal is denied and every mapped `RbacRole` resolves to exactly one `SiloRole`; `SF-SILO-09` `version(view)` changes after a planted write and not otherwise.

**Metrics.** Differential disagreement count (target 0); fraction of Zetaris fault classes mapped to a typed non-success (target 100%, component 13).

**Risks / NOT VERIFIED.** Everything about Zetaris behaviour (administrator rights, availability of `unhex`, `decode`, `sha2`, `LOAD USL`, which REST flavour, role-bound identities, view-level grants over JDBC versus REST). If participants are not administrators, the role-scoped and USL features run only on a local install with recorded cassettes (readout §5, unspecified fact 2). The minimum viable integration in spec §19 (a documented read over whatever the event instance exposes, rows entering a decision, a cassette, a fallback) needs only `query` and a contract subset.

**Build notes.** Contract, IR and the embedded interpreter first (component 17; the contract file is published at its stable path first so the M11 generator can read it), then the SQL compiler, then transports.

## 16. Component 13: Zetaris REST transport (decoder and fault injection)

**References.** R19 (readout §2.2: two REST surfaces; strings and exponent decimals; `pageLimit` 1 to 100; `queryToken` paging and close; REST tables re-issued per query; `CACHE TABLE` expiry), R12 and R1 (retry and error handling patterns).

**What they describe.** Local flavour: `POST /sql-editor/sqls/run` returns `{"headers":[...],"data":[[...]],...}` with every value a string and decimals such as `0E-18`; headers `X-Org-ID` (integer), `X-Request-ID` (UUID); bearer API key created in the GUI. SaaS flavour: login for `idToken`, `POST /query/sql/start` with `{select, pageLimit}`, `GET /query/sql/page`, `DELETE /query/sql/close/{queryToken}`; the query endpoints require an API-token bearer. The public OpenAPI file is served unauthenticated for the SaaS surface; which flavour the event instance exposes is NOT FOUND.

**Decision.** Own, with two flavour adapters behind one `ZetarisRest` class chosen by probe, and a simulated server in tests (we cannot run the vendor's platform on the judge path or without an account).

**Design.**
1. Requests go through the component 2 pipeline with the allowlist set from config (`ZETARIS_BASE_URL`, https required except an explicit loopback development override that is refused outside `record`/`live` development profiles); credentials from environment, never in URL, cassette or trace; one statement per request; `X-Request-ID` from `ctx.ids`; `X-Org-ID` from config.
2. **Decoder** (`decodeCell(type, raw)`, pure): `int` strict `^-?\d+$` into BigInt-checked range; `decimal(p,s)` accepts `0E-18`, `1.5E+3`, plain forms, converts with integer arithmetic to a canonical decimal string (no floats anywhere, JCS profile) and rejects values exceeding precision or scale; `date` strict `YYYY-MM-DD`; `timestamp` requires an explicit zone or a contract-declared session zone (the zone the instance uses is NOT VERIFIED; the canary decides); `bool` only `true` or `false`; JSON `null` is null, and the string `"null"` or `""` is data unless the column is declared `nullToken`. Unknown or extra columns are `contract_drift`.
3. **Paging and counts.** Query-paged flavour: iterate pages to `totalPages`, compare `totalCount` with rows received and the declared `maxRows`; always close the token (also on error). Sql-editor flavour: request `maxRows + 1` rows, mark `partial` on overflow; a helper-style row cap in the server or a count mismatch with a companion count view is a typed `partial`, never a pass. Duplicate rows across pages (by primary key) are an error.
4. **Errors.** 401 with a refresh path tries one refresh then fails `auth_required`; 429 and 502 follow component 3; timeouts are per query with a declared per-view `budgetMs` (a 2 s Schema Store limit appears in an old article, current behaviour unknown); an HTML or empty body is `challenge_page` or `empty_unexpected`.
5. **Fault injection** at the transport port (`FakeZetarisServer` serving both flavours over the embedded store, with a seeded fault schedule; the same faults can wrap a recorded cassette): each fault class has one expected typed outcome.

| Fault class (source in the readout) | Expected outcome |
|---|---|
| REST-backed table re-fetched, rows differ between two identical queries | the run memo pins the first result; a second divergent read inside the run raises `drift_within_run` evidence note and `partial` coverage |
| `CACHE TABLE` expires silently, later query returns fewer or no rows | row count versus the generator's expected band (canary and per-view `expectedMin`) fails: `unavailable{stale_source}`, never empty success |
| every value a string, exponent decimals | decoder converts exactly; an unparseable cell is `parse_error` with column and row |
| string `"null"` or empty string for null | follows the column's declared nullability, else `parse_error` |
| `totalCount` less than or greater than rows received | `partial` with both numbers in `coverage` |
| truncated page, short last page, duplicate rows | `partial` or `parse_error` |
| 401 mid-run, 429, 502, timeout | per component 3; no empty success |
| schema drift (renamed or retyped column) | `contract_drift` |
| role downgrade (view refused) | `blocked_by_policy` with the role named |

6. **Cassettes.** Entry key (`requestKey`, a `DocHash`) over `{ channel: "silo", view, params (canonical typed), role, contractHash }`; stores the wire rows (strings) **and** the decoded rows, so replay re-runs the decoder; also `serverVersion` (`SHOW SERVER VERSION`), `queryToken` page structure, counts, `auditCorrelationId`. Synthetic data only, so `public_body` class. `serverVersion` is not in the key (a version difference should not be a miss) but a mismatch with the recorded value is reported in coverage.

**Tests.** `SF-ZR-01..10` one per fault class plus decoder property tests (random decimals round-trip through string forms; exponent forms equal their plain forms); `SF-ZR-11` replay equality; `SF-ZR-12` token close on every path; `SF-ZR-13` credentials absent from every artefact; `SF-ZR-14` cassette from the fake server equals shape of a recorded real session once one exists (shape-parity test, gated on a trial).

**Risks / NOT VERIFIED.** Both flavours' exact responses on the event instance; whether one cassette per case is enough for the Zetaris segment of the demo; the fake server is only as true as the documents it was written from.

**Build notes.** After 12 and 17. Unblocks the Zetaris sponsor proof (a real query whose rows enter a decision) the moment credentials exist.

## 17. Component 14: Zetaris JDBC bridge

**References.** R19 (readout §2.2: driver class `com.zetaris.lightning.jdbc.LightningDriver`, URL `jdbc:zetaris:lightning@<host>:<port>`, JAR from the platform download rather than Maven, JDK 11+, user and password).

**What it is.** The hackathon repository's second supported route. Node has no JDBC; the driver is a vendor JAR we cannot redistribute.

**Decision.** Own a small JVM bridge, used at **record and live time only**. It is not on the judge path (the judge has cassettes and no JAR or JDK requirement), which narrows the spec's "REST and JDBC first": REST is the live path judges could run with credentials, JDBC is an independent transport and a **typing oracle** (JDBC returns typed column metadata, so we can verify the REST decoder against real types). A JDK 17 exists on the development machine; the bridge targets JDK 11 or later.

**Design.** `tools/zetaris-jdbc-bridge/` (about 200 lines of Java, source in the repository; the vendor JAR path comes from `ZETARIS_JDBC_JAR`, never committed). Spawned with `child_process` only in `record` or `live` profiles (the permission flag `--allow-child-process` is withheld from `replay`, R15). Protocol: line-delimited JSON over stdio, one request per line `{id, sql}`, response `{id, columns:[{name, sqlType, precision, scale, nullable}], rows:[[...]], rowCount}` with decimals and timestamps rendered as strings in canonical form; frame size cap 8 MiB; credentials passed through the environment of the child, never argv; SQL is exactly the compiled view SQL of component 12. The adapter implements the same `SiloTransport` interface as REST; cassette entries add `wire: "jdbc"` and the typed metadata. A **type-parity test** runs every canary and view through REST and JDBC and compares decoded values and declared types.

**Tests.** `SF-JDBC-01` bridge protocol fuzz (malformed frames, oversized frames, early exit: typed failure, no hang); `SF-JDBC-02` credentials absent from the process list and artefacts; `SF-JDBC-03` REST-versus-JDBC parity (gated on a live instance); `SF-JDBC-04` replay of a JDBC cassette needs no JVM.

**Risks / NOT VERIFIED.** Driver licence and whether it may be used by participants; driver behaviour (typed metadata, view-level grants) over a shared event instance; Windows process handling of the child.

**Build notes.** Last of the transports; only after a trial account exists.

## 18. Component 15: Zetaris MCP client (fallback)

**References.** R18, 12 §10.1 (nine design points), 10 §A10 (tool poisoning, rug pull, MCPTox: 72.8% highest attack success reported by the paper's authors across 20 agents), R19 (vendor page claims read-only, identity-bound, audit logged; tool names, URL, auth, revision NOT FOUND; "MCP Toolkit" listed as Enterprise-only).

**What they do.** The MCP specification (revision 2026-07-28 per 12 §10.1) makes requests stateless, lets `tools/list` change over time, treats annotations as untrusted, and replaces server-initiated requests with `input_required`. The TypeScript SDK exposes `listChanged` handlers and a `jsonSchemaValidator` option on the client, and a `FetchLike` type for injecting a fetch implementation (read in `shared/transport.ts` and `client/client.ts`).

**Decision.** Adopt the official SDK client behind our wrapper (it tracks protocol revisions we should not re-implement; its licence statement is a mixed MIT to Apache-2.0 transition, both permissive; pin the version). Own the pinning, allowlist, cassette and decode layers. Keep it a **fallback**, which matches spec §6 and §21a (gated by a source that needs it and a contract test). Key simplification: MCP is used here as a *transport for compiled queries issued by code*, not as an agent tool surface, so no model ever reads a server-supplied description (the poisoning path does not exist unless a future change shows descriptions to a model, which a test forbids).

**Design.**
1. Inject our pinned, redirect-validating, cassetting fetch as the SDK's `fetch` (whether the streamable-HTTP transport accepts an injected fetch is **NOT VERIFIED**; the fallback is a custom `Transport` object that records and replays JSON-RPC frames, which the SDK's `connect(transport)` accepts per the interface file).
2. **Surface pin.** On connect, canonicalise every tool `{name, description, inputSchema, outputSchema, annotations}` with JCS, hash each and the whole list; compare with `pins/zetaris-mcp-surface.json`; mismatch, or a `listChanged` notification mid-run, aborts with `tool_surface_changed`. First pin creation requires an explicit human command (`--pin-surface`), never trust-on-first-use inside a run; an unpinned surface is `unverified` in the doctor.
3. **Allowlist** by tool name from `registry/zetaris-mcp-tools.json`, which stays empty until a trial shows real names. Natural-language-to-SQL and agent-flow tools are never listed. Tools from different servers are prefixed.
4. Results: validate `structuredContent` against the advertised `outputSchema` when present, then decode with component 13's decoder into our rows; mismatch is `unavailable` or `partial`, never repaired. Tool annotations are ignored for any decision.
5. `input_required`, elicitation and sampling requests are not answered; they become `needs_human` and fail closed on expiry (M13 queue).
6. Credentials are our service identity with an audience-bound token; no token passthrough; minimal scopes.
7. Cassette at the JSON-RPC level (request hash to response frame list) with the surface hash in the key; a replay miss is an error.
8. SSRF rules of component 2 apply to any discovery or OAuth metadata fetch the client performs.

**Tests.** `SF-MCP-01` against a stub MCP server we write: surface change, `listChanged` mid-run, tool not in the allowlist, schema mismatch, `input_required`; `SF-MCP-02` replay with surface hash; `SF-MCP-03` a poisoned description never reaches any model prompt (taint test on the trace); `SF-MCP-04` token never forwarded. Metric: with the stub, 100% of the surface mutations fail closed.

**Risks / NOT VERIFIED.** Tool names, URL, auth, protocol revision spoken by Zetaris, whether the feature exists on the event instance, SDK injected-fetch support.

**Build notes.** Only when the trial shows an MCP endpoint (spec §21a gate). The stub server and tests can be built earlier.

## 19. Component 16: audit-log cross-check

**References.** R19 (readout idea 4: an audit log is claimed, with timestamp, identity, exact query, sources, row count, latency, errors; **no read path found** in the 144 commands, the SaaS OpenAPI or any article; the local bundle has an "audit database" in postgres; per-user history files exist in the Freemium layout).

**Decision.** Own, MAYBE-gated exactly as the readout says: an optional live-only evidence line, never a correctness dependency, and softened wording until a read path exists (Spec feedback on §19 "Kept").

**Design.**

```ts
interface AuditReader { readonly kind: "none" | "postgres_audit_db" | "rest" | "export_file";
  read(window: { from: Iso; to: Iso }, identity: string): Promise<Result<AuditEntry[], AuditError>> }
interface AuditEntry { at: Iso; identity: string; text: string; sources?: string[]; rowCount?: number; latencyMs?: number; error?: string; requestId?: string }
interface AuditReconciliation { ours: number; theirs: number; matched: number;
  unlogged: QueryRef[];      // we issued, no entry: alarm (live), or "replay posing as live"
  unknown: AuditEntry[];     // entry under our identity we did not issue: possible credential misuse
  ambiguous: QueryRef[]; skewMs: number | null }
```

Algorithm: (1) our trace gives the list of live silo queries with `requestId`, normalised SQL hash, issue time, role identity; (2) read the window `[first - skew, last + skew]` for that identity; (3) match by `requestId` when entries carry it (NOT VERIFIED that they do), else by identity, normalised text hash and time within a tolerance estimated from matched pairs; (4) classify; (5) write an `Evidence` per matched entry (`channel: zetaris-audit`, witness of Zetaris-side execution only) linked from the silo evidence; (6) strict mode (sponsor proof) fails the run on `unlogged` or `unknown`, default mode reports. In replay the reconciler returns `not_applicable{replay}`, and a cassette presented as live is detected because it has no requests to match. Independence is partial and stated: the log witnesses Zetaris-side execution under an identity, not our process integrity, and a reader identity that can also query weakens isolation (a separate read-only identity is preferred).

**Tests.** `SF-AUD-01` planted unlogged query raises the alarm; `SF-AUD-02` planted foreign query raises `unknown`; `SF-AUD-03` retries and paging do not create false alarms (normalisation property test); `SF-AUD-04` replay returns `not_applicable`; `SF-AUD-05` if no read path is found, the outcome is `not_checked` with the list of places searched recorded (the negative result is documented, per the project rule on negative findings).

**Risks.** The whole component may have no data source; the design costs one adapter interface and a fake.

## 20. Component 17: embedded silo store

**References.** R19 (Zetaris lists DuckDB as an engine; bake-off 5 candidates `node:sqlite` experimental on Node 22 and DuckDB), spec §19a item 5 and F-RUN (file-backed append-only on the judge path), R20 (per-statement storage with first-seen and last-seen), 07 §3.1 (bitemporal semantics), R21 (`sqlancer/sqlancer`: logic-bug testing of database engines, not read).

**What they do.** FollowTheMoney keeps raw and normalised values and observation times per statement; bitemporal engines separate valid time from system time. We do not need an engine for a few thousand rows; we do need Zetaris parity.

**Decision.** Own: a file-backed, append-only store plus an interpreter for the view IR (judge path, zero dependencies). `node:sqlite` or DuckDB are used only as **test oracles** (the compiled ANSI SQL of each view runs there and must equal the interpreter) pending bake-off 5.

**Design.**
- Layout: `data/silos/<system>/<table>.jsonl` (one JSON object per line, sorted keys, no floats; decimals as strings), `data/silos/manifest.json` (per-file hash, generator seed and version, contract hash, row counts). Loading verifies hashes and the contract, builds in-memory hash indexes on declared keys. Tables are read-only to SiloPort; only the generator and tests write them.
- Bitemporal history tables (`vendor_bank_history`, ownership slices) carry `valid_from`, `valid_to`, `recorded_at`, `superseded_at`; as-of views take `asOf` and `knownAt`; rows are never deleted, only superseded.
- Write provenance columns on `vendor_master`: `last_write_origin` (shared `WriteOrigin`: `attested | internal_initiated | system_migration | vendor_portal | vendor_email | unknown`), `last_write_actor`, `last_write_at`, `change_request_id`, `request_origin`, `editor_sub` (INT-024). The M11 generator plants them in every bank-detail-change scenario family (origin and editor set, including requester-edits-then-approves and portal-edit cases) and the gold labels follow. A missing column makes the field `UNTRUSTED`.
- Interpreter: `evaluate(view, params, role, tables)` is pure; it checks the role grant first (a role without a grant gets `blocked_by_policy`), applies maskers (pure functions identical to the SQL expressions), enforces `orderBy` and `maxRows + 1`, and returns `SiloResult` with `transport: "embedded"`. There is no API to read a base table.
- Both implementations (this and Zetaris) are produced from the same `ViewDecl`; `compileSql(view, dialect: "spark" | "ansi")` is pure and golden-tested.
- Scale: not claimed (spec §21c item 6); the interpreter is O(rows) per view with indexes on declared keys; a measurement is reported before any scale statement.

**Tests.** `SF-EMB-01` interpreter equals ANSI SQL on the test oracle for every view over 2,000 generated parameter draws (SQLancer-style metamorphic checks: partition a filter into complementary predicates and compare unions; add a redundant predicate); `SF-EMB-02` role matrix identical to `SF-SILO-01`; `SF-EMB-03` same output on two machines and two Node versions; `SF-EMB-04` as-of queries equal an independent hand-written bitemporal oracle on planted histories; `SF-EMB-05` file tamper detected by the manifest; `SF-EMB-06` no code path reads a base table for any role (AST test). Differential metric: disagreement count 0 over all draws.

**Risks.** Parity can only be demonstrated against Zetaris with an instance; until then the Spark compiler is checked by golden text and, loosely, by ANSI-oracle equivalence.

**Build notes.** First of the silo components; the contract comes first and the generator (M11) reads it (INT-046).

## 21. Component 18: source discovery and routing (F-DISCOVER)

**References.** R17 (marginal-gain source selection), R2 (`LLMSingleSelector`: a model picks one tool from natural-language descriptions and its output is parsed), R3 (`ConditionalRouter`: data-declared conditions evaluated in a sandboxed template environment, raises `NoRouteSelectedException` when none match), R20 (authority and BODS types), spec §21 F-DISCOVER and F-REPLAN, 12 §8 (planner is deterministic code).

**What they do.** R2's selector asks a model which tool fits and parses text: nondeterministic, no recorded reason, nothing to replay. R3's router evaluates declared conditions and fails explicitly if no route matches, which is the behaviour we want. R17 shows that adding sources can lower fused quality and that a source should be added only while its marginal gain exceeds its marginal cost, and it needs source accuracies estimated from ground truth, which we replace with declared authority ranks and declared required-origin counts (principle 8).

**Decision.** Adapt R3's explicit-failure routing and R17's stop rule; own a deterministic router driven by the authority table. Reject an LLM selector (R2) for channel choice. Query construction is deterministic by default; the web-discovery role is conditional (INT-023): a model may only propose `Proposal<DiscoveryQuery>` validated by M8's grammar, and only if M14's ablation shows a gain.

**Design.**

```ts
interface SubQuestion { id: string; attribute: string; subject: SubjectRef; requirement: "release_enabling" | "hold_check" | "context";
                     requiredChannels: string[]; requiredOrigins: number }   // requiredChannels from the authority table (M3 reads the same name); requiredOrigins = distinct origins of them per origins.json
interface SubjectRef { kind: "org"; ids: { lei?: string; cik?: string; vendorId?: string; qid?: string; regNo?: { jurisdiction: string; number: string } }; names: Labelled<string>[] }
interface Candidate { channel: string; rank: number; canHandle: { ok: boolean; why: string }; health: HealthStatus; rights: "ok" | "gated"; budget: "ok" | "exhausted"; disclosure: "ok" | "name_blocked_by_profile";
                      decision: "chosen" | "rejected" | "deferred"; why: Why }
interface RoutingPlan { subQuestionId: string; candidates: Candidate[]; chosen: string[]; stop: { rule: string; originsCovered: number; originsRequired: number }; version: DocHash }
function route(sq: SubQuestion, table: AuthorityTable, snapshot: ProbeSnapshot, queried: Set<string>, ctx: Ctx): RoutingPlan   // pure
```

Algorithm (numbered, deterministic):
1. List rows of the authority table for `sq.attribute`, ordered by declared `rank`.
2. For each row compute `canHandle(sq.subject, attribute)` (needs identifiers the channel requires, or a name where `disclosureProfile` allows it: under `public_lookup` only when no identifier exists, INT-021), the probe state from the snapshot (`ok` or `degraded` pass; `off`, `error`, `unverified` reject with the reason), the rights status, the budget windows (a CourtListener day quota exhausted rejects), and the disclosure profile.
3. Choose rows in rank order. Continue to the next row only while `originsCovered < requiredOrigins` or the higher-ranked channel returned `unavailable`, `rate_limited` or `blocked_by_policy`. This is R17's stop rule with declared quantities instead of estimated accuracy. Channels that share an origin (declared in the pack's `origins.json`) count once.
4. Every decision carries `why` with `kind: "rule"`, rule ids such as `route.authority_first`, `route.origin_quota`, `route.fallback_on_unavailable`, `route.reject_unprobed`, `route.disclosure_profile`, and codes. No candidate usable gives `not_checked` for that sub-question (with the reason), never a silent empty plan.
5. `plan.source_routing` is written to the trace with chosen and rejected channels per sub-question. A `request_more` edge from M3 (unresolved conflict with an unqueried higher authority) calls `route` again with `queried` extended; F-REPLAN's visit limit lives in M7.
6. **Discovery candidates.** `UrlCandidate { id, url, origin: "wikidata:P856" | "rss-item" | "registry-field" | "case-document", conf, trust }`. The only way a URL reaches `web-direct` or Jina is a candidate id produced by code. By default `DiscoveryQuery` values are built by code. If M14's ablation enables the discovery role, a model (quarantined) may only propose `Proposal<DiscoveryQuery>` with `DiscoveryQuery = { kind: "fetch_candidate", candidateId } | { kind: "wikidata_search", text }` from M8's closed grammar, text length-capped; unknown ids are rejected. Case-document URLs are vendor-authored (UNTRUSTED) and require the strict profile (robots, no private hosts, no credentials, logged).
7. Fan-out over sub-questions runs with a global concurrency cap; results merge in `(subQuestionId, channel rank)` order regardless of completion order; evidence ids are content-derived, so order cannot change them.

**Tests.** `SF-ROUTE-01` the plan is a pure function (same inputs, same plan hash, property test); `SF-ROUTE-02` degraded health, exhausted budget, off channel and disclosure profile each produce the right rejection and `why`; `SF-ROUTE-03` fallback when the top channel is unavailable; `SF-ROUTE-04` origin DAG: two mirrors count once so the router queries a third origin; `SF-ROUTE-05` no usable channel yields `not_checked`, never an empty plan; `SF-ROUTE-06` an unknown candidate id or a URL string from a model is rejected; `SF-ROUTE-07` replan idempotence (second call with a larger `queried` set only adds); `SF-ROUTE-08` ablation: random channel order loses a planted corroboration case that authority-first routing catches (reported with an interval).

**Risks.** The table is hand-authored; the pack reviewer signs it. R17's gain-versus-cost estimates would need ground truth we only have synthetically (circularity risk, GRT-01), so none is used.

**Build notes.** After the first two connectors; consumed by the planner in M7's plan template.

## 22. Cross-cutting: concurrency, failure, determinism, security summary

- All effects use M7 ports: the clock is `ctx.clock`, randomness (retry jitter) `ctx.rng`, request ids `ctx.ids`, files `ctx.fs` (`FsPort`, M7), network `ctx.net` (`NetPort`, implemented by M8 in `ports/egress.ts`) and blobs `StorePort`, so that budget reservation, trace and the replay guard attach at the port (INT-020, INT-056).
- Failure behaviour: every failure is a typed `FetchOutcome`; no function in M1 returns an empty success; every outcome carries `coverage`; `blocked_by_policy` and `contract_drift` are not retried; a limiter or guard that fails to initialise aborts the channel.
- Determinism: evidence and index ids are content-derived; cassettes and indexes have no timestamps in hashed bytes; sets are serialised sorted; replays reproduce the recorded `retrievedAt`.
- Trace: hash-only content by default (Haystack's content-tracing rule, 02 §3.2); each fetch writes a line with channel, request key, servedFrom, bytes, attempts, state, evidence ids and `why` (`computed` kind with reason codes).

## 23. Acceptance mapping

The eleven groups of `prior-art/02` §6.8 map to: registry (SF-REG), `canHandle` (SF-REG-06), policy (SF-SSRF, SF-SIZE, SF-CLS, SF-CHL), SAMPLE_MODE (SF-CAS), evidence integrity (SF-ST), failure union (SF-CLS), rate limiting (SF-RL), redaction (SF-RED), file safety (SF-ST-01, 05), doctor (SF-DOC), live smoke (doctor `--live`, opt-in). Added here: authority and trust (SF-AUTH), rights (SF-RIGHTS), egress (SF-EGR), connectors (SF-CONN), silo (SF-SILO, SF-EMB, SF-ZR, SF-JDBC, SF-MCP, SF-AUD), routing (SF-ROUTE). Hard gates (not statistics): 100% block rate on the hostile corpus with zero sockets, zero secret-like values in any artefact, replay equality, every fault class typed, zero silent-wrong parses on goldens. What would disprove the design: a hostile-corpus case that connects; a cassette replay that differs; a parser change that does not move a golden hash; a Zetaris fault that produces an empty success; a differential disagreement between the embedded interpreter and its SQL oracle; blocking recall far below the perturbation baselines (the OFAC index would then be replaced, per bake-off 3).

## Interfaces table

| Exposes | Consumer | Contract |
|---|---|---|
| `SourceFabric.fetch(channel, query)` returning `FetchOutcome<R>` | M7 (as the `source.fetch` tool), planner | typed outcome with `state`, `coverage`, `Evidence[]`, `AttemptRecord`; never an empty success; effect record per INT-042 |
| `Evidence` records; blobs through `StorePort` | M3, M4 (L0), M9, M2 | content-derived id; `bodyHash` (`RawHash` or `Commitment`), `parsedHash` (`DocHash`), `parserVersion`, `use`; `isDecisionAdmissible(ev)` derived from `use` |
| `assignTrust`, authority table, `AuthorityRow.rank` | M3, M8 | pure function and pack data (incl. `requiredChannels`, `origins.json`); M8 owns the lattice and permission matrix |
| `SiloPort.query` for the five roles | M3 (candidate retrieval), M5 (SOR facts), M13 (`broker`), M10 (reviewer views) | typed rows with column classes; no free SQL; `partial` explicit; `version(view)` change token |
| `RoutingPlan` traces, `route()` | M7 plan template, M3 `request_more`, M10 trace view | pure, replayable, `why` per decision |
| Cassette format, `cassette verify`, `CassetteMiss` | M7 (layer 1 record `{slot, reqHash, respHash, outcome}`), M9 (`entriesRoot`), M11 (scenarios), clean-room verifier | strict miss (`fatal`); versioned entries; manifest hash |
| Egress manifest entries (M8 `EgressEntry` schema) and the label hand-off to `ctx.net` | M8 (egress funnel), M9 (bundle), M12 | executable, drift-checked |
| Doctor report (JSON, schema versioned) | M10 doctor page, CI, M12 | exit codes 0 to 3 |
| Rights registry, `LicenceStatus` | M9 (hash-only bodies, `--evidence-dir`), M11 | `committable()` gate |
| `ListVersion`, OFAC index handle, screening candidates | M3 (link decisions), M13 (re-screen at execution), M5 | candidates not verdicts; coverage excludes listed; `ofac.listVersion(ctx)` feed (header read only) |
| Audit reconciliation and witness Evidence | M12 (sponsor proof), M9 | optional, live-only |
| `DocumentRef` from 11j (blob reference, `docSha: RawHash`, fixed labels per source) | M2 | no channel; caps re-checked |
| Requests to M7 (resolved): `FsPort` (M7), `NetPort` (M8 implements), `StorePort` blobs; `source.fetch` effect record `{slot, reqHash, respHash, outcome}` | M7 | INT-042, INT-043, INT-056 |

## Spec feedback

1. **Two cassette layers.** *Resolved by INT-042.* Spec §4 puts cassettes in the M7 effect layer; §6 puts strict cassette replay in M1. Proposal: M1's transport cassette holds bytes and re-runs parsing and evidence building; M7's entry for `source.fetch` holds `{slot, reqHash, respHash, outcome}` with `bodyPolicy: blob`. `cassette_miss` is class `fatal` (M7's `E_CASSETTE_MISS`, with the `RUN_LIVE` hint).
2. **Node permission model and the network.** *Resolved by INT-019.* Spec §5 leaves "network denied through the Node process permission model" NOT VERIFIED. Result (Node 22 docs, installed 22.17.0): the model is stable from 22.13 but has **no network flag**. M8's compartment claim for the extractor needs an in-process guard plus OS-level isolation, and the permission flags (no child process, addons, worker, wasi) close the main bypasses. M8 §C8 owns the mechanism and the claim, which follows the probed backend.
3. **F-DOWNLOAD.** *Resolved by INT-065 (spec wording).* The 29 MB figure refers to `SDN.XML` (29,189,135 bytes observed); the CSV set needed for the index is about 5.7 MB for its main file. The OFAC export endpoint is named `PublicationPreview` and three version signals disagree (folder date, `Last-Modified`, XML `Publish_Date`); a list version must come from the XML header plus a content hash.
4. **JDBC is not a judge-path primary.** *Resolved by INT-045.* The vendor JAR is not on Maven and needs a JDK; spec §6 and §19 call REST and JDBC "primary". Proposed wording: REST is the live path, JDBC a record-time transport and typing oracle, replay is the judge path.
5. **Role vocabulary.** *Resolved by INT-008.* Spec §19 says buyer, reviewer, approver; F-ZROLE says a buyer role sees masked bank fields and a reviewer sees them in full; the readout uses agent-reader, reviewer, approver; M13's broker needs a raw read. Proposal: five roles `agent, buyer, reviewer, approver, broker`.
6. **Conventions file.** *Resolved by INT-006 and INT-003.* `LicenceStatus` is used by `Evidence` but was not defined (now in conventions). `Evidence.retrievedAt` and the id rule need one statement: id content-derived including `retrievedAt` of the network exchange, so replay reproduces ids. Add `Evidence.use: "decision" | "discovery"` (or keep `isDecisionAdmissible`) so Jina evidence cannot be cited. `FetchState` has no member for erased bodies or replay misses; both are typed errors here.
7. **Spec §5 and §6 on free text.** *Resolved by INT-065 (spec wording).* "Registry free-text fields are always UNTRUSTED" is applied to all free text including authority-authored remarks (OFAC), so parsed identifiers from remarks are UNTRUSTED. State that this is acceptable because sanctions evidence only restricts.
8. **Write provenance.** *Resolved by INT-024.* The SOR rule (review SEC-02) needs `last_write_origin` columns in the silo contract; spec §16 and M11's generator must plant them.
9. **Disclosure.** *Resolved by INT-021.* Spec §5 residual (identity disclosed to GLEIF, SEC, CourtListener, Jina) needs a deployment-level disclosure profile; the spec does not yet offer `identifier_only` or `offline`.
10. **Spec §19 "Kept" list** *(resolved by INT-062 (h))* for Zetaris is all conditional; the audit-log cross-check should be worded as MAYBE (readout idea 4) until a read path is found.
11. **M7 ports.** *Resolved by INT-056 and INT-020 (`FsPort` from M7, `NetPort` implemented by M8).* M1 needs a filesystem port (atomic write, fsync, `lstat`) and a raw network port under which the SAMPLE_MODE guard and budget reservation sit.

## What this blueprint does not cover

- Document parsing, text layers and locators (M2); entity matching and conflict resolution (M3; M1 only supplies candidates and authority data); claim verification (M4); policy and the permission matrix (M5, M8); ledger and bundle formats (M9, which consumes the cassette manifests and egress manifest as inputs); the Scout capability and action broker (M12, M13).
- Zetaris natural-language-to-SQL, AgentFlow, AI Data Steward, Kafka or CDC, Zetaris as a system of record (rejected in the readout and spec §19); the Zetaris native-agent baseline arm (M11, M12); federated reads that require registering our sources in Zetaris (conditional on administrator rights).
- EU, UN and UK sanctions lists, OFAC consolidated non-SDN lists, UK Companies House and other national registers, OpenCorporates, Bright Data, the OFAC XML structured pass, a GLEIF golden-copy mirror: designed as roadmap items only.
- Scale and cost of thousands of vendors, continuous re-screening, locale beyond name normalisation (spec §21c items 2, 6, 7).
- Anything about Zetaris behaviour that is not documented text: no account was used, so every Zetaris statement is NOT VERIFIED until a trial exists.
- Not run: no third-party code was executed; HTTP probes were single low-volume requests, dated 2026-10-13, and are observations that can change; RFC 9110 `Retry-After` and RFC 9309 text were not read.

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-101.** `entriesRoot` and the two cassette-layer roots in the cassette manifest are `TreeHash` (`tlog:`), not `DocHash`.
- **INT-102.** Cache, blob and tombstone paths use `pathOf(h)` (`<kind>/<hex>`); no file or directory name contains a colon. The existing hex-part rule is now this function.
- **INT-103.** The `salted_hash` mask uses tag `plumbline/account/v1` over `normaliseAccount(x)` (M1 owns the normaliser) with the tenant salt, replacing tag `plumbline/m1/mask/v1` and the per-deployment salt. It is the same function as `ReleaseBinding.accountCommit` and the broker's recomputation. Computing it in the silo view's SQL is NOT VERIFIED until a Zetaris trial exists; fallback: the view omits the field for `agent` and the adapter commits on a `broker`-role read.
- **INT-104.** Intake evidence above `public` (11j) has `bodyHash` and `Locator.docSha` as `Commitment`; the store key stays an internal `RawHash` in a private index that is never exported.
- **INT-107.** `SourceMeta.rate` is `{ minIntervalMs: number; burst: number; documentedMinIntervalMs?: number }`, all integers; no fractional requests per second in the manifest.
- **INT-114.** The silo contract carries a data table `fromErpOrigin` mapping ERP origin values (`internal_user`, `system_import`, `vendor_email_request`, and so on) to the shared `WriteOrigin`; an unmapped value is `unknown`.
- **INT-115.** The evidence builder supplies `authorship` and `tier` so M3 can copy them into each `Assertion` together with the extractor's `producer`.
- **INT-118.** The labels assigned at intake (channel 11j) are the inputs from which M2 derives the labels of its outputs (inherit, never raise).
- **INT-149.** `ctx.net.send` is one HTTP exchange with redirects off and returns `remote: {address, port}` (no `hops`). M1 builds the `NetPolicy` (allowed hosts, deny ranges, resolve once, optional pinned address) passed in `CallCtl.net`, loops over at most 5 hops, calls `send` once per hop, and re-runs its allowlist and address checks before each.
- **INT-150.** The hops of a fetch are wire calls inside the single `source.fetch` effect, not slots of their own; the layer-2 transport record (this module) holds the per-hop detail.
- **INT-153.** M1 owns the Zetaris MCP fallback client and the generic harness for an untrusted MCP server (pinned surface, read-only, no token passthrough); M12 reaches it only through `SiloPort`.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
