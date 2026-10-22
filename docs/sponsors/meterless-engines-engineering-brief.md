# Meterless Engines: Engineering Brief

**Purpose.** The exact contracts of the four Meterless engines (H-MEM, World Model, Markovian, Scout Intent), so we can implement them in TypeScript inside our own product, prove them with Meterless's own conformance suites, and show a Meterless judge real engine usage.

**Verification scope (read this first).**

- Everything below comes from a static read of the local clone. No Meterless code was executed. No conformance run, reference test, or example was run. Statements about what the reference "does" are what the source says it does, not observed behaviour.
- Findings that are my deduction from reading code, not a quote from a file, are tagged **[inferred]**. Each one must be confirmed by a failing test in our own build before it is repeated anywhere public.
- The clone was compared with upstream on 2026-10-13: `main` HEAD is `0aa7417` (2026-07-22), latest release `v1.0.6`, and the git blob SHAs of 15 files we depend on (all four runners, the vectors, the eval fixtures and thresholds, the four `AGENTS.md`, three reference sources, one regression file) match upstream exactly. `main` contains only `hmem`, `markovian`, `scout-intent`, `world-model` under `engines/`. Upstream has one open issue (#3, H-MEM `supersedes` never produces `supersededBy`, discussed in A.1).
- Environment observed on this machine: Node v22.17.0, npm 10.9.2, `tsx` not on PATH (so `npx tsx` fetches it), `node:sqlite` present but prints an ExperimentalWarning.

**Path key.** `MT/` means `research/sponsor-reference/Meterless/` (local clone, gitignored). Licence: Apache-2.0, `Copyright 2026 Meterless` (`MT/LICENSE`). No `NOTICE` file exists in the clone.

**Authority order when sources disagree.** For passing the suites: conformance runner and vectors, then reference source, then each engine's `AGENTS.md`, then `docs/`, then `examples/` and READMEs. Every engine's `AGENTS.md` says a green conformance scorecard is "the definition of done", so that is the order we build to. Conflicts are collected in Appendix 1.

---

## 0. What matters most

1. Three of four engines have a real conformance runner (H-MEM 13 checks, World Model 8, Markovian 8). Scout Intent has no reference and no conformance runner; its proof is an eval harness over a 32-example corpus. Scout is the only engine we build from prose alone.
2. The runners call a narrow surface and are weaker than their README claims. They check a few numbers and many behaviours; whole spec sections are untested (A.1 to A.4 list them). Green is necessary, not sufficient. Our own extended suites must cover the untested clauses or we cannot honestly say an engine "implements" the spec.
3. Synchronous-vs-asynchronous is the biggest TypeScript trap. H-MEM's `add`, `query`, `feedback`, `sleep.*`, `conflicts.*`, `dreaming.dream/approve`, `ledger.history` and `store.*` are called without `await`. A sync throw is how `add` rejects a record with no source. Anything that needs I/O (real embeddings, an LLM) must be an additional async method, never the one the runner calls.
4. H-MEM's runner mutates a record it got back from `add()` (`record.supersededBy = ...`) and expects ranking to honour it. A persistent store must return and rank from live, identity-mapped objects.
5. Meterless's own demo hard-codes its saving (the mock generator skips a fixed set of step indexes), and its "measured" script only prints estimates. Judges can read that. Our evidence must come from real runs with provider-reported token counts and an ablation (section D).
6. `research/` and `*.jsonl` are gitignored. A fresh clone has no runners and no Scout corpus. We must vendor the harness files, unmodified, under `third_party/meterless/` with the licence and a provenance record, plus a `.gitignore` exception for the corpus `.jsonl` files.

---

## A. The engines

### A.0 Shared mechanics

| Engine | Env var | Runner | Default impl if unset | Exit codes |
|---|---|---|---|---|
| H-MEM | `HMEM_IMPL` | `MT/engines/hmem/conformance/runner.ts` (+ `vectors/vectors.json`) | `reference/src/index.ts` | 0 all pass, 1 any fail, 2 cannot load |
| World Model | `WORLD_MODEL_IMPL` | `MT/engines/world-model/conformance/runner.ts` | `reference/src/index.ts` | 0 / 1 / 2 |
| Markovian | `MARKOVIAN_IMPL` | `MT/engines/markovian/conformance/runner.ts` | `reference/src/index.ts` | 0 / 1 / 2 |
| Scout Intent | `SCOUT_IMPL` | `MT/engines/scout-intent/evals/runner/index.ts` (`tsx evals/runner/index.ts all`) | none; exits 2 if unset | 0 gate passed, 1 gate failed, 2 cannot load |

- The three conformance runners load the implementation with `import(pathToFileURL(path.resolve(IMPL)).href)`. The Scout runner uses `pathToFileURL(implPath)` with no `resolve`, so its path must be absolute.
- The implementation is one ES module whose exports have the names below. It is loaded by `tsx`, so TypeScript with `.ts` relative imports works. `tsx` reads `tsconfig.json` from the current directory, not from the implementation file, so path aliases are unreliable: use relative imports only.
- The module must not print, call `process.exit`, or import `vitest`.
- H-MEM's runner reads `vectors/vectors.json` relative to the runner file, so the two must stay together when vendored.

Exact invocations (replace `<repo>` with the repository root; paths must be absolute, forward slashes on Windows):

```bash
# H-MEM (13 checks)
HMEM_IMPL=<repo>/src/engines/hmem/index.ts npx tsx <repo>/third_party/meterless/hmem/conformance/runner.ts
# World Model (8 checks)
WORLD_MODEL_IMPL=<repo>/src/engines/world-model/index.ts npx tsx <repo>/third_party/meterless/world-model/conformance/runner.ts
# Markovian (8 checks)
MARKOVIAN_IMPL=<repo>/src/engines/markovian/index.ts npx tsx <repo>/third_party/meterless/markovian/conformance/runner.ts
# Scout Intent (eval gate; needs the `yaml` package resolvable from the runner)
SCOUT_IMPL=<repo>/src/engines/scout/index.ts npx tsx <repo>/third_party/meterless/scout-intent/evals/runner/index.ts all
```

PowerShell form: `$env:HMEM_IMPL = "<repo>/src/engines/hmem/index.ts"; npx tsx <repo>/third_party/meterless/hmem/conformance/runner.ts`. Before the vendoring step exists, the same runners can be pointed at the local clone path `MT/engines/<engine>/conformance/runner.ts`. The Scout runner writes `evals/reports/latest.md` next to itself on every run, so running it inside the clone mutates the clone; run the vendored copy.

Tooling declared by the references (all `"type": "module"`, zero runtime dependencies, `package-lock.json` present):

| Engine | devDependencies | tsconfig |
|---|---|---|
| H-MEM reference | `tsx ^4.19.0`, `vitest ^2.1.0` | ES2022, NodeNext, strict, `allowImportingTsExtensions`, `noEmit` |
| World Model reference | `tsx ^4.20.0`, `vitest ^3.2.0`, `esbuild ^0.25.0` (browser bundle only) | same family |
| Markovian reference | `tsx ^4.19.0`, `vitest ^3.0.0` | ES2022, ESNext, bundler resolution, same flags |
| Scout evals | `tsx ^4.19.0`, `yaml ^2.5.0`; `engines.node >=18` | none shipped |

Node 22 (our D-007) satisfies all of them. The reference code uses `structuredClone`, `node:fs`, regex lookbehind and top-level ESM only.

---

### A.1 H-MEM (hierarchical memory)

**Purpose.** Durable agent memory as a provenanced knowledge graph: mine, enrich, store in three tiers, retrieve with a hybrid score, reinject into prompts with a trace, take feedback, dream (propose new knowledge, human approves), sleep (consolidate/archive/synthesize with preview and backup), detect and resolve conflicts, and audit every mutation in an append-only ledger. Sources: `MT/engines/hmem/AGENTS.md`, `docs/*.md`.

**Module shape the runner expects.** Exports a class `HMEM`, constructed as `new HMEM({ clock: () => number })`. Members the runner touches:

| Call | Sync/async | Used for |
|---|---|---|
| `add({ content, source, confidence?, layer?, type?, derivedFrom? })` | **sync**, throws on empty `source` | returns the stored record (must be the live object) |
| `feedback(id, "helpful" \| "not_helpful" \| "wrong")` | sync | confidence/accessCount/tag deltas |
| `store.get(id)` / `store.all()` | sync | read records (`id`, `confidence`, `accessCount`, `tags`, `supersededBy`, `layer`, `derivedFrom`) |
| `query(text, { threshold, topN })` | **sync** | returns `{ memories: [{ memory: { id }, relevance }] }` |
| `sleep.preview()` | sync, pure | returns `{ toArchive: string[], ... }` |
| `sleep.execute(preview)` | sync | returns `{ backupId: string }` |
| `conflicts.scan()` | sync | returns an array of conflict records |
| `conflicts.autoResolve(conflict)` | sync | returns `"resolved"` or `"queued"` |
| `ledger.history(id)` | sync | entries with `action`, `previousState.confidence`, `newState.confidence` |
| `dreaming.dream()` | **sync** | returns proposals with `.id` |
| `dreaming.approve(id)` | sync | returns the created record (`layer`, `derivedFrom`) or `undefined` for domain proposals |

**Canonical record** (`AGENTS.md` section 2; `reference/src/types.ts`):

| Field | Notes |
|---|---|
| `id`, `content`, `type` (`personal\|factual\|preference\|general`), `layer` (`short_term\|working\|long_term`) | reference ids are `mem-N` |
| `timestamp`, `lastAccessed`, `accessCount`, `tags`, `embedding`, runtime `score` | |
| `confidence`, `source` | both mandatory; empty `source` is rejected by construction |
| `provenance` `{ origin, learnedAt, label, refs? }` | mandatory for new writes; reference origins are the 7 event types plus `document`, `manual`, `dream`, `sleep_synthesis` |
| `chatId`, `missionId`, `goalRunId` | recall scoping |
| `domain`, `namespace` | e.g. `tech/profile` |
| `entities` (cap 10), `relatedTo` (cap 5, bidirectional), `supersedes`, `supersededBy`, `derivedFrom[]` | graph and lineage |

**Defaults** (`AGENTS.md` section 13; `DEFAULTS` in the reference): topN 5, threshold 0.35 on the final score, consolidation 7 days since last access, archive at 30+ days and accessCount at most 2 and unreferenced, synthesis cosine 0.82, dream cluster min size 2, dream relatedness 0.35, max 8 dream proposals per type, conflict auto-resolve gate 0.70, entity cap 10, related cap 5, recency time constant 14 days.

**Formulas the spec fixes.**

- Retrieval: `raw = 0.35 semantic + 0.20 keyword + 0.10 tag + 0.10 domain + 0.15 entity + 0.05 layer + 0.05 recency - 0.20 superseded`; `score = clamp01(raw) * confidence`. keyword = Jaccard of the top-8 query tokens against the memory tokens. Layer weights 1.0 / 0.8 / 0.6. Recency = `exp(-ageDays / 14)` on `lastAccessed`. Superseded = 1 when `supersededBy` is set; penalized, never filtered.
- Feedback: helpful `accessCount += 1; confidence = clamp01(c + 0.05)`; not_helpful `c - 0.03`; wrong `c - 0.20` plus tag `review`.
- Ledger: 17 action types (`create, read, update, delete, feedback, promote, demote, merge, conflict_detected, conflict_resolved, sleep_consolidate, sleep_archive, sleep_synthesize, dream_proposed, dream_approved, dream_rejected, restore`), entries carry `memoryId, action, actor, timestamp`, optional `previousState`, `newState`, `details`. Append-only, never destructively pruned.

**What the 13 conformance checks assert** (`conformance/vectors/vectors.json`, clock fixed at `1750000000000`; floating tolerance 1e-9):

| Check | Asserts | Proves |
|---|---|---|
| rv-001 | `add({ content, source: "" })` throws | source is mandatory by construction (sync throw) |
| rv-002 | `add` with a source does not throw | positive control |
| fd-001 | 0.7 + helpful = 0.75 and accessCount +1 | helpful delta |
| fd-002 | 0.7 + not_helpful = 0.67, accessCount +0 | not_helpful delta |
| fd-003 | 0.7 + wrong = 0.5 and tag `review` present | wrong delta and review tag |
| fd-004 | 0.1 + wrong = 0 | clamp at 0 |
| fd-005 | 0.98 + helpful = 1 | clamp at 1 |
| ro-001 | two long_term records at 0.9; the runner sets `old.supersededBy = fresh.id` after `add`; query "when do we deploy the api with docker" (threshold 0, topN 10) ranks `fresh` before `old` | the -0.20 term is applied from the live field; superseded records are penalized, not removed |
| ro-002 | identical content, working layer, confidence 0.9 vs 0.4; query "deploy window" ranks the 0.9 first | confidence multiplies the whole score |
| sg-001 | a plain record (source `chat`) and a derived one (source `dreaming`, `derivedFrom: ["mem-x"]`); clock +40 days; `preview().toArchive` contains the plain one and not the derived one; the id set is unchanged after `preview()`; `execute(preview)` returns a non-empty `backupId`; the protected record still exists | archive rule, derived-record guardrail, preview purity, backup |
| cg-001 | "always enable telemetry uploads for diagnostics" (0.95) vs "never enable ..." (0.2): `scan()` finds at least one; `autoResolve` returns `resolved` or `queued`; if resolved, exactly the loser has `supersededBy`; both records remain | opposing-phrase detection; resolution never deletes |
| la-001 | `add` then `feedback(wrong)`: `history(id)` actions are exactly `["create","feedback"]`; last entry has `previousState.confidence` 0.7 and `newState.confidence` 0.5 | every mutation ledgered with before/after state |
| db-001 | two preference records; `dream()` returns at least one proposal; store size unchanged; `approve(proposals[0].id)`, if it returns a record, has `layer: "long_term"` and non-empty `derivedFrom` | dreaming never materializes before approval |

**What the runner does not assert** (so we must test it ourselves): the numeric retrieval formula (only two orderings), the 0.35 and top-5 defaults, layer weights, recency decay, mining and its no-model fallback, enrichment (domain, namespace, entity cap, relatedTo, supersedes detection), tiered hydration and decay, the consolidation rule, the 30-day/2-access constants beyond sg-001, synthesis at cosine 0.82, dream thresholds and caps, the 0.70 gate value (cg-001 accepts either outcome), the other resolution strategies, the 17 action types, restore, reinjection format, trace metadata, privacy redaction, scoping by `chatId`/`goalRunId`.

**What the reference does** (`MT/engines/hmem/reference/src/*`, 10 files; zero runtime deps; its own 10 vitest tests in `test/smoke.test.ts`, including a hand-computed retrieval score of 0.6000 via `retrieval.scoreOne`):

- Facade `HMEM` composes `store`, `ledger`, `mining`, `retrieval`, `conflicts`, `sleep`, `dreaming`; `query()` is sync; `mine()` is async; `persistDir` option writes `state.json` (full rewrite on each mutation) and `ledger.jsonl` (append).
- Implements the exact retrieval formula, feedback deltas, ledger with 17 types, preview-first sleep with backup and `restore`, dream proposals with approval, conflict scan with the 0.70 gate, model-free mining with an optional `minerFn` hook.

**What the reference does NOT do** (gaps to close in our build; each is a place a reviewer could say "this is a mock"):

1. **Embeddings.** A 64-dimension FNV-1a token hash, signed and L2-normalized. It is lexical hashing, not semantics, so the 35% "semantic" term is token overlap. Spec section 3 expects backfill of missing embeddings; the reference never does it.
2. **Persistence.** JSON file rewritten per mutation; no tier-specific stores; no hydration pipeline; no forgetting curve. Sleep backups live in process memory only, so `restore` cannot work after a restart. Dream proposals and conflict records are in memory only (the ledger is the only durable trace).
3. **Mining.** Default is a regex "signal word" sentence filter (20 to 300 chars, max 10). The model path is one generic prompt, not the per-event prompts the spec asks for. `parseStrictJsonArray` keeps strings of length 5 or more, `docs/mining-pipeline.md` says 6 or more.
4. **Enrichment.** Keyword-table domain classifier (tech/work/personal), entities are tech terms plus capitalized words as plain strings, no entity types. `relatedTo` backlinks are written to other records without a ledger entry, which contradicts the spec's rule that no mutation happens without one.
5. **Retrieval.** Only `chatId` scoping, no `goalRunId`/`missionId` isolation and no `includeUnscoped` switch. Every query mutates state (`accessCount`, `lastAccessed`, a `read` ledger entry per hit). Memories tagged `review` or `wrong` are still injected (`docs/reinjection.md` says not to). The trace has no `traceId`, weight-profile label, or suppressed-superseded count. Reinjection format is its own `[MEMORY CONTEXT]` block, not the format in `docs/reinjection.md`.
6. **Dreaming.** Proposal text is string concatenation of member memories ("Across N related memories: a + b"), no synthesis, no proposal confidence.
7. **Sleep.** Consolidates only `short_term` (docs: short-term/working). Archive guardrails cover superseding records, derived records and hubs (3+ links) but not "unresolved conflicts" or "above confidence/access thresholds" from `docs/sleep-cycle.md`. Synthesis has no guardrails, drops entities and relationships from the merge, and deletes the sources. `execute(plan)` runs whatever plan it is handed without re-checking it against a fresh preview, so "execution never discovers new work" is a convention, not an enforced rule. Preview lacks the per-action reason, guardrail status and expected ledger action that `docs/preview-first-sleep-cycle.md` requires.
8. **Conflicts.** O(n squared) pairwise scan; re-scanning appends duplicate conflict records. Auto-decision only implements keep-A/keep-B; `keep_both`, `merge`, `delete_both` and any manual resolution API are absent. The recency term is `lastAccessed / clock()`, which is about 1.0 for every record, so recency is effectively constant. **[inferred]**
9. **Supersession.** Declaring `supersedes` at add time sets only the forward pointer; nothing sets `supersededBy` on the replaced record, and `supersedes` also suppresses conflict detection for that pair. Result: an explicit correction is never penalized in ranking. This is the same gap as upstream issue #3 (open, 2026-10-02), with a repro on commit `0aa7417`. Our build should set `supersededBy` on the replaced record when `supersedes` is declared, ledgered, which stays compatible with ro-001.
10. **Ledger.** No entry `id`, no `range`/filter/export, no `ledger_rotated`. `docs/trust-ledger.md` lists those.
11. No privacy filter before reinjection.

**Spec-internal conflicts that affect us:** entities are `{name,type}[]` in `docs/memory-record.md` and "normalized entities with entity type" in `AGENTS.md`, but `string[]` in the reference; provenance origin enums differ between `docs/memory-record.md` and the reference; the cross-engine examples call `hmem.query({ text, topN, strategy })` (async, object argument), `hmem.ingest(...)` and `hmem.add({ entities: [...] })`, none of which match the runner-bound sync API. Follow the runner; offer the example-style wrappers as thin adapters if we want example parity.

**How to pass in a TypeScript build.**

1. One module `src/engines/hmem/index.ts` exporting `HMEM` (and the service classes). Constructor takes `{ clock, persistDir?, actor?, minerFn? }`; `clock` defaults to `Date.now`.
2. Keep the whole conformance-facing surface synchronous. For persistence use append-only JSONL plus an in-process identity map (the reference approach), or `node:sqlite`'s synchronous `DatabaseSync` (present on Node 22.17 behind an experimental warning; stability NOT VERIFIED). Avoid a native-addon SQLite (build cost on a disk-tight machine).
3. `add()` must return, and ranking must read, the same live object held by the store. Persist by flush points (after `add`, `feedback`, `query`, `sleep`, `dream`, conflict steps) using a dirty check, because the runner assigns `supersededBy` directly.
4. Do not dedupe identical content at `add()` time. ro-002 adds two records with identical content and expects both.
5. Real embeddings and LLM synthesis go in separate async methods (`queryAsync`, `dreaming.dreamWithModel`, `mining.mineWithModel`), sharing the same scoring function. The sync path uses a deterministic local embedder so the suite is reproducible. Backfill real vectors asynchronously, as the spec's hydration step describes.
6. Ledger exactly once per mutation, with `previousState` and `newState` snapshots that include `confidence` (la-001). `feedback` must log `feedback` only (no extra `update`/`read`).
7. Inject the clock everywhere (`timestamp`, `lastAccessed`, ledger time, sleep ages); sg-001 advances the clock by 40 days.
8. Port the behaviour, not the code, of the reference's 10 vitest tests as our own tests, then add tests for each "not asserted" item above.

---

### A.2 World Model (event-sourced entity, context, relationship, fact store)

**Purpose.** A persistent, queryable, evolving representation of entities, the contexts they occur in, and typed relationships, with stable content-derived IDs, idempotent ingest, bitemporal edges, derived views, and an operator control plane. State is a fold over an append-only event log; views are projections. Sources: `MT/engines/world-model/AGENTS.md`, `docs/*.md`, `HOW_TO_USE_WORLD_MODEL.md`.

**Module shape the runner expects.** Exports four functions/classes by name: `WorldModel` (class), `entityIdFromName`, `normalizeName`, `decide`. Missing any of them exits 2.

| Call | Sync/async | Used for |
|---|---|---|
| `new WorldModel({ storage: "memory", namespace, clock? })` | sync; `clock` returns a `Date` | construct |
| `upsertEntity({ type, name?, externalKey?: { system, id }, attrs?, source: { kind, at } })` | async; must reject/throw when `source` is missing | prov-001 and setup |
| `relate({ from, type, to, validFrom?, source })` | async | bitemporal edges |
| `ingest(observations)` | async; returns `{ changed: boolean, ... }` | idempotency |
| `stateShapeCanonical()` | sync string | idempotency diff surface |
| `view("graph").neighborsOf(id, { via?, at? })` | sync; returns entities with `.id` | point-in-time edge queries |
| `audit()` | sync; array of entries with numeric `seq` | audit order |
| `normalizeName(s)`, `entityIdFromName(type, name)`, `decide(similarity)` | sync pure functions | IDs and merge bands |

**The 8 conformance checks:**

| Check | Asserts | Proves |
|---|---|---|
| sid-001 | `normalizeName("José  García") === normalizeName("Jose Garcia")` (accents plus a non-breaking space) and the two `entityIdFromName("person", ...)` ids are equal | NFKD, mark stripping, whitespace collapse |
| sid-002 | `("org","Acme Corp")` and `("org","Acme Corporation")` differ; `("person","x")` and `("org","x")` differ | no over-normalization; `type` is part of the key |
| band-001 | `decide(0.85)` is `auto-merge`, `0.84` and `0.82` are `review`, `0.81` is `new` | exact merge bands and boundary rulings (default arguments) |
| prov-001 | `upsertEntity` with `source: undefined` is rejected | no provenance, no write |
| idem-001 | ingest the same two-observation batch twice: second report `changed === false`, canonical state string identical | idempotent ingest |
| idem-002 | ingest with one edited title: `changed === true` and state string differs | the idempotency check can fail |
| bitemp-001 | player `player:g:p1` relates `plays-for` team a (validFrom 2087-01-01) then team b (validFrom 2088-03-01): "now" neighbours are only team b; at 2087-06-01 only team a | superseding edge closes the old one; point-in-time queries respect validity; external ids are the literal `type:system:id` |
| audit-001 | two `upsertEntity` calls: `audit().length >= 2` and `seq` strictly increasing | every mutation is audited in order |

**Not asserted by the runner:** the exact sha-256 values, fact conflict policies, merge approval/rejection and alias resolution, the snapshot/timeline/custom views, FIFO single-writer ordering, the 10-step ingest order, velocity formulas, persistence and replay, schema versioning.

**IDs and rules the reference pins** (`reference/src/stableIds.ts`, `resolve.ts`, `README.md`):

- Externally keyed: `${type}:${system}:${externalId}` (literal).
- Name keyed: `ent_` + first 16 hex of `sha256("${type}:${normalizeName(name)}")`. `normalizeName`: NFKD, strip U+0300 to U+036F, strip U+200B to U+200D and U+FEFF, lowercase, collapse whitespace, trim. (`docs/stable-ids.md` lists lowercase before NFKD; results differ only for exotic characters. Use the reference order for ID parity.)
- Context: externally keyed contexts use the literal grammar; attribute-keyed contexts are `ctx_` + 16 hex of `sha256(type:canonicalJson(attrs):parent)`.
- Relationship: `rel_` + 16 hex of `sha256(from|type|to|context|validFrom)`; fact: `fact_` + 16 hex of `sha256(about|predicate|canonicalJson(value)|assertedAt|sourceKind|sourceUrl)`.
- Similarity = `1 - levenshtein / maxLen` on normalized names. `decide(s, autoMergeAt = 0.85, reviewLower = 0.82)`: `>= 0.85` auto-merge (alias event), `>= 0.82` review queue, else new. Resolution runs only for name-keyed entities of the same type.
- Record timestamps derive from observation provenance `source.at`, never the wall clock. The injected clock is only for operator actions.
- A new open edge with the same `(from, type, context)` and a different target closes the previous open edge (`validTo`, `supersededBy`); nothing is deleted.
- Ingest clustering: entity-overlap Jaccard `>= 0.5`; velocity over 1 h / 24 h / 7 d buckets; `trendDirection = sign(current hour - previous hour)`.

**Data model** (`reference/src/types.ts`): `Entity` (`type, id, attrs, schemaVersion, source, createdAt, updatedAt, name?, aliases, state, aggregates?`), `Context` (`parent`, `startedAt`, `endedAt`), bitemporal `Relationship` (`validFrom`, `validTo`, `supersededBy`), `Fact` (`about, predicate, value, confidence, assertedAt, supersededBy`), `Provenance` (`kind, by?, at, url?, checksum?, runId?`), `WorldEvent` (`id, seq, kind, payload, schemaVersion, at`; kinds `upsertEntity, upsertContext, relate, assertFact, snapshot, tombstone, alias, view-rebuild`), `AuditEntry`, `MergeProposal`, `ObservationRecord`, `StoryAggregate`, `ScoreSnapshot`, `IngestObservation`, `IngestReport`, options (`storage`, `namespace`, `directory`, `clock`, `resolver`, `conflictPolicy` in `most-recent-wins | highest-confidence-wins | source-priority | manual`, `sourcePriority`).

**What the reference does** (6 source files, zero runtime deps, 10 vitest tests, `scripts/idempotency-check.ts` with a `--mutate` proof mode, browser bundle for `control-plane/live.html`): single-writer FIFO queue per instance; five write methods (`upsertEntity`, `upsertContext`, `relate`, `assertFact`, `ingest`); views `graph` (`entity`, `neighborsOf`, `incoming`, `entitiesInContext`, `traverse`, `query`), `facts.about`, `snapshot.entityAt`, `timeline` (events), custom `registerView` reducers; merge queue with `approveMerge`/`rejectMerge`; the 10-step ingest pipeline with per-step timings; JSON persistence at `.world/<namespace>.json` by replaying events; `subscribeEvents(fn)` for push.

**What the reference does NOT do:**

1. No `snapshot()` write method, no tombstone or unmerge API, no `rebuild(view)`, no `waitForConsistency`/`atEvent`, no search view, no `timeline.entitiesOfType`/`contextChildren`, no `buildPromptContext` (which the spec's composition guides use), no `contextAt`.
2. No enrichment jobs/queue with cancel and resume, no stale-job discard (10 minutes), no schema migrations, no permissions (viewer/editor/admin), no write coalescing, no embeddings (merge detection is name Levenshtein only), no storage adapter beyond a JSON file.
3. Conflict policy is one global setting per instance; the docs say "configurable per attribute".
4. **[inferred] Fact resolution is not replayable.** `assertFact` appends the fact event, then mutates folded state directly (`entity.attrs[predicate] = winner.value`, and `supersededBy` on rival facts). The fold function for `assertFact` only stores the fact. After a restart that replays the persisted events, the winning attribute and the `supersededBy` marks appear to be lost. This breaks "state is a fold over events". It matters for us because reconciliation is the core path; our build must make resolution itself an event or a pure function of the fold, and test it with a restart.
5. **[inferred] Multi-valued edges are closed by the supersession rule.** The ingest path writes one `mentions` edge per entity mentioned by an observation. The fold closes any earlier open edge with the same `(from, type, context)` and a different target, so an article that mentions two entities appears to end up with only the last `mentions` edge open. Our build should make edge cardinality a per-type setting (single-valued by default so bitemp-001 passes with undeclared `plays-for`; declare `mentions`, `owns`, `director-of` as many-valued).
6. **[inferred] Ingest bypasses entity resolution.** `ingest()` upserts mentioned entities through an internal fold helper, not through `upsertEntity`, so the near-duplicate merge/review pass (which lives in `upsertEntity`) does not run during ingest. "Jerome Powel" and "Jerome Powell" would stay separate entities when they arrive via `ingest()`.
7. Observations, stories and scores are side tables outside the event log, so "everything is a fold" is only partly true.

**Spec-internal conflict (important):** the auto-merge threshold. `AGENTS.md` section 7.1 says a merge proposal fires at normalized-Levenshtein `>= 0.85` and goes to the operator, "never auto-destructive". `docs/ingest-pipeline.md` and `HOW_TO_USE_WORLD_MODEL.md` say auto-merge at `>= 0.92`, review at 0.82 to 0.92. The conformance runner and reference say auto-merge at `>= 0.85`, review `[0.82, 0.85)`. Build to the runner (`decide()` defaults 0.85/0.82), expose both thresholds as `resolver` options, and run our product with the stricter value (see C).

**How to pass in a TypeScript build.**

1. `src/engines/world-model/index.ts` exports `WorldModel`, `entityIdFromName`, `normalizeName`, `decide`, plus `canonicalJson`, `sha256Hex`, `nameSimilarity`.
2. Use `node:crypto` for SHA-256 (the reference inlines it only to share code with a browser bundle).
3. `upsertEntity` with externalKey must produce exactly `type:system:id` (bitemp-001 addresses entities by those literals).
4. `stateShapeCanonical()` must exclude wall-clock and timing data; idem-001 requires byte-identical strings, so use sorted-key canonical JSON and sorted collections. Report step timings only on the `IngestReport`, never in state.
5. `ingest()` must compute `changed` from before/after state shape, skipping observations whose checksum is unchanged.
6. Serialize writes through one promise queue so un-awaited concurrent writes keep audit order.

---

### A.3 Markovian (bounded-carryover chunked reasoning)

**Purpose.** Run a long task as a sequence of bounded chunks. Each chunk sees the goal (truncated after chunk 1), a compressed carryover state, and optional first-chunk context (memory, attachments), so per-step input cost is constant while a naive full-history prompt grows quadratically in total. Sources: `MT/engines/markovian/AGENTS.md`, `docs/*.md`.

**Module shape the runner expects.** Exports class `Markovian`, and functions `modelTotals(N)` and `runEfficiency(chunks, config)`.

| Call | Notes |
|---|---|
| `new Markovian({ chunkConfig?: Partial<ChunkConfig>, clock?, generator?, compressorFn?, historyDir? })` | validates **synchronously in the constructor**; throws a typed `ConfigValidationError` |
| `await markovian.run({ goal \| prompt, generator \| stepFn, mode?, memoryContext?, attachments?, abortSignal?, onStream?, stopWhen?, reflect? })` | returns the run record |
| `generator(prompt, attachments, systemPrompt?, onStream?, abortSignal?)` -> `Promise<{ text, metadata? }>` | the runner passes one-argument generators |
| `modelTotals(20)` -> `{ naiveTotal, markovianTotal, savings, efficiency }` | `efficiency` is a fraction 0 to 1 |
| `runEfficiency(chunks, cfg)` -> `{ totalTokensUsed, standardCost, markovianCost, tokensSaved, efficiencyPercent }` | |

**Config** (`ChunkConfig`): `chunkSize` 8000 (min 1000, max 128000), `maxChunks` 24 (1 to 32), `carryoverTokens` 800 (128 to 32768), `overlapTokens` 0 (0 to 4096). Load-time rules: `chunkSize >= 400 (framing) + carryoverTokens + 1200 (output budget)`, `carryoverTokens > 0`. Out-of-range values throw, never clamp. The documented `step` values (1000, 128) are treated as UI granularity: the reference enforces only min and max, because the default `carryoverTokens = 800` is not reachable on a step-128 grid from 128.

**Run record** (`MarkovianRun`): `id, timestamp, prompt (truncated), mode, chunkConfig (mandatory snapshot), chunks[], totalTokensUsed, totalTokensSaved, efficiencyPercent, durationMs, status (completed | max-chunks | errored | aborted), tokenLabel (estimated | measured), output, reflection?, error?`. `ChunkInfo` = `{ id (1-based), tokens, carryover (state passed in), content (marker-cleaned) }`.

**Protocol facts.** Markers: `[STATE_CHECKPOINT]` and `[TASK_COMPLETE]` canonical; legacy `@@@STATE@@@`, `[STATE]`, `---STATE---`, `@@@FINAL@@@`, `[FINAL]`, `---FINAL---` accepted, never emitted; XML alternates (`<CARRYOVER>`, `<DONE>`) accepted by the reference. Carryover block labels: `COMPLETED / REMAINING / DECISIONS / CONTEXT`. Cascade in strict order: marker text (length `>= 24` and within the token budget), LLM compressor (`compressorFn`, last 2000 chars), heuristic key phrases (`Therefore`, `Key insight`, `Status`, ...; first 5), tail truncation. Memory context is prepended to chunk 1 only; attachments go to chunk 1 only; continuation prompts carry a goal truncated to about 200 chars plus the carryover; an `[OVERLAP]` block (the last `overlapTokens * 4` chars of the previous cleaned output) follows the carryover when `overlapTokens > 0`. Token estimate: `ceil(chars / 4)`.

**Math the suite checks:** symbolic model with `F=400, G=200, S=300, O=1200, C=800`: `naive_total = N(F+G+S) + O N(N-1)/2`, `markovian_total = N(F+G+C+S)`; N=20 gives 246,000 vs 34,000 and 86.18%. Run efficiency: `standardCost = sum_i (prefix_i + tokens_i)`, `markovianCost = chunks * carryoverTokens + sum tokens`, saved = `max(0, standard - markovian)`. Break-even is `N > 1 + 2C/O` (about 3 at defaults).

**The 8 conformance checks:**

| Check | Asserts | Proves |
|---|---|---|
| eff-001 | `modelTotals(20)`: naive 246000, markovian 34000, efficiency within 0.5 of 86.18% | the documented cost model |
| snap-001 | `run.chunkConfig.carryoverTokens === 640` for a config that set it | mandatory per-run config snapshot |
| snap-002 | `runEfficiency` of four 1000-token chunks: standardCost 10000, markovianCost 6048 (`4*512 + 4000`); carryover 512 vs 2048 give different savings | efficiency computed against the run's own snapshot |
| ovl-001 | with `overlapTokens: 64`: either the constructor throws an error naming "overlap", or continuation prompts contain `[OVERLAP]`; accept-and-ignore fails | no silently ignored field |
| lab-001 | `run.tokenLabel` is `estimated` or `measured` | every number carries its source |
| ref-001 | generator throws on its 2nd call (the reflection call): `run.status === "completed"` | reflection failure never fails the run |
| mrk-001 | three-step generator ending in `[TASK_COMPLETE]`: status completed, 3 chunks, `run.output` contains no marker text | marker cleaning and completion detection |
| cfg-001 | `chunkSize: 128` makes the constructor throw | typed rejection, not silent truncation |

**Not asserted:** the legacy markers, the 24-char gate, cascade order, prompt templates, memory in chunk 1 only, abort handling, `errored` status, history persistence, progress phases, `max-chunks` status, other field bounds, reflection content.

**What the reference does** (`reference/src/*`, 9 files, 10 vitest tests that also cover abort, pause-marker parsing, history statistics and determinism, plus `scripts/measured-run.ts`): validated config, tolerant marker parser/cleaner, 4-level cascade, ARCHITECT and RESEARCH prompt templates, orchestrator loop with abort checks before each chunk and before compression, partial-output preservation, non-fatal reflection, bounded progress log (15), JSON history with cumulative stats, `performanceByStep()`, projected-curve generator.

**What the reference does NOT do:**

1. **No measured token accounting.** Chunk tokens are always `ceil(chars/4)` of output and `tokenLabel` is always `"estimated"`; the generator's `metadata` (provider usage) is ignored. `run.efficiencyPercent` is a model computed from output sizes, not from prompt tokens actually sent.
2. **Two accounting paths that disagree.** Live progress `tokensSaved` uses `(step-1) * chunkSize` as history; the final record uses actual chunk tokens via `runEfficiency`. They will differ. **[inferred]**
3. `scripts/measured-run.ts` is mock-only. Its Markovian side counts the real prompts the orchestrator built; its naive side is a string constructed in the script, not an engine run. The `ANTHROPIC_API_KEY` branch only prints a hint and makes no API call.
4. Computed `cascadeLevelUsed` is discarded (the docs call it the primary drift signal).
5. Pause markers `[NEEDS_TOOL ...]` and `[NEEDS_CLARIFICATION]` are parsed but never acted on; no `paused` status, `resume`, `cancel`, `replay`, `diff`, event emitter (`on`), approval gates, retention, `runFromContract`, per-run `chunkConfig` override, reflection modes (conclude/ratify/refine), or Engine-tab UI. Reflection input is truncated to 4000 chars (docs: 30,000).
6. Run ids are `run-N` from a module counter (spec: UUID). A marker state longer than the budget falls through the cascade instead of being truncated with a `carryover-overflow` warning.
7. `stopWhen` receives `{ step, carryover }`; the docs show `{ output }`.

**How to pass in a TypeScript build.**

1. `src/engines/markovian/index.ts` exports `Markovian`, `modelTotals`, `runEfficiency`, `ConfigValidationError`, plus the parsing and cascade helpers.
2. Validate in the constructor. For ovl-001, implement `[OVERLAP]` (do not reject) so overlap is usable.
3. `run()` must call the same `generator` for reflection if it uses one, or skip it when `reflect: false`; never let a reflection error escape.
4. Provider-reported usage: read `usage.input_tokens/output_tokens` from `metadata` when present, set a per-chunk label, and set the run-level `tokenLabel` to `measured` only when every chunk was measured, otherwise `estimated` (the runner accepts only those two values).
5. Record `cascadeLevel`, per-chunk prompt tokens, and carryover size on each chunk so section D can plot them.

---

### A.4 Scout Intent (intent, guard, route, signed execution contract)

**Purpose.** A decision layer that runs before any meaningful action: classify intent from a closed registry, bind parameters, run a five-layer guard, assemble a tool plan through a capability graph, pick a model profile, and emit an HMAC-signed, expiring, scope-limited execution contract that downstream engines must verify. Sources: `MT/engines/scout-intent/AGENTS.md`, `docs/*.md`, `evals/*`.

**There is no reference implementation and no conformance runner.** `src/` is empty by design (`ROADMAP.md`: a reference is planned for v0.2). The only machine check is the eval harness. We implement Scout from prose, against the harness.

**Module shape the harness expects.** Export class `Scout`:

```ts
new Scout({ intentRegistry: "<abs path to intents.json>", policyPack: ["default", "adversarial-tight"] })
await scout.decide({ prompt, user: { id, role }, surface })  // returns the Decision below
```

(The runner passes `policyPack` as an array; `AGENTS.md` types it as a string. Support both. The registry is the harness file `evals/fixtures/intents.json`: 13 intents including the `GENERAL` fallback, with `roles: ["*"]` wildcards.)

**Fields of the `decide()` result the runner reads** (`evals/runner/index.ts`):

| Runner reads | Meaning |
|---|---|
| `out.executionContract.intent.primary.id` | top-1 intent (`primary` is an object with `id`) |
| `out.candidates[].intent` (first 3) | top-k list, each `{ intent, score }` |
| `out.risk.level === "block"` | the only signal counted as "injection detected" |
| `out.toolPlan[].capability` | capability ids; expected plan must be a subset |
| `out.clarification` (truthy) | counted for the clarification rate |
| `out.overrides` (optional array) | override count; absent means "no data" |

Spec shape (`docs/execution-contract.md`): `contractId` (ULID), `parentId?`, `traceId`, `intent { primary, parameters, references, confidence, alternates }`, `risk { level low|medium|high, flags, redactions, approvals }`, `toolPlan`, `modelProfile`, `scope { user, surface, capabilities, deadline?, budget? }`, `issuedAt`, `expiresAt` (TTL 5 minutes), `registryVersion`, `policyPackVersion`, `signature = HMAC_SHA256(secret, canonical_json(contract_without_signature))`, `signedBy: "scout"`. Decision-level risk adds `block` and `reason`.

**Scoring and guard facts the spec fixes.** Stage 1 deterministic trigger scan over the full registry in under 16 ms with a startup self-test; Stage 2 optional embeddings. `final = 0.40 lexical + 0.35 semantic + 0.20 contextual + 0.05 recency - riskPenalty`. Bands: High `>= 0.80` proceed, Medium `0.55 to 0.79` proceed and log, Low `0.40 to 0.54` clarify (offer top-3), Reject `< 0.40` fall back to `GENERAL`. Clarify when: top-1 in Low band; top-1 and top-2 within 0.05 in Medium; required parameter unbound; risk class `high` and confidence `< 0.95`. Multi-intent: two High candidates on disjoint spans become a plan; secondaries are at or above 0.55. Guard layers: injection (pattern, role drift, out-of-band tool reference, optional model), policy gate (RBAC, per-intent rules), scope, PII/sensitivity (redact or block), rate limit; any `block` blocks, any `warn` lifts risk one band. Contract rules: signature mandatory at every boundary including dev, TTL never extended (refresh with `parentId`), immutable after signing, scope enforced by the executor, high-risk contracts carry approval records.

**What the harness measures** (`evals/config/thresholds.yaml`; the runner fails only on hard floors/ceilings, not on targets):

| Metric | Target | Hard limit |
|---|---|---|
| intent_top1 | 0.92 | floor 0.85 |
| intent_top3_recall | 0.98 | floor 0.94 |
| injection_precision | 0.95 | floor 0.90 |
| injection_recall | 0.90 | floor 0.82 |
| tool_precision | 0.88 | floor 0.80 |
| clarification_rate | max 0.15 | hard max 0.25 |
| override_frequency | max 0.08 | hard max 0.15 |

Per-slice floors: intent_top1 0.80 and injection_precision 0.85, sliced by surface, role, intent family, expected risk class. The corpus (`evals/regression-set/v1`) is 32 examples: 15 intent-labelled, 10 injection (7 attacks, 3 clean controls), 3 multi-intent, 4 edge cases.

**Weaknesses of the harness that we must not hide behind** (all from reading `evals/runner/index.ts`, fixtures and corpus):

1. The runner scores only `expected.intent`, `expected.injection` and `expected.toolPlan`. It never compares `expected.intents` (multi-intent), `expected.clarification`, or `expected.risk` (risk is used only to build the risk-class slices). The multi-intent and edge-case files only feed the clarification-rate denominator.
2. `tool_precision` is a subset test ("every expected capability appears in the emitted plan"). An implementation that emits all of an intent's declared capabilities scores 100%.
3. `injection_precision` is 1.0 when nothing is blocked, and the two rate metrics are 0 when nothing is flagged. The committed `evals/reports/latest.md` (generated 2026-07-09 by an unidentified implementation that scored zero on every real metric) shows precision 1.000, clarification 0.000 and override 0.000, so an implementation that blocks and clarifies nothing already passes three of the seven gates.
4. Prompts that throw are skipped and dropped from the denominators ("Skipped ..." warning). A crashing implementation can look better than it is. Our run must show zero skipped.
5. Many eval prompts are verbatim `examples` of the fixture registry (for instance "Find me the top 5 stuck deals and draft recovery emails", "Email Maya about the renewal"), so an exact-match scorer gets them for free.
6. Some expected risks contradict the spec's own rule that risk is never below the intent's class floor (for example `deal-recover-002` expects `low` for a `medium` intent). The runner ignores it, but a stricter grader would not.
7. `override_frequency` is 0 by construction in an offline run; the runner prints a note saying so.

**How to pass in a TypeScript build.**

1. `src/engines/scout/index.ts` exports `Scout`, `verifyContract(contract, { secret }) -> { ok, reason }`, `IntentRegistry`, and the signer.
2. Never throw from `decide()`. A blocked request returns a decision with `risk.level = "block"`, a `reason`, and no contract.
3. Return `candidates` (top-k, sorted) at the top level, `toolPlan` entries with both `capability` and `tool`, and `clarification` as a structured object (`question`, up to 4 `options`) or `undefined`.
4. High-risk intents trigger the clarify-below-0.95 rule; count the budget: the corpus has 2 high-risk intent examples plus 2 required clarifications, which is 4 of 32 (12.5%) against a 15% target and a 25% hard ceiling.
5. Use `node:crypto` HMAC-SHA256 over a canonical JSON encoding (the same one World Model uses), ULIDs for ids, and an injectable clock for TTL tests.
6. Define named policy packs `default` and `adversarial-tight` (the runner composes both). Unknown pack names should throw at construction, not at `decide()`.
7. Build our own grader on top of the same corpus that does score multi-intent, clarification and risk, and extend the corpus toward the documented target of 50 or more examples per family before quoting any number.
8. Vendor the harness (runner, thresholds, fixtures, regression set, `package.json` dev dependencies `tsx` and `yaml`) so the report is written inside our tree.

---

## B. How the engines compose

**The stack's own statement** (`MT/docs/architecture/stack-overview.md`): `User/Event -> Scout Intent -> H-MEM + World Model -> Markovian (or Swarm) -> Runtime Quality Layer -> surfaces -> Verified Output + Updated Memory`. Swarm and Runtime are not released (upstream `main` has no such folders as of 2026-10-13), so our loop is Scout, then World Model and H-MEM, then Markovian, then write-back.

**Hand-offs** (producer -> consumer, payload, source):

| # | From -> To | Payload | Source and rule |
|---|---|---|---|
| 1 | Scout -> every engine | signed `ExecutionContract` | `scout-intent/docs/execution-contract.md`. Consumers verify signature, expiry, capability in `scope.capabilities`, and required approvals; refusal is logged as `contract.refused`. Markovian verifies once at run start, not per chunk, unless the contract requires per-chunk approval, in which case it checks before each chunk (`markovian/docs/compose-with-swarm.md`). |
| 2 | Scout -> H-MEM / World Model | a "context plan" (sources, `maxTokens`, `subjectId`, `relations`, `redactionPolicy`) | Appears only in examples (`scout-intent/examples/query-hmem-before-action`, `scout-to-world-model`), not in Scout's `AGENTS.md`. Treat as our extension and add it to the signed contract. |
| 3 | H-MEM -> Markovian | `QueryResult.context` string as `memoryContext` | Chunk 1 only, never re-queried (`hmem/docs/reinjection.md`: "H-MEM context goes into Markovian chunk zero only"). Re-injecting per chunk would break the flat-cost property. |
| 4 | World Model -> Markovian | assembled case context with provenance | `HOW_TO_USE_WORLD_MODEL.md` section 13 uses `world.buildPromptContext({ subjectId, limit, window })` returning `{ text, provenance }`. Not in the reference; we implement it. |
| 5 | World Model -> H-MEM | each new fact becomes a memory: `type: "factual"`, `layer: "long_term"`, `source: "world:<entityId>"`, confidence from the fact | `hmem/examples/world-model-sync`, `world-model/examples/world-to-hmem-sync`. One-directional: the world is authoritative, memory is the agent's cheap local copy. Uses `world.subscribeEvents` (reference) or `view("timeline").subscribe` (docs). |
| 6 | Markovian -> H-MEM | finished run mined back as `plan_completion`, `source: "markovian:<run.id>"` | `hmem/examples/markovian-handoff`. This closes the "Verified Output + Updated Memory" loop. |
| 7 | Markovian / agents -> World Model | findings as `assertFact` with provenance `{ kind: "agent", by, runId }`; run state as contexts | `world-model/examples/agent-run-world-state` (the process is disposable, state lives in the world). |
| 8 | Reviewer -> H-MEM | `feedback(id, helpful\|not_helpful\|wrong)`; dream and conflict approvals | `hmem/docs/trust-ledger.md`; the confidence multiplier is what makes feedback move future ranking. |

**Events available to wire together.** World Model: `WorldEvent { id, seq, kind, payload, at }` through `subscribeEvents`. H-MEM: ledger entries (the reference exposes no subscription; we add one). Markovian: `ProgressState` snapshots through `onProgress`, history subscription; the docs list richer events (`run.start`, `chunk.complete`, `run.complete`, `approval.required`, ...) that the reference does not emit. Scout: telemetry names `scout.decision`, `contract.issued`, `contract.verified`, `contract.expired`, `contract.refused`, `scout.clarification`, `scout.override`.

**Order of operations for one request, as the sources describe it:**

1. Scout `decide`: injection and policy guard first. Block or clarify ends the request here.
2. Read under a read-only contract: World Model graph/fact/snapshot views for the case; H-MEM `query` for precedents (one call).
3. Markovian run: goal plus `memoryContext` in chunk 1, bounded carryover after that. Tool needs surface as `[NEEDS_TOOL ...]` pauses (needs implementing; the reference only parses them).
4. Verify mechanically, apply policy, wait for the approval record on high-risk contracts.
5. Write back: decision and findings into World Model (facts with provenance), run output into H-MEM (`plan_completion`), feedback on the precedents that were used, dream and sleep proposals queued for approval.

**Design questions the sources leave open (decide before building):**

- Bootstrap circularity. Scout's contextual score wants memory (`query-hmem-before-action`), but retrieving memory is itself an action that should sit under a contract. Proposed: a cheap `classify` pass with no context, then a read-only contract for retrieval, then the full `decide` with context.
- TTL versus run length. A 5-minute contract expires inside a long chain. The rule is "never extend, call `replan({ parent })`", so the Markovian host needs a replan at phase boundaries, with the original `contractId` as `parentId` and the same `traceId`.
- Who verifies. Contract checks must live in each executor (release action, Markovian start, World Model write path), not in a wrapper, or "executors refuse" is decoration.

---

## C. Mapping to our product (Plumbline: reconcile, explain, decide)

Product definition: `docs/DECISIONS.md` D-006. A purchase-order or vendor-onboarding case is (1) reconciled across conflicting internal and public records, (2) explained with mechanically verified evidence and a counterfactual, (3) decided under policy rules plus precedent memory with an approval gate.

| Job | Engine | Concrete use | Fit |
|---|---|---|---|
| Entity and relationship store across sources | **World Model** | Vendors as `org` entities keyed by authoritative ids (`org:gleif:<LEI>`, `org:sec:<CIK>`, `org:internal:<vendorId>`); name-keyed fallback; aliases for trade names | Direct |
| Source conflicts (legal name, address, bank account, jurisdiction, sanctions status) | **World Model** | `assertFact` per source with `confidence` and provenance `{ kind, url, at, checksum }`; losers keep `supersededBy`, so the conflict itself is a first-class record | Direct, with the replay fix from A.2 item 4 |
| Ownership and control over time | **World Model** | Bitemporal `owned-by`, `subsidiary-of`, `director-of`, `has-bank-account` edges; "who owned this vendor on the PO date" is `snapshot.entityAt` or `neighborsOf({ at })` | Direct, strongest fit |
| Same-vendor decisions | **World Model** | Merge queue for name similarity in the review band, with approve/reject and audit; product runs a stricter auto-merge value and requires a shared authoritative id | Direct |
| Idempotent re-check | **World Model** | Re-run a case's public lookups; "diff: empty" is the idempotency proof | Direct |
| Case and investigation state | **World Model** | `case` and `check` contexts, resumable after a crash (`agent-run-world-state` pattern) | Direct |
| Precedent memory | **H-MEM** | Each approved decision becomes a `factual` or `preference` memory (`source: "decision:<caseId>"`), tagged with structured features (`vendor-type:`, `jurisdiction:`, `risk:`), scoped by `missionId`/`goalRunId` per case | Adapted: H-MEM is built as an agent's memory of chats and documents, not case law; structured tags and a real embedder are needed |
| Trust in precedent | **H-MEM** | Reviewer `feedback` moves confidence by the exact deltas; `review`-tagged precedents are excluded from reinjection (we implement the rule the reference skips) | Direct |
| Contradictory precedent | **H-MEM** | Conflict scan and resolution queue ("always require a bank letter" vs "never for LEI-verified vendors") with `supersededBy` | Direct |
| Learning patterns | **H-MEM** | Dreaming proposals ("bank-detail changes within 30 days preceded most rejected releases") held for human approval; sleep preview/backup for hygiene | Stretch: the reference only concatenates text, so useful proposals need a model-assisted async path; approved output stays advisory memory, never a hard rule |
| Multi-step investigation | **Markovian** | One chunk per investigative phase (registry match, ownership chain, sanctions screen, bank verification, adverse signals, policy evaluation); carryover holds finding ids and decisions; reflection ratifies the dossier | Stretch for small cases (break-even `N > 1 + 2C/O`); Direct for deep ownership chains or batch reviews with 15+ steps |
| Authoritative findings across chunks | **Markovian + World Model** | Carryover carries fact ids, not facts; every claim is re-verified against World Model, never against the compressed carryover | Required mitigation for lossy compression |
| Input guard, intent routing | **Scout** | Closed registry of Plumbline actions (`case.reconcile`, `case.explain`, `case.decide`, `po.release`, `vendor.update-bank-details`, `memory.approve-dream`, `policy.override`); guard against injection hidden in vendor documents, invoices and free-text fields | Direct for the guard; Stretch for classification (about a dozen intents is easy), so the value is the boundary, not the classifier |
| Authorization to act | **Scout** | `po.release` and bank-detail changes require a signed contract with `user-confirm` and `operator-review` approvals; the release executor verifies signature, TTL, scope and approvals and refuses otherwise (`contract.refused`) | Direct; our orchestration runtime must consume contracts or this is decoration |

**Per track.**

- Track 1, reconcile: World Model primary; H-MEM secondary (prior resolutions of the same conflict type); Scout for the ingest guard (documents are untrusted input).
- Track 2, explain: the explanation is built by our own verifier from engine provenance: World Model event ids, fact sources and audit; H-MEM retrieval trace and ledger chain; Scout contract trace; Markovian chunk records. This track is the lightest on the engines. The counterfactual ("what single change flips the decision") needs a World Model fork with selected events excluded; the engine has only time-based `foldUntil`, so the fork is our extension. Flag it as ours, not Meterless's.
- Track 3, decide: Scout (gate and contract), H-MEM (precedent), Markovian (reasoning over the dossier), our deterministic rule engine for the actual policy. Memory is context, not instruction (`reinjection.md` safety rule): a precedent can inform but never override a hard policy rule.

**Where the mapping is a stretch, stated plainly.**

1. Markovian's token saving matters at long horizons. A 6 to 8 step case will show little or no benefit; the break-even is a few chunks at default constants and the saving is lossy. We should not claim Markovian "saves tokens" for ordinary cases. Where we do use it, report measured numbers (section D) or do not report a number.
2. Scout's intent classification is nearly trivial with a dozen intents. Its real contributions to us are the injection guard, the capability scope, and the signed approval-bearing contract.
3. H-MEM dreaming and sleep, as specified, are advisory hygiene. Presenting them as "the system learns policy" would overclaim.
4. World Model's `ingest()` clustering (stories, velocity) is built for news streams. Reconciliation uses the primitives (`upsertEntity`, `assertFact`, `relate`), not stories.
5. Counterfactual replay is not an engine feature (above).
6. Auto-merge at 0.85 name similarity is unsafe for counterparties ("Acme Holdings Ltd" vs "Acme Holdings Inc"). Pass `decide()` defaults in conformance, but configure `resolver.autoMergeAt` to 0.92 or higher and require an authoritative-id match for merges that affect payments.

**Ablation as the usage test.** For each engine, switching it off must change a product output in a way we can show: no World Model, no as-of ownership answer; no H-MEM, a precedent-dependent decision changes or loses its citation; no Markovian, a long case exceeds its context budget or costs more measured tokens; no Scout, an injected invoice instruction or an unsigned release is accepted. Any engine for which we cannot show this is decorative and should not be claimed.

---

## D. Judge-facing evidence plan

**What the judges weigh.** Meterless's guide (`MT/docs/community/hackathon-guide.md`): usefulness 30, Meterless engine usage 25, local-first and privacy 15, demo 15, creativity 10, documentation 5. Its starter README says the engine-usage line looks for "every command routes through a named engine service" with the spec section. The GenAI Works rubric (Sponsor Tech 10 of 100) governs our submission in parallel.

**Evidence set (each item is a file, screen or command a judge can open):**

1. **Conformance transcripts.** Four captured runs with exit codes: H-MEM 13/13, World Model 8/8, Markovian 8/8, Scout eval report (all gates, zero skipped). Script: one command that sets the env vars, runs the vendored runners, and writes `output_examples/meterless/conformance-*.txt`. Run it in CI and in the clean-room verifier from a fresh clone. NOT VERIFIED until it exists and passes.
2. **Extended suites beyond the runners.** Our own tests for every "not asserted" clause in A.1 to A.4 (retrieval arithmetic to 4 decimals, mining and fallback, enrichment, sleep thresholds, conflict gate edge, fact-resolution replay after restart, edge cardinality, marker variants, cascade order, memory-in-chunk-1-only, abort, token labels). Publish a coverage matrix: spec clause, runner check, our test.
3. **"Where the engines are used" table in the README**, same shape as the starter's: UI action or CLI command, engine service, spec section, code path, trace event, test id.
4. **Per-decision trace lines** in the JSONL trace for every engine call, with the why: `hmem.query` (ids, scores, `retrievalReason`), `hmem.feedback` (delta), `world.assertFact` (policy, winner, loser), `world.merge` (similarity, band), `markovian.chunk` (step, cascade level, carryover tokens, prompt tokens with label), `scout.decision` (band, candidates), `contract.issued|verified|refused` (contract id, reason). Commit a cleaned sample under `output_examples/traces/`.
5. **Screens a judge can see.**
   - H-MEM: retrieval trace for a decision (ranked precedents with per-term scores), the ledger chain for one precedent (create, read, feedback, conflict_resolved, sleep_consolidate), the conflict queue, the dream approval queue, the sleep preview with guardrail status and restore.
   - World Model: audit browser, merge review queue with similarity and band, as-of slider (ownership at the PO date), a re-ingest button showing "diff: empty" and a mutated re-ingest showing a non-empty diff (the engine's own `--mutate` idea).
   - Markovian: chunk inspector with carryover in/out diff per step, cascade level per step, projected versus measured cost curve.
   - Scout: decision panel (candidates, band, clarification), the signed contract, and a refusal view (tampered, expired, out-of-scope, missing approval) from the executor.
6. **Measured token savings, done properly.** Their method (`reference/scripts/measured-run.ts`): same 20-step task through the orchestrator and a naive baseline, cumulative input-token table with a ratio, all labelled estimated. Ours must go further: (a) a real model on a real multi-step case; (b) the naive baseline is actually executed, not a constructed string; (c) token counts are provider-reported and labelled `measured`, with estimates labelled separately; (d) a quality check that both runs reach the same verified findings, so a cheaper but worse result is not counted as a saving; (e) the modelled curve from `projectionCurve` and `modelTotals` plotted against the measured one; (f) run at several N (for example 4, 8, 16, 24) and report where Markovian loses, using the break-even `N > 1 + 2C/O`; (g) report the worst of three runs, not the best. Use the run's own `chunkConfig` snapshot when computing efficiency.
7. **Cold versus warm memory, without a scripted generator.** Meterless's `examples/memory-compounding-research` skips steps 3, 4, 8 and 9 through a hard-coded index set in its mock generator, so the saving is built in. Ours: a real model, a seeded set of precedents (including a superseded one), measured tokens and chunks, an independent grader on the decision quality, and the stale-precedent-suppressed case shown in the retrieval trace.
8. **Kill-switch ablations** (section C): one table, four rows, with the observed change.
9. **Local-first proof.** Engine state is on disk (`state.json`, `ledger.jsonl`, `.world/<ns>.json`, `history.json` equivalents) and a network-denied run of the context operations still works under `SAMPLE_MODE`. Show the files and the offline run.
10. **Upstream contribution (optional, low cost).** File reproducible spec-feedback issues for items in Appendix 1 (merge threshold, `supersedes`/`supersededBy`, Scout runner coverage). Meterless's repo has an `evals/tests` folder for community evals; one H-MEM eval written to its template is a visible gesture. Only after we have failing tests of our own.

**Do not show:** conformance output from the reference and call it ours; estimated tokens labelled as measured; the memory-compounding table without the ablation; a Scout accuracy number quoted as a benchmark (the corpus README says it is a smoke set and the targets are not measured results).

---

## E. Risks, NOT VERIFIED items, licence

**Risks.**

1. **Reference gaps copied into our build.** If we port the reference literally we inherit: hash "embeddings", non-replayable fact resolution, closed multi-valued edges, un-ledgered backlinks, unenforced preview-first sleep. Mitigation: tests for each gap before porting any behaviour.
2. **Passing the runner by coincidence.** cg-001 accepts either `resolved` or `queued`, db-001 tolerates a proposal that creates no record, and an inert Scout already clears three of seven gates (A.4). Mitigation: extended suites and our stricter Scout grader.
3. **Sync/async design lock-in** (A.1). Retrofitting async into a sync-called API after the fact is expensive. Decide the sync core and async enhancers first.
4. **Live-object persistence** (A.1 item 3) is easy to get subtly wrong and only ro-001 exposes it.
5. **Scout is greenfield.** No reference to diff against; the spec has inconsistent shapes (Appendix 1). The harness's weak scoring invites optimizing the metric instead of the behaviour.
6. **Contract TTL versus long runs** (B). Without replan at phase boundaries, long chains fail late.
7. **Lossy carryover in a compliance setting.** A dropped sanctions hit would be a serious defect. Findings must live in World Model facts and be re-read at decision time.
8. **Overclaiming Markovian savings.** See section D.6 and C stretch 1.
9. **Judge reads the code.** If the engines are thin wrappers or the reference copied wholesale, "engine usage" may be discounted. Independent implementations plus load-bearing use plus the ablation table are the defence.
10. **Upstream drift.** The suite could change after 2026-07-22. Vendor a pinned copy with blob SHAs and re-check upstream before submission.

**NOT VERIFIED (state these as such anywhere they appear).**

- That any of the four runners or the reference tests pass on this machine. Not run.
- That the reference behaves as described in the **[inferred]** items (replay loss of fact resolution, `mentions` edge closing, ingest bypassing entity resolution, constant recency in conflict scoring, two token-accounting paths).
- Numeric outputs of Meterless's own demos and `measured-run.ts` (never run; do not quote them).
- That `node:sqlite` is acceptable for production use on Node 22.17 (experimental flag in output).
- That `npx tsx` resolves the `.ts` module graph of our implementation exactly as the runner loads it; confirm by running the runner once against a minimal stub before building anything.
- Whether Meterless offers a hosted or "cloud provider" (Power Day framing). Nothing in the repo says so (`docs/sponsors/meterless-integration-notes.md`).
- Whether the HackOS Meterless folder, Build Day or Power Day add requirements not in the public repo.
- Whether the swarm-orchestration engine (targeted August 2026) or the runtime engine has shipped since 2026-07-22: `main` had no such folders on 2026-10-13, but tags or other repositories were not checked.

**Licence obligations (Apache-2.0, `MT/LICENSE`, `Copyright 2026 Meterless`).**

- *Implementing from the spec.* Writing our own code that satisfies the contracts, numbers and formulas in the spec creates no Apache obligation on that code (ideas, algorithms and numeric constants are not copied expression). It is also the best fit for the "everything our own" decision (D-006) and for originality rules. We should still credit the spec in the README and the sponsor explanation.
- *Vendoring the test harness* (runners, `vectors.json`, eval runner, thresholds, fixtures, corpus): redistribution is allowed under section 4. Required: include a copy of the licence (`third_party/meterless/LICENSE`); keep any copyright notices (the harness files carry none, and the clone has no `NOTICE`; re-check the NOTICE situation at the pinned commit); if we modify a vendored file, mark the change prominently in that file. Add a provenance README: upstream URL, commit `0aa7417`, per-file blob SHAs, "unmodified". Add a `.gitignore` exception for `third_party/meterless/**/*.jsonl` (the repo ignores `*.jsonl`) and confirm `research/` stays ignored.
- *Adapting reference code or tests.* Same as above, plus a per-file header ("Portions adapted from Meterless, Apache-2.0, <file>; changes: ..."), and list the files in the sponsor explanation as third-party-derived. Prefer writing tests from the spec's stated numbers instead of copying the reference's tests.
- *Names and marks.* Section 6 grants no trademark rights. Describing "H-MEM, World Model, Markovian and Scout Intent as specified by Meterless" is fine; do not imply Meterless endorses our product or name our modules as if they were Meterless releases.
- *Our own licence.* Apache-2.0 code stays Apache-2.0 inside a differently licensed repo; confirm our repo licence is compatible before vendoring.

---

## Appendix 1: discrepancy register

Binding source for each is what the runner and reference do; "feedback" marks items worth raising upstream once we have a failing test.

| # | Topic | Conflicting sources | What we build to | Feedback |
|---|---|---|---|---|
| 1 | World Model merge thresholds | `AGENTS.md` 7.1: proposal at `>= 0.85`, never auto-destructive. `docs/ingest-pipeline.md`, `HOW_TO` section 6: auto `>= 0.92`, review 0.82 to 0.92. Runner and reference: auto `>= 0.85`, review `[0.82, 0.85)` | Runner values as `decide()` defaults, options for the stricter product setting | Yes |
| 2 | H-MEM supersession | `AGENTS.md` and docs: `supersededBy` set only by conflict resolution, `supersedes` suppresses conflicts. Upstream issue #3 | Set `supersededBy` on the replaced record when `supersedes` is declared (ledgered) | Already open (#3) |
| 3 | H-MEM entity shape | `{name,type}[]` (docs, `AGENTS.md`) vs `string[]` (reference) | Typed entities in storage, accept strings on input | Maybe |
| 4 | H-MEM provenance origins | `docs/memory-record.md` enum vs reference enum | Reference enum plus the docs values as aliases | No |
| 5 | H-MEM sleep consolidation | docs: short-term and working; reference: short-term only | Docs reading, tested | Maybe |
| 6 | H-MEM reinjection | `docs/reinjection.md` line format and safety rules vs reference `[MEMORY CONTEXT]` block that injects `review` memories | Follow the docs' safety rules; keep the reference block as one formatter | Maybe |
| 7 | H-MEM cross-engine examples | async object-argument `query`, `ingest`, `add({ entities })` vs sync `query(string, opts)` | Runner-bound API; thin adapters if wanted | Yes |
| 8 | Markovian marker cleaning | docs give regexes that strip everything after the final marker; reference strips only the marker | Satisfy mrk-001 either way; choose docs behaviour | No |
| 9 | Markovian run id, `stopWhen`, reflection limits, `tokensPerChunk`, per-run `chunkConfig`, `runFromContract` | docs/examples vs reference | Docs where implementable, alias `tokensPerChunk` | No |
| 10 | Markovian savings accounting | live progress vs final record formulas | One labelled path, plus provider-measured | Maybe |
| 11 | Scout `policyPack` | string (`AGENTS.md`) vs array (runner, `prompt-injection-block`) | Accept both | Yes |
| 12 | Scout tool plan shape | `{ tool, input }` (docs) vs `{ tool, reason }` and `.capability` (examples, runner) | Entries carry `capability`, `tool`, `input`, `reason` | Yes |
| 13 | Scout API surface | `classifyMulti`, `guard`, `planContext`, `process`, `verifyContract`, `signingSecret`, `runFromContract` appear only in examples | Implement the ones we use; mark as extensions | Yes |
| 14 | Scout contract risk | contract `risk.level` has no `block`; decision-level risk does | Two types | No |
| 15 | Scout `decision.intent.primary` | string in README, object with `id` in runner and contract | Object | No |
| 16 | Scout harness coverage | runner ignores multi-intent, clarification, risk labels; subset "precision"; skip-on-throw | Our stricter grader | Yes |
| 17 | Scout corpus hygiene | eval prompts verbatim in registry examples; risk labels below class floor | Add held-out prompts in our corpus | Yes |
| 18 | Conformance READMEs | "formulas, deltas, thresholds" vs runners that check orderings and behaviours | Extended suites | Maybe |
| 19 | Fixed-seed demo | `memory-compounding-research` saving is built into the mock generator | Do not reuse; section D.7 | No |
