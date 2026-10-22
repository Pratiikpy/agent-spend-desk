# Profile: apache/incubator-devlake (now apache/devlake)

Reader: Claude Sonnet, 2026-10-20. Remote reads through `gh api` and raw.githubusercontent.com, no clone. Paths relative to `backend/` unless noted. Licence read first: Apache-2.0 (`LICENSE` at the repository root, header at lines 1 to 16 of every Go file). Stars 3,173; last commit (pushed_at) 2026-10-19; default branch `main` (`gh api repos/apache/devlake`, read 2026-10-20). The path `apache/incubator-devlake` redirects to `apache/devlake`.

## 1. What it is
An engineering-metrics lake. Plugins pull raw data from GitHub, Jira, Jenkins and others, and convert it into one platform-independent "domain layer" so a single SQL metric (DORA, cycle time) works across sources. Apache-2.0.

## 2. Architecture map
Three layers: raw, tool (per-plugin tables such as `_tool_github_scope_configs`, `plugins/github/models/scope_config.go:61`) and domain. The domain layer is split into `code`, `ticket`, `devops`, `crossdomain`, `codequality`, `qa` (`core/models/domainlayer/`). Metric plugins (`plugins/dora`, `plugins/refdiff`) read only domain tables and write derived tables. Grafana dashboards hold the final SQL (`grafana/dashboards/postgresql/DORA.json`, "Metric 3: change failure rate").

## 3. Features and how each behaves
Per-PR timings: coding time, pickup time, review time, deploy time and cycle time (`core/models/domainlayer/crossdomain/project_pr_metric.go:26-42`). Deployments are rebuilt from pipelines, failed ones included (`plugins/dora/tasks/deployment_commits_generator.go:65-67`). Incidents are linked to deployments. Derived tables are deleted and rebuilt on every run (`plugins/dora/tasks/change_lead_time_calculator.go:50`).

## 4. How people use it
Docker compose, config-ui, a blueprint per project, Grafana. Tests are e2e CSV fixtures (`plugins/dora/e2e/change_lead_time/project_pr_metrics.csv`). Usage evidence beyond the repository: NOT VERIFIED.

## 5. Mechanism for the Desk
**Identity.** Every entity id is `<Plugin>:<Entity>:<PK0>:<PK1>`, deterministic, so any table can be truncated and rebuilt to identical output (`core/models/domainlayer/README.md:43-53`). Copy this: a spend row and an outcome row must have ids that rebuild from the source, never autoincrement.

**The outcome chain.** commit, `pull_request_commits`, `pull_requests` (status OPEN/CLOSED/MERGED, `MergedDate`, `MergeCommitSha`, `code/pull_request.go:28-59`), `cicd_deployment_commits` keyed by commit sha with `Result`, `Environment` and `PrevSuccessDeploymentCommitId` (`devops/cicd_deployment_commit.go:24-47`). A PR reaches production when its `MergeCommitSha` equals a deployment commit (`change_lead_time_calculator.go:142-151`). "Landed" is therefore three separate facts with three timestamps: merged, deployed, and (for incidents) not followed by failure.

**Work to ticket.** `issue_commits` and `pull_request_issues` are join tables only (`crossdomain/issue_commit.go:24-28`). The PR-to-issue link comes from a user-configured regex on the PR body, `PrBodyClosePattern`; no match means no link, silently (`plugins/github/tasks/pr_issue_enricher.go:105-111`, `plugins/github/models/scope_config.go:32`).

**Failure after landing.** An incident is attached to the last successful production deployment finished before the incident's creation (`plugins/dora/tasks/incident_deploy_connector.go:107-116`). That is a time heuristic, not causation, and the Desk should store it as `suspected_cause`, not as fact.

**Negative spans are dropped.** `computeTimeSpan` returns nil for end before start and rounds minutes up (`change_lead_time_calculator.go:183-193`). A missing step leaves that field null while the cycle time sums what exists (lines 153-164), so a PR with no deploy reads as faster, not unknown. Avoid.

**Filters are explicit.** A head-ref regex excludes PRs from the metric and logs how many (`change_lead_time_calculator.go:109-112,177-179`). Copy: every exclusion counted and shown.

## 6. Agent patterns
None. It is a batch pipeline of deterministic subtasks with declared dependency tables (`pr_issue_enricher.go:42-45`).

## 7. Model and data layer
SQL (MySQL or Postgres) through a DAL. Adding a source means a plugin that maps to the domain layer; no model calls.

## 8. Hackathon-care checks
Heavy: Docker, a database and Grafana, so not a one-command offline demo. Logs per subtask. Secrets are encrypted in blueprints (migration `20220903_encrypt_blueprint.go`, name only). Not suitable to vendor; suitable to mimic.

## 9. Traps seen
Silent no-link when the regex misses. Null spans that flatter cycle time. A "closed PR" status maps to incident status OTHER, not failure (`code/pull_request.go:72-83`): closed-unmerged work is not counted as waste anywhere, which is the exact thing the Desk must count. No agent concept, no cost concept, no revert concept in the domain tables (NOT VERIFIED beyond the listing of `domainlayer/`, which has no revert entity).

## 10. Reuse
Apache-2.0: schema ideas and the id convention may be reused with credit and NOTICE. We rebuild in TypeScript.

## 11. Verdict: ADAPT (data model and rebuild-from-source discipline, not the code)
Copy: (1) deterministic ids and idempotent rebuild of every derived table; (2) landed as a chain of separately timestamped facts (merged, deployed, followed by an incident); (3) every exclusion counted and printed.
Avoid: (1) silent failure to link; (2) null spans that shrink totals; (3) a domain with no row for closed-unmerged work.
Where we are ahead: each spend line carries a link status (`linked`, `unlinked`, `unknowable`) and the report prints the unknowable share beside the dollar total.
