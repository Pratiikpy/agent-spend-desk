import type { StatuslineSample } from "../statusline/statusline.ts";
import type { Ledger } from "./db.ts";

export interface StatuslineIngestReport {
  samples: number;
  /** New readings stored; reading the same log again stores none. */
  limitSamples: number;
}

/**
 * Store the plan-limit readings Claude Code's status line gave, as the Claude Code plan's windows. They go in the same
 * table as Codex's readings, so one fit reads both. The 5-hour window is `primary` and the weekly window `secondary`.
 */
export function ingestStatusline(db: Ledger, samples: readonly StatuslineSample[]): StatuslineIngestReport {
  const put = db.prepare(
    `INSERT OR IGNORE INTO limit_sample (tool, session_id, ts, kind, window_minutes, used_percent, resets_at, plan_type, limit_id) VALUES ('claude_code', ?, ?, ?, ?, ?, ?, NULL, 'claude')`,
  );
  let stored = 0;
  db.exec("BEGIN");
  try {
    for (const s of samples) {
      const session = s.sessionId ?? "statusline";
      for (const [kind, minutes, r] of [["primary", 300, s.fiveHour], ["secondary", 10_080, s.sevenDay]] as const) {
        if (r) stored += Number(put.run(session, s.ts, kind, minutes, r.pct, r.resetsAt).changes);
      }
    }
    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }
  return { samples: samples.length, limitSamples: stored };
}
