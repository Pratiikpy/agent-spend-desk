# Zetaris public documentation readout

Date read: 2026-10-13. Scope: everything reachable without a login. Companion to `zetaris-integration-notes.md` (the facts table there should be updated from section 2 below; not done here).

## 0. Method and how far to trust each source

| Source class | How it was read | Reliability |
|---|---|---|
| GitHub `zetaris/getting-started` (Zetaris's own hackathon onboarding repo; last commit Fri 9 Oct 2026, pushed again 13 Oct), `zetaris/lightning-catalog`, `zetaris/Freemium`, `zetaris/zetaris-code-share`, `rh-ai-quickstart/ai-taxi-anomaly-detector` | `git clone`, files read in full | High. Verbatim text. |
| Public OpenAPI spec `https://api.saas.enterprise.zetaris.com/redoc/docs.yaml` | `curl`, HTTP 200 with no credentials, 48,948 bytes, 19 paths | High. It is the SaaS API, a subset of the roughly 280 paths the connection guide says a local instance exposes. |
| `kbase.zetaris.com` articles and `zetaris.com` pages | WebFetch, which summarises with a small model | Medium. Quotes below were produced by that summariser and could be paraphrased. Re-open the page before quoting publicly. |
| Press coverage (pulse2.com, techedgeai.com) | WebFetch | Medium. |
| Search tool | The session's search budget was exhausted, so nothing here comes from search | n/a |

Pages that were navigation shells with no article body: `kbase.zetaris.com/knowledge/coding-agent-connection-guide-claude`, `-cursor`, `-codex`, `-chatgpt` (each is a title, three images and the sidebar; the content is in screenshots), `data-lineage-overview` (two images and one sentence), `cloud.enterprise.zetaris.com/terms` (did not render), `marketplace.microsoft.com` (HTTP 403). runtimewire.com has no Zetaris article on its front page (not searched further).

## 1. What Zetaris says it values, and how it pitches itself

Themes a judge from Zetaris will recognise. URLs are the page the wording came from.

1. **Query in place, zero copy.** "Query data where it lives. No duplication. No egress fees." (zetaris.com/zetaris-meta-data-lakehouse). CEO: "Our AI Data Harness gives AI tools a real-time path to the data they need, wherever it lives, without forcing companies to centralize everything first." (zetaris.com/company/media-and-press/zetaris-launches-cloud-ai-data-harness-for-ai-agents, 6 Oct 2026).
2. **Governance travels with the query.** AI should access "the right data, under existing policies, at the time it is needed" (techedgeai.com/zetaris-launches-ai-data-harness-for-enterprise-ai/). Marketing page: every tool call "runs under the authenticated user's identity and permissions", row and column security "apply automatically". Older blog "Policy-Based Query Governance" (2022): "every query, algorithm, or data operation performed by an analyst, developer, AI agent, or BI user is assessed for policy compliance before it is run" (zetaris.com/blog/policy-based-query-governance). This sentence is not backed by any command or screen in the current docs.
3. **Auditability for regulated industries.** Founder interview: for regulated sectors "governed, logged, and reportable queries"; when a regulator asks where an answer came from, the enterprise must show the audit trail (zetaris.com/company/media-and-press/vinay-samuel-on-techimpact-why-ai-agents-need-a-data-harness). Marketing page: every agent query logged as structured JSON with "timestamp, user identity, the exact query or natural language request, which sources were touched, row count returned, latency, and any errors".
4. **"Maximize resolution before the LLM" / token firewall.** The model should receive "a precise answer set", not "here is all my data" (zetaris.com/blog/token-firewalls-agentic-ai-token-costs-zetaris). This is the same stance as our principle that models propose and code disposes, and that LLM roles read typed facts, not tables.
5. **Agents need meaning, not just access.** Agents can write queries but "can't know on its own what the data means"; the harness supplies an AI-built unified semantic layer (Vinay Samuel interview above). Product features: AI Data Steward (auto-generates data products from DDL or business glossaries), Unified Semantic Layer, Data Catalog with tags (zetaris.com/cloud, kbase `data-catalog-overview`).
6. **Multi-engine routing.** Query Director routes to Spark, Trino, Presto, DuckDB "automatically" (zetaris.com/zetaris-meta-data-lakehouse); KB `query-director` documents Spark and Presto routing with a `using <engine>` suffix.
7. **Open and vendor-agnostic.** "open, vendor-agnostic layer ... without ETL pipelines or proprietary lock-in" (press release); Iceberg and Delta as table formats; open-source `lightning-catalog` on GitHub (Apache-style licence header).
8. **Bring your own cloud and sovereignty.** BYOC, IAM role trust, "100% of your data stays in your AWS account" (kbase `zetaris-cloud-release-note-v.1.0.0`); blog "SaaSpocalypse: Why Sovereign AI Is Now a Business Imperative".
9. **Coding agents are first-class clients.** Home page lists Claude, ChatGPT, Cursor, Codex connection guides; the hackathon repo gives Cursor, Codex and Claude Code starter prompts and an `AGENTS.md`.
10. **Responsible AI.** Six principles including "Transparency and Explainability" ("AI-driven insights are understandable and traceable") and "AI should augment, not replace, human expertise" (kbase `responsible-ai-principles`). This matches our human-approval and explainability stance and is cheap to cite honestly.
11. **Financial-services positioning.** Use cases listed: anti-money laundering, credit risk, risk and regulatory reporting; claims "100% data governance and access control" and a case study "Major Australian Bank: Keys to Regulatory Compliance" (zetaris.com/industry/is-finance, zetaris.com/resources). A counterparty-release system sits inside this frame.

What Zetaris does not talk about: decision systems, policy engines, or explanation. It pitches the data layer under the agent. Plumbline is the layer above it, which is a clean story and also means Zetaris cannot be the place where decisions are made.

## 2. Verified facts for integration

Status key: VERIFIED (read verbatim from primary text), CLAIMED (vendor marketing, no hands-on), NOT FOUND.

### 2.1 Access, trial, sample data

| Fact | Value | URL | Status |
|---|---|---|---|
| Event access model | A **shared event instance**; teams get an assigned object prefix and permissions; "names alone do not isolate teams"; sources are either centrally provisioned read-only or team-registered; credentials and URL are supplied "through a private channel". Support destination, per-team permissions, driver distribution, org-ID discovery are listed as organizer decisions still unresolved. | github.com/zetaris/getting-started `START-HERE.md`, `docs/guides/hackathon-organizer-checklist.md` | VERIFIED (text); whether participants are administrators: NOT FOUND |
| Local install | Docker Compose bundle `zetaris-platform.zip` from `https://cloud.enterprise.zetaris.com/dashboard/download` after registering at `https://cloud.enterprise.zetaris.com/register`; images from `zetarishackathon.azurecr.io`; needs 8 GB RAM and 4 CPUs for Docker, 15 GB disk; images are amd64; services: postgres (metadata and **audit** databases plus sample data), driver, api, ui, bootstrap, `ai-datasteward` | `docs/install/updated_zetaris_installation_guide.md` | VERIFIED |
| Trial terms | "Without [an Order], the agreement allows internal evaluation for up to 30 days; it does not grant an ongoing licence." The Apache licence of the repo covers the recipes only, not the platform images. Home and cloud pages also advertise a "Free forever" Hobby tier: single node, max 12 vCPUs, "Live in ~20 minutes", Spark and Presto engines, you pay your own cloud bill. The two statements (30-day evaluation versus free forever) are not reconciled in any source; which applies to the event instance is NOT FOUND. | install guide above; zetaris.com/cloud | VERIFIED (both texts), conflict unresolved |
| Redistribution | Registry credentials are issued per account, so a judge cannot be handed our Zetaris stack in our repo. | install guide | VERIFIED (implication) |
| Sample data | Local install seeds a `TPCH` datasource (8 tables, `dataSourceId` 6) when `ZETARIS_SEED_TPCH=true`. Recipes in `open_data/`: PokeAPI (the only recommended starter), SEC EDGAR, company_dns SIC lookup, Open Food Facts, NASA NeoWs, Eurostat, StatCan, ABS (REST); NOAA GHCN and AWS Public Blockchain (files). PUDL, Foursquare, Overture, Ookla, GBIF are documented as failing. Nothing is counterparty, ERP or payments data. KB "test data sources" (Redshift, Azure SQL, Azure PostgreSQL, Azure Blob and S3 TPC-H) are from the older "Cloud Data Fabric" era; whether they still exist is unknown. | `docs/connections/claude-code-connection.md` section 7, `docs/guides/recipe-readiness.md`; kbase `connecting-to-test-data-sources` | VERIFIED |
| Rate limits, quotas, cost per query | NOT FOUND for any Zetaris API. The only numbers: SaaS REST `pageLimit` 1 to 100; helper default row cap 1000 and 30 s request timeout (these are the repo helper's, not the server's); an old KB article says queries on the Schema Store view stop after about 2 seconds and longer work belongs in a virtual data mart (Cloud Data Fabric era, current behaviour unknown). Pricing: Professional $0.14 per vCPU-hour, Enterprise $0.20 (zetaris.com/cloud). | docs.yaml; kbase `my-query-stops-running-after-2-seconds` | partly VERIFIED, rest NOT FOUND |

### 2.2 Connection methods

| Fact | Value | URL | Status |
|---|---|---|---|
| Methods offered | SQL Editor in the UI; JDBC; ODBC; REST API; MCP; Python/Spark SDK | zetaris.com/cloud, kbase `connecting-to-zetaris` | VERIFIED (listed) |
| **What the hackathon repo actually uses** | Only **JDBC and REST** (plus the SQL Editor). A search of the whole `getting-started` repository, and of `lightning-catalog`, `zetaris-code-share` and the Red Hat quickstart, for "mcp" and "Model Context Protocol" returns **no file**. | github.com/zetaris/getting-started | VERIFIED (negative result, repo as of its 9 Oct commit) |
| JDBC | Class `com.zetaris.lightning.jdbc.LightningDriver`; URL `jdbc:zetaris:lightning@<host>:<port>` (local default `localhost:10000`); driver JAR comes from the platform download, not Maven; JDK 11+; do not use a Hive or Spark driver; user ID and password. | `docs/connections/claude-code-connection.md` sections 2 and 4 | VERIFIED |
| REST (direct, local) | Base `http://localhost:8888/api/v1.0` locally, organizer-supplied URL for cloud; bearer **API key created by the user in the Zetaris GUI**; headers `X-Org-ID` (integer) and `X-Request-ID` (UUID) on every call; `GET /datasource/datasources`; `POST /sql-editor/sqls/run` returns `{"headers":[...],"data":[[...]],...}`; **every value comes back as a string** and decimals can appear as `0E-18`; the OpenAPI spec is served at `/redoc/docs.yaml` and the guide says it needs Basic auth on a local instance. | claude-code-connection.md sections 4, 6, 7, 8 | VERIFIED |
| REST (SaaS, public spec) | `GET /api/v1.0/auth/login` (Basic auth plus `X-Org-ID`, returns `idToken`, `refreshToken`); `GET /auth/refresh`; `POST /api/v1.0/query/sql/start` body `{"select": "...", "pageLimit": 1..100}` returns `records`, `pageNumber`, `totalCount`, `totalPages`, `queryToken`; `GET /query/sql/page?queryToken&pageLimit&pageNumber`; `DELETE /query/sql/close/{queryToken}` ("remove the cached query information from the server"); data catalog tag endpoints; datamart, pipeline and lightning-database listings. Security schemes: Basic, JWT bearer, API-token bearer (query endpoints require the API token). The two REST surfaces (`/sql-editor/sqls/run` versus `/query/sql/start`) differ; which one the event instance exposes is NOT FOUND. | api.saas.enterprise.zetaris.com/redoc/docs.yaml; kbase `accessing-zetaris-using-api`, `rest-api` | VERIFIED |
| Postman collection | KB points to `github.com/zetaris/zetaris-public`; that URL returns 404 (private or renamed). | kbase `rest-api` | NOT FOUND |
| **MCP server** | Claimed on zetaris.com/cloud ("Point Claude at a Zetaris MCP endpoint. It queries your live data directly"; "Add Zetaris as an MCP server in Cursor"). Marketing page: "The Zetaris MCP server is read-only. Agents can query, explore, and reason about your data - they cannot insert, update, or delete anything." The editions page lists **"MCP Toolkit" among Enterprise-only features** (zetaris.com/getting-started-with-zetaris), which conflicts with the Cloud page and may mean MCP is not on a Hobby or event instance. **URL pattern, auth, transport, protocol revision, tool names, tool schemas: NOT FOUND.** The four connection-guide articles are image-only. The `genz-tools` article describes GenZ (Zetaris's own chatbot) acting as an MCP **client** to internal and external tools, which is a different thing. | zetaris.com/cloud; zetaris.com/zetaris-meta-data-lakehouse; kbase `genz-tools` | CLAIMED, details NOT FOUND |
| Natural language to SQL | Claimed: "Analysts ask in plain English; Zetaris queries the data across every connected source". Interface (endpoint, tool name) NOT FOUND. GenZ chatbot: Docker app on port 3001, asks for API URL, email, password, org number, then Data Mart, tables, "Prescriptive" or "Descriptive" mode. | zetaris.com/zetaris-meta-data-lakehouse; kbase `genz` | CLAIMED |
| AgentFlow | Enterprise-tier feature: "autonomous workflows that query, reason, and act inside your governance boundary"; the page only lists a 6-step process. No API, schema or example. | zetaris.com/agentflow, /cloud | CLAIMED |

### 2.3 SQL dialect, engines, connectors

| Fact | Value | URL | Status |
|---|---|---|---|
| Dialect | Spark SQL plus "Lightning" extension commands (144 documented for the Datathon); Presto dialect also referenced. Standard Spark SQL SELECT over `<source>.<table>`; joins across sources allowed. | `docs/guides/zetaris-lightning-sql-commands.md`; kbase `sql-guide` | VERIFIED |
| Statement rules | One statement per execution; no trailing semicolon; qualified names; commands marked "Administrators only" are refused for others. Most create, drop, grant and register commands are administrator-only (CREATE DATASOURCE, CREATE LIGHTNING DATABASE and tables, COMPILE USL, ACTIVATE USL TABLE, REGISTER DQ, MATERIALIZE, EXPLAIN QUERY, streaming). | commands reference section 3 and entries | VERIFIED |
| Engines | Spark (default), Presto/Trino, DuckDB named on marketing page. Routing: engine dropdown or `... using Presto` / `using spark <engine>` suffix; `using <DataSourceName>` forces execution in the source system (after `DESCRIBE MASTER DATASOURCE`), not usable in subqueries or CTEs, no parameters. Spark 3.5.3 as of product 2.4.1.0 (June 2025). | kbase `query-director`, `force-a-query-to-be-executed-in-the-source-environment`, `product-version-2.4.1.0-03rd-june-2025` | VERIFIED |
| Connectors (documented articles) | Iceberg, Kafka (streaming), Redshift, S3, Azure Blob, Azure Databricks, Collibra, Elasticsearch, BigQuery, Hive, Dynamics 365, Purview, SQL Server, Ocient, Oracle, Salesforce, Splunk, Snowflake, SugarCRM, XML on data lake, HCP on S3, MinIO, Teradata, AWS Glue and Hive metastore; plus JSON/CSV/Parquet files, REST tables, JDBC sources (`CREATE DATASOURCE` with `jdbcdriver`, `jdbcurl`). PostgreSQL and MySQL are named on the home page and in `lightning-catalog` docs. | kbase `connecting-to-data-sources`; commands reference 4.1 | VERIFIED (listed) |
| Source reachability rule | "Zetaris must be able to reach the data source. Being able to reach it from your laptop isn't enough." A broker at `localhost` on a participant machine is not reachable. | START-HERE.md; commands reference 7.1 | VERIFIED |
| REST tables | `CREATE LIGHTNING REST TABLE` re-issues the HTTP request **on every query that touches it**; no confirmed way to send a raw JSON body; 429 and 502 cases documented. | `docs/guides/zetaris-lightning-sql-companion.md` section 5 | VERIFIED |
| Caching | `CACHE TABLE` is Spark's session cache (observed to expire silently; `SHOW CACHE TABLES` unreliable); `OFFSITE CACHE TABLE ... TO MEMORY|FILE WITH (expireInSec ...)` with history exists; persistent alternative is materialization (`INSERT INTO FUSIONDB...` or `MATERIALIZE USL TABLE`). Table counts under-reported in one UI case (tracked with Zetaris). | companion section 5; commands reference 19 | VERIFIED |

### 2.4 Security model, audit

| Fact | Value | URL | Status |
|---|---|---|---|
| User types | Administrator (full control of builder, schema store, catalog, access control, user management) and End-user (sees Schema Store View only; sees only provisioned objects; some rows and columns restricted; some columns "obfuscated, through encryption or masking"). A "multi-tier" persona between them can own data marts and pipelines but not connections. | kbase `user-types`, `multi-tiers-of-user-release` | VERIFIED |
| Object access | Explicit allow model: "unless a user is granted access, they will be denied access to data." Roles preferred over users. `GRANT {SELECT|INSERT|CACHE} ON ... TO {ROLE|USER} [WITH GRANT OPTION]`; view grants use `VIEW TABLE <container>.<view>` or `VIEW NAMESPACE <container>`; views cannot be ASSIGNed, only GRANTed. `CREATE ROLE`, `ASSIGN USER ... TO ROLE`, `SHOW GRANT`, `SHOW USERS`, `DESCRIBE USER` exist. | kbase `controlling-table-level-access`; commands reference 20, 21 | VERIFIED |
| Row and column policies | Five per-column actions: **Grant, Deny, Hide, Masked (regex, string columns only), Encrypted (key, string columns only)**; a "Policy Level Filter" expression restricts rows; user policies override role policies. Stated to be configurable "through SQL or the Advanced Access Control UI" but **no SQL statement for policies appears in the 144-command reference**; the documented route is the UI (NDP Fabric Builder, Schema Store View, "Configure Columns"). Column-based access control for schema store views arrived in 2.4.1.0. A cascading-policy article uses an Airflow DAG to copy a parent-table row filter to child tables. | kbase `controlling-row-level-access`, `cascading-user-policies-in-fact-and-dimension-tables`, `product-version-2.4.1.0-03rd-june-2025` | VERIFIED (UI), SQL syntax NOT FOUND |
| Identity of the caller | Query runs under the authenticated user's identity: marketing claim for MCP. For REST the repo says the API key "acts as your user: it sees the same objects and carries the same permissions". | zetaris.com/zetaris-meta-data-lakehouse; claude-code-connection.md 6.1 | CLAIMED (MCP), VERIFIED (REST text) |
| Other auth | SAML (Okta), OIDC SSO, LDAP; envelope-encrypted credentials in Zetaris Cloud. | kbase `whats-new-in-zetaris`, `user-management-overview` list, release note 1.0.0 | VERIFIED (listed) |
| **Audit log contents** | Only the marketing sentence in section 1 item 3 (timestamp, identity, exact query or NL request, sources touched, row count, latency, errors). The bundle has an "audit database" in postgres. A consent article mentions "Zetaris Lightning audit information" joined with history. **No command, endpoint, table name, schema or retrieval path for the audit log appears in the 144 commands, the SaaS OpenAPI spec, or any KB article read.** Whether a participant (non-admin) can read it: NOT FOUND. | zetaris.com/zetaris-meta-data-lakehouse; install guide; kbase `creating-automated-consent-mechanisms-with-metadata-tagging` | CLAIMED; access path NOT FOUND |
| Query history | Per-user history is stored under `customer_data/.../users/<email>/history` in the Freemium Docker layout. Retrieval path NOT FOUND. | github.com/zetaris/Freemium | VERIFIED (file layout only) |
| Lineage | A lineage view exists in the UI (body is two images). No API. | kbase `data-lineage-overview` | NOT FOUND (content) |
| Catalog | Table and column metadata, statistics (record count, size, cardinality, min, max, average), **metadata change history with timestamps**, metadata search, tags; REST endpoints to list, add and remove table tags exist in the public spec. | kbase `data-catalog-overview`; docs.yaml | VERIFIED |

### 2.5 Semantic layer and data quality (USL)

| Fact | Value | URL | Status |
|---|---|---|---|
| USL | DDL (`CREATE TABLE` with PRIMARY KEY, UNIQUE, FOREIGN KEY, NOT NULL, CHECK; scalar types only, no ARRAY, MAP, STRUCT) is compiled and deployed into `lightning.metastore.<namespace>`; `ACTIVATE USL TABLE ... AS SELECT` binds a table to a query "after checking the query matches the declared schema"; `LOAD USL` returns the model as JSON (tables, ordered columns, keys, materialization info); descriptions can be set at USL, table and column level. Queried as `lightning.metastore.<ns>.<usl>.<table>`. A multi-table `COMPILE USL` must be sent as one statement (the Workspace editor splits on `;`). | commands reference 13; companion section 8 | VERIFIED (commands); several behaviours "not yet live-tested" per the companion |
| DQ | PK/UNIQUE/FK constraints auto-register as rules named after the column; `REGISTER DQ <rule> TABLE ... AS <boolean expr>`; `RUN DQ` returns total, valid, invalid counts; `SHOW DQ INVALID RECORD` returns one JSON object per row in a single `records` column. Live-confirmed limits: no table alias in `REGISTER DQ`, no window functions, same-table self-consistency checks not expressible when table name equals a column name. Cross-USL foreign keys untested. | commands reference 14; companion 8.5, 8.6 | VERIFIED |
| Materialization | `MATERIALIZE USL TABLE ... TO STORAGE (format parquet|delta|iceberg, path, recordType all|valid, storageSettingId)`; `valid` writes only rows passing DQ. | commands reference 15.2 | VERIFIED (syntax); not live-tested in the repo |
| Iceberg | Iceberg is an open table format with "Time-Travel ... query tables at any valid snapshot in time" (an Iceberg feature statement in lightning-catalog docs); Zetaris lakehouse tables use Iceberg. The Zetaris syntax for querying a snapshot or as-of: NOT FOUND. | github.com/zetaris/lightning-catalog `doc/doc/build-open-lakehouse-using-apache-iceberg.md`; kbase `sql-guide` | NOT FOUND (syntax) |

### 2.6 Streaming and change capture

| Fact | Value | URL | Status |
|---|---|---|---|
| Streaming | `REGISTER STREAMING DATASOURCE` supports **Kafka input and JSON only**; `REGISTER STREAMING AGGREGATION` writes to Parquet, ORC, CSV or JDBC; both administrator-only; broker must be reachable from the platform. | commands reference 7 | VERIFIED |
| Zetaris status of Kafka | The roadmap marks Kafka "Deferred": "Held back until it's confirmed a hobby-edition Zetaris instance ... can actually ingest from a broker". | `docs/plans/FUTURES.md` | VERIFIED (the vendor's own caveat) |
| CDC | KB "Zetaris CDC" guide: SQL Server CDC, Debezium, Kafka, Zookeeper, Kafka Connect; Zetaris is the aggregation and query side. Prerequisite list is heavy (Java, Kafka 3.3.1+, Debezium 2.0.1+). | kbase `zetaris-cdc-change-data-capture-in-real-time` | VERIFIED |

## 3. Capabilities in their docs that our spec does not yet use

Spec reference: section 6 (M1 Source Fabric, MCP client), section 15 (roster), section 18 (governance), section 19 (sponsors).

| Capability | Evidence | Why it matters to us |
|---|---|---|
| JDBC and REST are the documented, hackathon-supported routes; MCP is not in the vendor's own hackathon material | section 2.2 | Spec section 6 and section 19 make the MCP server the Zetaris path. The first adapter should be REST (and JDBC), with MCP behind it. |
| View-level GRANT to roles; explicit-allow model; end-user sees only Schema Store views | section 2.4 | A documented, scriptable way to give an agent identity access to a safe view and nothing else. |
| Column policies Hide, Masked, Encrypted; row filters | section 2.4 | Data-layer enforcement of what an LLM role can see (UI-configured). |
| USL: typed DDL, activation schema check, `LOAD USL` JSON, PK/FK DQ rules, `RUN DQ` counts | section 2.5 | A typed data contract we can hash and pin. |
| `DESCRIBE`, `SHOW SERVER VERSION`, `EXPLAIN QUERY` | commands reference 18, 23 | Version and plan metadata for cassettes and evidence records. |
| `using <source>` forcing pushdown; Query Director engine choice | section 2.3 | Controls whether a join runs in Zetaris or in the source. |
| Catalog tags, descriptions and **metadata change history** | section 2.4 | Drift signal for schemas and declared authority. |
| `OFFSITE CACHE ... HISTORY`, materialization to Parquet, Delta, Iceberg | section 2.3, 2.5 | Persistent, inspectable snapshots instead of Spark's volatile cache. |
| Iceberg time travel | section 2.5 | Pinned as-of reads of the silos (syntax unverified). |
| Streaming/CDC | section 2.6 | Re-review trigger (see idea 7); heavy and unverified. |
| `REGISTER PDF DATASOURCE` (open-source lightning-catalog; SQL over PDF metadata and content) | lightning-catalog `unstructured-data.md` | A second text extractor (see idea 15). |
| Automated PII classification (NER tagging, masking, anonymisation) | kbase `automated-pii-detection` | Tag-driven masking of natural-person fields (F-PERSONS). |
| Consent-style "virtual filter" pattern (blocked-record IDs joined away in pipelines) | kbase `creating-automated-consent-mechanisms-with-metadata-tagging` | A pattern for propagating "do not pay" flags. |
| GenZ chatbot, AI Data Steward, AgentFlow, Natural Language to SQL | section 2.2 | Rejected or baseline-only; see ideas 11 to 13. |

## 4. Candidate ideas

Rule applied: an idea that pleases Zetaris and does not improve Plumbline is REJECT. "Embedded parity" means the idea is implemented in the embedded `SiloPort` too, so a judge without an account runs the same behaviour.

Ordering is by number, not by merit; the ranking is in section 5.

### Idea 1. Provenance-preserving federated evidence views across separate synthetic backends

- **What.** Put the synthetic ERP vendor master, payments history, contracts metadata and an employee-adjacent table in three different backends behind Zetaris (for example Postgres JDBC, Parquet files, a REST table). Publish named, parameterised **evidence views** that return one row per fact with `source_system`, `record_id` and `locator` columns (a UNION ALL of per-system projections), plus a small set of true cross-silo joins on deterministic keys: bank-account reuse across vendors and employees (ghost vendor), tax-id reuse, payments to vendor ids absent from the master.
- **Motivated by.** "One connection. Every source. Cross-source joins included." (meta-data-lakehouse page); the `Query Director` and `using` pages; the cross-source join statement in commands reference section 3 rule 5.
- **Improves.** Usefulness and correctness. The shell-vendor and ghost-vendor families in spec section 16 are naturally cross-silo queries. Fan-out candidate retrieval ("every record in any system that mentions this bank account") is one governed call instead of four adapters.
- **Cost and risks.** (a) Joins collapse provenance, which Reconcile needs; therefore views must keep per-source rows and a key-based join is allowed only for candidate retrieval, never for resolution. (b) Aggregates break counterfactuals (M4 needs row-level evidence), so push down filters, projections and key joins, not aggregates. (c) Dialect: Zetaris runs Spark SQL; the embedded engine must run the same statements or we compile a typed query IR to both; free-form SQL from agents is not allowed anyway. (d) Reachability: Zetaris must reach the backends; on a local install that means containers on the same Docker network (how to attach our own Postgres or MinIO to the bundle: NOT FOUND). (e) Registration commands are administrator-only. (f) Build weight: three backends plus the parity harness.
- **Zetaris would see.** The headline pitch, shown for real, with a fraud scenario in a regulated function.
- **Verdict: ADD** (sponsor profile; embedded parity is mandatory).
- **Proof.** Differential test: the same 200 planted cases through embedded and Zetaris paths give identical evidence-record sets (row ids, hashes) ignoring order; ablation: remove the ghost-vendor cross-silo view and show the planted ghost-vendor cases are no longer caught (recall drop with interval); assert in the trace that each row carries its originating system.

### Idea 2. Role-scoped views and grants as the data-layer enforcement of "which role sees what", including "the model never sees the raw bank account"

- **What.** Three identities (agent-reader, reviewer, approver) with roles. Base tables get no grant for the agent role. The agent role gets `GRANT SELECT` on views only; those views project `bank_account_masked` (for display), `bank_account_hash` (salted `sha2`, for matching) and omit the raw column. The approver identity can see raw values in the human approval UI. Optional second layer: UI-configured column policies (Hide or Masked) on the base tables. LLM-bearing components run under the agent-reader identity, so a prompt-injected extractor or judge cannot read a full account number even if our own gate has a bug.
- **Motivated by.** "unless a user is granted access, they will be denied access to data" and "GRANT ... ON VIEW TABLE" (kbase `controlling-table-level-access`; commands reference 21.4); end-user sees Schema Store views only (`user-types`); column actions Grant, Deny, Hide, Masked, Encrypted (`controlling-row-level-access`); marketing claim that queries run under the caller's identity.
- **Improves.** Safety (defence in depth outside our codebase, a second independent control for ASI01/ASI02 style failures), data minimisation for LLMs (a real GDPR-flavoured benefit, spec section 18), explainability (audience-tiered views, spec section 13, map to roles), determinism (masking is a view definition, not a model behaviour).
- **Cost and risks.** (a) Needs several identities and the ability to create roles, users and grants: administrator-only, so this works on a **local install**, not necessarily the shared event instance. (b) The Masked and Hide policies are UI-only in the documented material; views plus GRANT are fully scriptable, so make views the primary mechanism and policies an optional extra. (c) Masked supports regex on string columns only. (d) Unverified whether `GRANT ... ON VIEW` is enforced identically over JDBC, REST and any MCP path. (e) Hash-based matching needs a per-deployment salt kept outside the data. (f) Embedded layer must replicate role semantics exactly.
- **Zetaris would see.** Their governance story used the way they describe it, with an adversarial test they can appreciate.
- **Verdict: ADD** (local install and cassetted proof; embedded parity).
- **Proof.** Three-identity test matrix: agent role selects from a base table (expect refusal), from the masked view (expect masked and hash columns only), from the raw column (expect refusal); injected-prompt test where a hostile document makes the extractor ask for `SELECT *` on the base table and the data layer refuses regardless of our code; ablation: with the embedded layer enforcing nothing and the gate disabled, count raw account numbers appearing in LLM prompt logs (expect zero with the views, nonzero in a control arm); cross-check that the same matrix gives the same visible columns on embedded and Zetaris.

### Idea 3. USL as the data contract between internal systems and Plumbline

- **What.** Generate USL DDL from our own versioned silo schema (single source of truth in the repo). `COMPILE USL ... DEPLOY`, `ACTIVATE USL TABLE ... AS SELECT` per evidence view (activation fails inline if the query does not match the declared types), `LOAD USL` to get the deployed model as JSON, canonicalise and hash it (JCS profile), and pin that hash like tool schemas are pinned (spec section 5). A changed model fails closed. Optionally run `RUN DQ` on the PK/FK rules and record total, valid and invalid counts as a contract-conformance attestation for the snapshot.
- **Motivated by.** Commands reference section 13 to 14; companion section 8.2 ("schema validation on activation", "explicit FK ... generates a DQ rule automatically"); Vinay Samuel interview ("can't know on its own what the data means").
- **Improves.** Reproducibility and determinism (typed, hash-pinned contract), explainability (column types, keys and descriptions travel with the evidence), safety (an upstream schema change cannot silently reshape evidence).
- **Cost and risks.** (a) Administrator-only. (b) Several USL behaviours are "not yet live-tested" in Zetaris's own companion; cross-USL foreign keys are untested; `REGISTER DQ` cannot express same-table consistency checks. (c) Scalar types only: no arrays, maps, structs, so nested evidence must be flattened. (d) A USL table's activation query is ordinary Spark SQL, so the Spark vs embedded dialect problem from idea 1 applies. (e) Do not depend on Zetaris-only metadata for correctness: the contract source of truth stays in our repo and Zetaris is checked against it.
- **Zetaris would see.** The Unified Semantic Layer, which they treat as a differentiator and describe as the only scriptable consumption layer.
- **Verdict: ADD** (local install proof; hash recorded in cassettes; embedded layer validates against the same schema file).
- **Proof.** Mutation tests: change a column type, drop a key, rename a view in Zetaris and show the pinned-hash check fails closed with a typed reason; contract round trip: schema file to DDL to deployed `LOAD USL` JSON to hash equals expected hash; planted PK and FK violations in the synthetic silos produce `RUN DQ` invalid counts that match the generator's ground truth.

### Idea 4. Audit-log cross-check against our trace

- **What.** Every query our trace says we issued must appear in the Zetaris audit log and vice versa; a mismatch raises an alarm (unlogged query, replayed cassette posing as live, tool misuse). This is in spec section 19 and F-ZROLE.
- **Motivated by.** The audit sentence on the marketing page; the "audit database" in the bundle.
- **Improves.** Security and evidence integrity, in principle: an independent witness that a row came from Zetaris at time T under identity U.
- **Cost and risks.** The retrieval path for the audit log is **NOT FOUND** in every public document, and the commands that expose most admin data are administrator-only. Contents are a vendor claim only. A judge cannot reproduce it (no account), and replay mode has no audit log to compare. If the log is only readable by an admin, the identity doing the cross-check must be privileged, which weakens the isolation argument. Matching by timestamp and query text is fragile (normalisation, retries, paging).
- **Zetaris would see.** Strong: it exercises the exact feature they advertise.
- **Verdict: MAYBE.** Keep out of the core. Probe the instance first; if a read path exists, make it a live-only optional evidence line, never a correctness dependency. The existing wording in the spec ("Kept") should be softened until a read path is shown.
- **Proof.** Probe: find any way to read the audit data (admin SQL, API, the audit postgres database on a local install, UI export). If found: plant an unlogged query via a side channel and show the alarm fires; replay a cassette and show the alarm reports "no live query". If not found within the probe, record the negative with the list of places searched.

### Idea 5. Hash-pinned query cassettes: query text, parameters, result hash, server version, USL hash, optional snapshot id

- **What.** Cassette key = hash of canonicalised SQL, parameters, USL model hash and role. Stored: result rows (or their hash where rights or privacy require), `SHOW SERVER VERSION`, retrieval time, row count, the `queryToken` page structure, and, where silos are Iceberg tables and the syntax is verified, the snapshot id. Never rely on Zetaris caching for evidence: REST tables re-fetch on every query and `CACHE TABLE` is a volatile session cache that expires silently. Real-time reads in live mode, immutable evidence in the store, replay from cassettes.
- **Motivated by.** Companion section 5 (re-fetch on every query, silent cache expiry, count under-reporting, REST returns strings and exponent decimals); Iceberg time-travel statement; install guide `SHOW SERVER VERSION`.
- **Improves.** Reproducibility, determinism and correctness. Specifically handles: all-strings results (typed decode in our schema), exponent decimals, paging, and the documented row-count under-reporting (cross-check `totalCount` against rows received and the generator's count).
- **Cost and risks.** Cassettes of Zetaris results may contain synthetic data only (allowed); a stale snapshot is not "real-time", so the dossier must state the read time and mode. Snapshot pinning is **NOT VERIFIED**.
- **Zetaris would see.** Neutral to positive: shows we handle their documented quirks rather than hiding them.
- **Verdict: ADD.**
- **Proof.** Replay equality (same trace and state hash); a mutated cassette raises `CassetteMiss`; fault injection at the Zetaris port (429, 502, truncated page, string-typed decimal, wrong `totalCount`) each produces a typed failure state and none produces an empty success.

### Idea 6. Catalog tags and descriptions as source-authority metadata

- **What.** Store authority tier, system-of-record flag and "copy of" declarations as catalog tags or USL descriptions, and have M1 read them.
- **Motivated by.** Catalog tags with REST endpoints, metadata change history, USL descriptions (section 2.4, 2.5); spec principle 8 "declare, do not infer".
- **Improves.** Marginally: a human data steward could maintain authority where the data lives.
- **Cost and risks.** Authority drives decisions, and a mutable external tag is an attack surface (a poisoned tag raises authority; spec principle 9 says trust never rises). Tag edits are not signed or versioned in any documented way beyond a timestamped change history. A judge would have to trust tags we wrote ourselves.
- **Zetaris would see.** Good fit with their catalog and semantic layer.
- **Verdict: MAYBE, as a drift detector only.** The authoritative table stays in the repo; compare it with tags, and a mismatch becomes a restrict-only signal (escalate). Never read authority from Zetaris. Cheap once idea 3 exists.
- **Proof.** Test where a tag is changed to raise a source's tier: the run still uses the repo tier and escalates with a drift reason. Ablation shows no decision changes when tags are removed.

### Idea 7. Change detection on vendor master as a trigger for re-review

- **7a. Poll-based trigger over a change-history view.** Plumbline polls a bitemporal `vendor_bank_history` view through the normal SiloPort, diffs against the last decision's dependency set (spec section 11 decision-dependency graph), and queues a re-review when a bank detail changes before a pending or recent release.
  - **Improves.** Usefulness: the bank-detail-change fraud family is the core of the problem statement.
  - **Costs.** None specific to Zetaris: any SiloPort can do it, so it is not a Zetaris idea. It still deserves a place in the plan.
  - **Verdict: ADD as a Plumbline feature; do not credit it to Zetaris.** Proof: a planted bank change after a PASS decision re-queues the case and the dossier shows both snapshots.
- **7b. Zetaris Kafka/CDC streaming.** `REGISTER STREAMING DATASOURCE` plus Debezium CDC.
  - **Costs.** Kafka and JSON only, administrator-only, the broker must be reachable by the platform, Zetaris itself lists Kafka ingestion on the free edition as "Deferred ... needs verification", the CDC guide needs Java, Kafka 3.3.1+, Debezium and SQL Server; judges cannot reproduce; heavy to build; nothing verified.
  - **Verdict: REJECT** for the core. Revisit only if the event instance ships a working Kafka demo and a stream reader we can exercise unprivileged.
  - **Proof of rejection basis.** Not run; based on the vendor's own caveat.

### Idea 8. Zetaris as system of record for precedent and decision logs

- **What.** Store M6 precedent and the M9 decision ledger in Zetaris-managed tables (Iceberg or FUSIONDB).
- **Why not.** The ledger must be append-only, tamper-evident (Merkle history, signed checkpoints) and verifiable offline by a stranger; that cannot depend on a third-party cloud service. A mutable SQL engine with administrator-only DDL is the wrong trust anchor; the claimed MCP server is read-only (so agents cannot write through it); it creates lock-in; a judge without an account could not verify anything.
- **Improves.** Nothing we cannot do better locally.
- **Zetaris would see.** Pleasing (a flagship write path) but it would harm the product.
- **Verdict: REJECT.**
- **Proof.** n/a. (See idea 9 for the read-only export variant.)

### Idea 9. Publish decisions back as a Zetaris-queryable data product (hold flags visible to other consumers)

- **What.** Export a Plumbline decision feed (case id, vendor key, decision, hold reason code, rule version, dossier hash) as files or a REST table that Zetaris registers read-only, so other agents and BI tools querying the vendor view see `release_hold`. Follows Zetaris's "virtual filter" consent pattern.
- **Motivated by.** The consent-mechanism article; the Zetaris pitch that multiple consumers share one governed layer.
- **Improves.** Usefulness (cross-consumer consistency: a second agent cannot release what the first held) and explainability (decision lineage queryable by auditors).
- **Cost and risks.** Requires Plumbline output to be reachable by Zetaris (S3-compatible store or an endpoint), which exposes decisions to a cloud service; synthetic data only in the demo; the hold flag must be restrict-only and signed or hash-linked to the ledger, otherwise a tampered feed could release a held vendor. Adds a second consumer-facing surface to test. Build weight moderate.
- **Zetaris would see.** Good: closes the loop in their architecture.
- **Verdict: MAYBE.** Worth building only after ideas 1 to 5, and only as a read-only view with a ledger hash column.
- **Proof.** Test: a second, naive agent connected to the Zetaris view refuses to propose a release for a held vendor (ablation: without the feed it proposes the release); tamper test: edit the feed row and show the verifier flags the hash mismatch.

### Idea 10. Expose Plumbline to Zetaris-connected agents through MCP

- **What.** Plumbline's planned MCP server (`reconcile_vendor`, `explain_claim`, `verify_bundle`, `submit_case`, `get_decision`) used side by side with Zetaris data access by one stock agent (Claude Code or Cursor), with a recorded conversation.
- **Motivated by.** Cursor, Claude Code and Codex are the documented Zetaris clients; spec section 14 already has the MCP server.
- **Improves.** Usefulness and impact narrative: "Zetaris gives agents the data, Plumbline gives them a safe decision". Also surfaces a real security issue to test: two MCP servers in one context, one returning vendor-derived text.
- **Cost and risks.** The Zetaris MCP server's availability, auth and tools are NOT FOUND; "MCP Toolkit" is listed as Enterprise-only. If it is unavailable, the same demo works with the agent using Zetaris over REST or JDBC through its shell.
- **Zetaris would see.** Very positive.
- **Verdict: MAYBE** (low cost, high demo value; ship it as an integration test, not as a feature).
- **Proof.** Scripted transcript with both tool sets; check that Plumbline outputs are marked untrusted by the agent harness, that `submit_case` creates only a review item, and that a planted prompt injection in a vendor field does not change which tool the agent calls.

### Idea 11. Zetaris-native agent paths (MCP, Natural Language to SQL, GenZ) as the naive baseline in the role-necessity ablation

- **What.** Add an arm: one strong model with only Zetaris's own agent surface (NL to SQL over the same silos, no Plumbline reconcile, ledger or policy) answers "release this payment?" on the same gold cases. Report agreement with ground truth, unsupported-claim rate and false-release rate against Plumbline.
- **Motivated by.** The Vinay Samuel interview ("an AI data harness [is] essential infrastructure enabling coding agents ..."), the NL to SQL claim, the token-firewall blog.
- **Improves.** Impact and honesty of the evaluation: it measures Plumbline against the vendor's recommended agent pattern, not a strawman. Also tells us where raw NL to SQL breaks (silent misjoins, absent versus false).
- **Cost and risks.** Nondeterministic and cloud-dependent, so it is an evaluation arm only, never in the product; the NL to SQL interface is NOT FOUND; results must be reported even if Zetaris looks good; token cost.
- **Zetaris would see.** Mixed but honest; a fair comparison is better received than silence.
- **Verdict: ADD** (contingent on a working interface; fall back to a model-written-SQL arm over REST).
- **Proof.** Pre-registered arm in the existing ablation file; worst-of-three reporting; cluster-bootstrap intervals.

### Idea 12. Natural-language-to-SQL in the evidence path

- **Verdict: REJECT** (confirms the spec). A nondeterministic query generator ahead of the evidence store contradicts typed, replayable queries. Revisit only as a clearly labelled exploratory console panel whose output is never admissible as evidence.

### Idea 13. AgentFlow and AI Data Steward as planner or onboarding aids

- **What.** Use AgentFlow for workflows, or the AI Data Steward to propose views and descriptions from DDL or a glossary when onboarding a new internal system.
- **Evidence.** AgentFlow is Enterprise-only with no interface documented; the steward runs as a container (`ai-datasteward`) with no documented API.
- **Improves.** Possibly onboarding speed for real customers' unknown ERP exports; not correctness.
- **Verdict: REJECT now.** Revisit only if the trial shows a documented API and the output fits `Proposal<T>` (a proposal is checked by contract tests before it is used).

### Idea 14. Import Zetaris lineage as the origin DAG for independence counting

- **What.** Read lineage from Zetaris to declare which internal tables copy which.
- **Why not.** Lineage has no documented API (UI images only), and we author the view definitions ourselves, so the origin DAG is already data we declare. Adds a dependency for no new information.
- **Verdict: REJECT.**

### Idea 15. Zetaris PDF data source as a second text extractor

- **What.** `REGISTER PDF DATASOURCE` (open-source lightning-catalog) as the independent extractor for L3 agreement.
- **Why not.** No character offsets, no hidden-text signals, JVM and Spark weight, extractor library unknown; our locator-fidelity layer exists because generic extractors fail there. It would not improve the measured silent-wrong-locator rate.
- **Verdict: REJECT.**

### Idea 16. Public registries (GLEIF, EDGAR) through Zetaris REST tables

- **What.** Register public registries as Zetaris REST tables so one query joins internal data to public data.
- **Why not.** Zetaris re-issues the HTTP request on every query, cannot send a raw JSON body, produces 429 and 502 failures in its own recipes, and would bypass our per-source contracts (rate budget, licence gate, cassettes, per-attribute authority, fetch states). It would make the evidence weaker.
- **Verdict: REJECT.**

### Idea 17. Scale benchmark on Zetaris

- **What.** Load millions of synthetic payment rows and report Plumbline's candidate retrieval latency on the federated path.
- **Why not (as a headline).** The embedded engine can run the same scale, so Zetaris is not needed to prove Plumbline's claims, and the number would not be reproducible by judges. Measuring Zetaris query latency and timeouts is still required to set budgets (F-BUDGET); that is characterisation, not a feature.
- **Verdict: REJECT as a feature**; keep as a measurement inside idea 5's fault-injection work.

### Idea 18. Pushdown and engine routing (`using <source>`, Query Director) as an optimisation

- **What.** Force execution in the source system for heavy tables.
- **Evidence.** Works only as the last clause, not in subqueries or CTEs, no parameters.
- **Improves.** Performance only, and only at scales we are not claiming.
- **Verdict: REJECT** (no product claim depends on it). Pushdown of filters and projections happens by default and is covered by idea 1's design constraints.

## 5. Ranking and facts that are unspecified

### Top 5 (ordered)

1. **Idea 2, role-scoped views and grants as data-layer enforcement.** The only idea that adds an independent safety control outside our codebase, it is scriptable with documented SQL, and it supports the "LLM never sees the raw account number" claim with a testable matrix.
2. **Idea 3, USL as the data contract.** Turns the silo schema into a typed, hash-pinned, fail-closed artifact and gives planted-violation ground truth through DQ counts.
3. **Idea 1, provenance-preserving federated evidence views.** The fragmented-intelligence story made real, with cross-silo fraud queries that a single-silo system cannot answer.
4. **Idea 5, hash-pinned query cassettes and fault injection.** Handles every quirk Zetaris documents about itself (re-fetch, volatile cache, string-typed results, count under-reporting) and keeps the judge run deterministic.
5. **Idea 11, Zetaris-native agent as the baseline arm.** Strengthens the Impact evidence by beating the vendor's own recommended pattern in a pre-registered comparison.

Next in line: idea 10 (MAYBE), idea 9 (MAYBE), idea 4 (MAYBE until an audit read path is shown), idea 6 (MAYBE, drift only). Idea 7a is a Plumbline feature that does not need Zetaris.

### Unspecified facts that affect us

1. **Which connection route the event instance offers.** Zetaris's own hackathon repo documents JDBC and REST only; MCP appears nowhere in it, and "MCP Toolkit" is listed as Enterprise-only. Spec section 6 and section 19 should lead with REST (and JDBC), MCP second.
2. **Whether participants are administrators on the shared instance.** Almost every registration, USL, DQ and grant command is administrator-only. Ideas 1 to 3 may be possible only on a local install.
3. **Two REST surfaces.** `/sql-editor/sqls/run` (local) versus `/query/sql/start` with `queryToken` paging, `pageLimit` 1 to 100 (SaaS spec). Both return strings.
4. **Trial terms.** "Free forever" Hobby versus "internal evaluation for up to 30 days" without an Order. Which governs the event instance and any account we create is not stated. The Zetaris Cloud terms page did not render.
5. **How our synthetic silos get into Zetaris.** Zetaris must reach the source; no document says how a local install reaches our own Postgres or object store, or whether the bundled postgres may host extra databases. A shared-instance route (team-registered sources) is not specified.
6. **Audit log read path** (idea 4) and **row/column policy SQL** (idea 2 optional layer): neither exists in the public command reference.
7. **Rate limits and per-query timeouts** for the event instance.
8. **Snapshot or as-of query syntax** for Iceberg-backed tables.
9. **Moving target.** The vendor's hackathon repo changed on 9 and 13 October (its own plans note "Live acceptance requires an available authorized instance"; no live query had been run when the user-journey plan was written). Its recipes mark several sources as failing. Re-read the repo and the KB when the instance details arrive; treat everything here as of 2026-10-13.

## 6. What could not be verified

- No Zetaris account or instance was used. Every behaviour above is documented text, not observed output.
- MCP: URL, auth, transport, tool names and read-only enforcement are not documented in any page reached. The Claude, Cursor, Codex and ChatGPT guides on the KB are screenshots with no text.
- The audit log's existence, schema and read path; the masking and row-filter SQL; AgentFlow, Natural Language to SQL and AI Data Steward interfaces.
- Rate limits, quotas, event-instance permissions, event-instance edition (Hobby, Professional or Enterprise).
- `github.com/zetaris/zetaris-public` (the Postman collection) returned 404.
- `cloud.enterprise.zetaris.com/terms`, the Azure Marketplace listing and the full runtimewire coverage were not readable.
- Marketing quotes in section 1 and the KB statements came through a summarising fetch tool; wording could differ slightly from the page. GitHub files and `docs.yaml` were read directly.
- Web search was unavailable (budget exhausted), so pages outside links from fetched pages were not discovered; the Data Day recording and the HackOS Zetaris folder are not public and were not read.
- The companion guide inside the vendor repo calls its own USL section "single-sourced" and partly untested; USL-dependent claims inherit that.
