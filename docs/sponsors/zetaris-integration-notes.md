# Zetaris: Integration Notes

**Status: REQUIRED in every submission. Facts about the product: NOT VERIFIED.** Nothing below about how Zetaris works comes from a verified source. Fill the "Verified facts" table only from the HackOS Zetaris folder, the Data Day recording (12 Oct 2026, 22:00 UTC) or Help Zetaris answers, and cite where each fact came from.

Organizer framing: "Zetaris: serving internal data." Context: `docs/intel/03-sponsor-by-sponsor-expectations.md`.

## Verified facts

| Fact | Value | Source (file, timestamp or message link) | Date verified |
|---|---|---|---|
| What Zetaris is | Zetaris Cloud and its "AI Data Harness" / "Open Agentic Lakehouse": governed, real-time access for agents to enterprise data **where it lives, without copying it**; federated SQL across sources (the site names Oracle, Snowflake, S3, Salesforce) with column- and row-level security. Launched 2026-10-06. | zetaris.com (search results 2026-10-13), kbase.zetaris.com index (fetched), runtimewire.com summary (no technical detail) | 2026-10-13 |
| How we get access | 30-day free trial of the Open Agentic Lakehouse advertised at zetaris.com/get-started. Sign-up steps and whether hackathon credentials are issued via HackOS: NOT VERIFIED. **Needs Prateek.** | zetaris.com/get-started (fetched) | 2026-10-13 |
| Auth model and credential name(s) | NOT VERIFIED. | | |
| Query / API surface we will use | The site lists three client paths: **MCP servers** (Claude, Cursor, ChatGPT), a **REST endpoint**, and **JDBC/ODBC / SQL editor**. Exact MCP URL, tool names, auth and SQL dialect NOT VERIFIED (knowledge-base pages "Connecting to Zetaris" and the Claude connection guide are index pages in what we fetched). | zetaris.com/get-started; kbase.zetaris.com/knowledge/connecting-to-zetaris (to fetch) | 2026-10-13 |
| MCP server behaviour (stated on the vendor page) | "The Zetaris MCP server is read-only. Agents can query, explore, and reason about your data - they cannot insert, update, or delete anything." Exposes "Natural Language to SQL" and AgentFlow workflows; every query "runs under the authenticated user's identity and permissions"; row- and column-level security "apply automatically"; every tool call is written to a structured audit log (who, what, which sources, row count). Engines named: Spark, Trino, Presto, DuckDB. Connectors named: Snowflake, Databricks, BigQuery, Redshift, S3, Oracle, SQL Server, PostgreSQL, MySQL, SAP, Salesforce, REST APIs. Granular tool names, URL, token format: NOT VERIFIED. | zetaris.com/zetaris-meta-data-lakehouse (fetched 2026-10-13, vendor marketing page) | 2026-10-13 |
| KB connection pages | `kbase.zetaris.com/knowledge/connecting-to-zetaris` lists "Access via JDBC / ODBC / REST API" article titles only; the article bodies (endpoints, auth) were not in what we could fetch. | kbase.zetaris.com (fetched) | 2026-10-13 |
| Rate limits, quotas, cost | NOT VERIFIED. | | |
| Sample data or sandbox provided | NOT VERIFIED; to confirm in HackOS folder or Data Day recording. | | |
| Failure modes observed | none yet (nothing has been run) | | |

## Our role for Zetaris in the build

Decide on 22 Oct after reading the folder. The role must be real, since "Zetaris has no real role in the build" is a listed red flag.

- Which agent calls it:
- What decision or output changes because of it:
- What the fallback is when Zetaris is unreachable (must exist, tested under `SAMPLE_MODE`):
- What is unique about our use (this goes in the sponsor explanation):

## Day-one connection test

- [ ] Test file: `tests/zetaris-connection.test.ts`
- [ ] Passes live
- [ ] Fails gracefully with a clear logged error when credentials are absent
- [ ] Fallback path exercised

## Evidence for the demo and submission

- [ ] Screenshot or trace line showing Zetaris returning data inside an agent run
- [ ] Demo segment timestamped for "how Zetaris is integrated"
