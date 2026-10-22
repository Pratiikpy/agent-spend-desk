/**
 * The statements the Desk sends to Zetaris. Table names are the three registered silos (spec 13.1): the invoice
 * file in the S3-style bucket, the CI and pull-request Postgres database, and the roster REST endpoint. They are
 * constants, so a cassette key is stable and nothing a user types is ever put into SQL.
 */
export const Q_INVOICES = "SELECT invoice_id, workspace, day, model, quantity, amount_usd FROM desk_invoices.lines_sample ORDER BY day, workspace, model";

export const Q_PULL_REQUESTS = "SELECT pr_id, repo, team, head_sha, merged_at, checks_green, reverted FROM ci_silo.pull_requests ORDER BY pr_id";

export const Q_ROSTER = "SELECT team, lead, seats, seat_plan, seat_price_usd FROM desk_roster.roster ORDER BY team";

/**
 * The headline: spend per landed pull request by team, one statement over all three silos. Each silo is
 * aggregated in its own subquery first, because joining the invoice lines straight to the pull requests would
 * repeat every invoice amount once per pull request (found by running it: the first version overstated billed
 * spend three-fold).
 */
export const Q_HEADLINE =
  "SELECT r.team, r.seats, r.seat_plan, p.landed_prs, b.billed_usd, b.billed_usd / p.landed_prs AS usd_per_landed_pr " +
  "FROM desk_roster.roster r " +
  "JOIN (SELECT team, COUNT(*) AS landed_prs FROM ci_silo.pull_requests WHERE merged_at IS NOT NULL AND checks_green AND NOT reverted GROUP BY team) p ON p.team = r.team " +
  "LEFT JOIN (SELECT workspace, SUM(CAST(amount_usd AS DOUBLE)) AS billed_usd FROM desk_invoices.lines_sample GROUP BY workspace) b ON b.workspace = r.team " +
  "ORDER BY r.team";

export const ALL_QUERIES = [Q_INVOICES, Q_PULL_REQUESTS, Q_ROSTER, Q_HEADLINE] as const;
