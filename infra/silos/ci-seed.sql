-- Synthetic CI and pull-request silo for the Desk's Zetaris gate (Z-G1). All rows are invented.
DROP TABLE IF EXISTS pull_requests;
CREATE TABLE pull_requests (
  pr_id        INTEGER PRIMARY KEY,
  repo         TEXT NOT NULL,
  team         TEXT NOT NULL,
  head_sha     TEXT NOT NULL,
  merged_at    TIMESTAMP,
  checks_green BOOLEAN NOT NULL,
  reverted     BOOLEAN NOT NULL DEFAULT FALSE
);
INSERT INTO pull_requests VALUES
  (101, 'checkout-api', 'payments', 'a1b2c3d', '2026-10-06 09:12:00', TRUE,  FALSE),
  (102, 'checkout-api', 'payments', 'b2c3d4e', '2026-10-07 14:40:00', TRUE,  FALSE),
  (103, 'search',       'discovery', 'c3d4e5f', '2026-10-08 11:05:00', FALSE, FALSE),
  (104, 'search',       'discovery', 'd4e5f6a', '2026-10-09 16:30:00', TRUE,  TRUE),
  (105, 'mobile-app',   'growth',    'e5f6a7b', NULL,                  FALSE, FALSE),
  (106, 'mobile-app',   'growth',    'f6a7b8c', '2026-10-12 10:00:00', TRUE,  FALSE),
  (107, 'checkout-api', 'payments',  '0a1b2c3', '2026-10-13 13:20:00', TRUE,  FALSE);
