import type { Ledger } from "../ledger/db.ts";
import { refreshTasks } from "../tasks/assign.ts";
import { defaultMarkerPath } from "../tasks/markers.ts";
import { estimateTask, estimateToJson, pastTasks } from "./estimate.ts";

/** The estimate as a function of the arguments an agent sends, reading the usage ledger it was given. Tasks are assigned afresh on each call, so a session that just ended counts. */
export function estimateFromLedger(db: Ledger, now: () => number = Date.now, markerPath: string = defaultMarkerPath()): (args: Record<string, unknown>) => unknown {
  return (args) => {
    refreshTasks(db, { useLabels: true, markerPath });
    const type = typeof args["type"] === "string" && args["type"].trim() !== "" ? (args["type"] as string) : undefined;
    const repo = typeof args["repo"] === "string" && args["repo"].trim() !== "" ? (args["repo"] as string) : undefined;
    const cap = typeof args["cap_usd"] === "number" && Number.isFinite(args["cap_usd"]) && args["cap_usd"] >= 0 ? Math.round((args["cap_usd"] as number) * 1_000_000) : undefined;
    return estimateToJson(estimateTask(pastTasks(db), { ...(type !== undefined ? { type } : {}), ...(repo !== undefined ? { repo } : {}), ...(cap !== undefined ? { capMicros: cap } : {}), nowMs: now() }));
  };
}
