# Zetaris local install: steps and facts

Source: the "Run locally" page of Zetaris Cloud Gateway (cloud.enterprise.zetaris.com), read 2026-10-16 after signing in with the hackathon account. Status: install run on 2026-10-16 inside WSL (Ubuntu 22.04) with Docker; registry login, preflight and `verify.sh` all passed (9 of 9 checks, including a query through the UI, API, driver and Spark). The API key was created by Prateek in the web UI and saved in `.env` as `ZETARIS_API_KEY` (with `ZETARIS_REST_URL`, `ZETARIS_ORG_ID` and `ZETARIS_BASE_URL`, the names used by the organizers' Setup Guide). First REST calls run 2026-10-16 (see the verified REST facts below).

## Where the secrets are

The registry host, user and password are in the repository `.env` (gitignored) as `ZETARIS_REGISTRY`, `ZETARIS_REGISTRY_USER` and `ZETARIS_REGISTRY_PASSWORD`. They are never copied into any other file. The zip was downloaded to the Downloads area; move it to the home folder before unpacking (the page says so).

Registry login, once per machine (reads the password from `.env`; run in Bash or WSL):

```
set -a; . ./.env; set +a
echo "$ZETARIS_REGISTRY_PASSWORD" | docker login "$ZETARIS_REGISTRY" -u "$ZETARIS_REGISTRY_USER" --password-stdin
```

## Machine requirements (from the page)

- Docker Desktop, opened once after install; 8 GB memory and 4 CPUs given to Docker (Settings, Resources); on Apple Silicon also Rosetta.
- 15 GB free disk; 15 to 30 minutes, mostly downloading (about 4 GB of images, 10 GB once pulled).
- On Windows, run the scripts inside WSL.

## Steps

1. Registry login (above).
2. Unpack and check: `[ -d zetaris-platform ] || unzip -q zetaris-platform.zip && cd zetaris-platform && ./preflight.sh` (every check should say PASS).
3. `docker compose pull` (10 to 20 minutes).
4. `docker compose up -d` (2 to 10 minutes; setup continues a few minutes after it returns). Healthy output lists postgres, driver and api as Healthy; init exits; ui and bootstrap Started.
5. `./verify.sh` (all PASS means done; if some fail wait a minute and rerun).
6. Sign in at http://localhost:3000 with the default account shown on the page and change the password from the user menu at once. Create the API key in the web UI by hand (Setup Guide: not by an agent).
7. Connect from Cursor with the folder `zetaris-platform` open. JDBC details from the page: driver jar `jdbc/ndp-jdbc-driver-2.4.3.1-7eff043-driver.jar`, class `com.zetaris.lightning.jdbc.LightningDriver`, URL `jdbc:zetaris:lightning@localhost:10000`, use the jar directly (for example JayDeBeApi), not a Hive or Spark driver, do not start Spark, one Lightning SQL statement per call, verify with `SELECT 1`. Needs Java 8 or later.

## Stop and start

- Stop, keep data: `docker compose down`; start: `docker compose up -d`.
- Delete data and the encryption keypair: `docker compose down -v` (warning). Also remove images: `docker compose down -v --rmi all`.

## Ports (Setup Guide, earlier readout)

UI 3000, REST 8888 (`/api/v1.0`), JDBC 10000.

## Open

- Done 2026-10-16: images pulled, stack started, `verify.sh` 9 of 9 PASS. Docker had about 11 GB memory and 12 CPUs; disk on the system drive fell from 17.5 GB to about 12 GB free after the pull.
- Registry login from a script must read the credentials from `.env` at run time and run inside WSL as a file, not as an inline command (an inline command expands the variables in the wrong shell and the login fails with 'username is empty').
- Open: the Meterless key and route; the default admin password was deliberately not changed (local install only, port 3000 must not be exposed to the network). NVIDIA key is done and tested.

## Verified REST facts (run 2026-10-16 against the local install, bearer API key, organisation id 1)

- `POST /api/v1.0/sql-editor/sqls/run` with headers `Authorization: Bearer <key>`, `X-Org-ID: 1`, a fresh UUID in `X-Request-ID`, and a JSON body of exactly `{"queryId": <uuid>, "sql": ..., "source": "SqlEditor", "limit": n}` (the shape in the organizers' smoke test). `SELECT 1` returned HTTP 200 with `{"headers":["1"],"data":[["1"]],"total":1,"timeUsed":808}`; values come back as strings. A body without `queryId` and `source` is rejected with HTTP 400 naming the missing fields.
- `SHOW TABLES` and `SHOW SCHEMAS` without a target are refused (HTTP 400, "SHOW NAMESPACES / SHOW TABLES are disabled"); `SHOW TABLES IN <datasource>` works. The sample sources are `TPCDS_DB` (retail benchmark tables) and `NY_TAXI` (15 tables including customers, drivers, trips and trip_payments).
- `SHOW DATASOURCES` returned an empty list and `GET /datasource/datasources` returned `[]` even though the UI shows two registered sources: the sample data lives in the Lightning databases reached through `SHOW TABLES IN`. NOT VERIFIED why; query the sources by name.
- The API reference page at `/redoc/index.html` answered HTTP 401 ("Authorization header missing") to a plain bearer request; how to open it was not found (the UI may hold a session cookie). NOT VERIFIED.
- Not yet tested: a query that joins two sources, row limits above 5, error behaviour on a bad statement beyond the two cases above, registering our own synthetic silos, JDBC, the Unified Semantic Layer.

## Correction and new verified fact (2026-10-17)

The empty results for `SHOW DATASOURCES` and `GET /datasource/datasources` are explained: the organizers' discovery command is `SHOW LIGHTNING DATABASES` (setup guide, `docs/event/06-...`, step 1.9). Run over the REST route after the stack restarted, it returned HTTP 200 with two rows, `NY_TAXI` (id 6, "NY Taxi sample data") and `TPCDS_DB` (id 307, "TPC-DS benchmark sample data"); `SELECT 1` again returned 200. So the earlier "NOT VERIFIED as to cause" is closed for these two endpoints. Not yet run: the organizers' Pikachu recipe and the registration of our own synthetic silos (files on the laptop are invisible to Zetaris; use a local REST service or an S3-style bucket).

## Verified 2026-10-22: our own sources and a cross-source join (gate Z-G1, partly)

The local stack lives in WSL (Ubuntu-22.04) and stops with the distro, so a long-running WSL process is needed to keep it up; Windows reaches it at `localhost:3000` (UI) and `localhost:8888` (REST). Run with the helper `python scripts/zetaris.py "<one statement, no trailing semicolon>"`.

| Check | Result |
|---|---|
| Live query | `SHOW LIGHTNING DATABASES` returns `NY_TAXI` and `TPCDS_DB` over the REST route |
| Dialect of this build | The open-source `REGISTER OR REPLACE JDBC DATASOURCE ... NAMESPACE lightning.datasource...` statement is not accepted (parse error). The commands reference in `zetaris/getting-started` (`docs/guides/zetaris-lightning-sql-commands.md`) applies: `CREATE DATASOURCE <name> DESCRIBE BY "..." OPTIONS (jdbcdriver "...", jdbcurl "...", username "...", password "...")` then `REGISTER DATASOURCE TABLES FROM <name>` |
| Our own JDBC source | A synthetic Postgres (`infra/silos/start-ci-silo.sh`, container `desk-silo-ci` on the `zetaris_default` Docker network) registered as `ci_silo`; queried as `ci_silo.pull_requests`; an aggregate returned the expected counts |
| Our own REST source | A static JSON endpoint (`infra/silos/start-roster-silo.sh`, container `desk-silo-roster`) registered with `CREATE LIGHTNING DATABASE desk_roster` and `CREATE LIGHTNING REST TABLE roster FROM desk_roster REQUEST (endpoint ..., method "GET", http_encoding "URLENCODED", response_type "JSON", insecure_ssl "false") HEADER () BODY ()`; queried as `desk_roster.roster` |
| Cross-source join | `ci_silo.pull_requests` joined to `desk_roster.roster` on `team` in one statement: correct grouped result (3 rows) and a 7-row detail result |
| Row limit | The REST body's `limit` parameter was 100; 7 rows came back, so results above 5 rows work |
| Still open | A third source of file type (invoices as CSV or Parquet in object storage), the Unified Semantic Layer, JDBC access from DBeaver, and what a judge without Docker sees (the fallback path) |

Containers need the Zetaris containers' network name (`zetaris_default`) so that the Zetaris driver can reach them by container name; a source on the Windows host or a laptop file path is not reachable (documented by Zetaris).
