import type { Ledger } from "../ledger/db.ts";
import { delegationTrees, MAX_DEPTH, type DelegationFlag, type DelegationNode, type DelegationTree } from "./tree.ts";

const usd = (micros: number): string => `$${(micros / 1_000_000).toFixed(2)}`;
const folder = (p: string | null): string => (p === null ? "unknown folder" : (p.replace(/[\\/]+$/, "").split(/[\\/]/).pop() ?? p));

const FLAG_TEXT: Record<DelegationFlag, string> = {
  deep_delegation_risk: `deeper than ${MAX_DEPTH} levels`,
  delegation_loop: "a loop in the logs",
  unlinked_delegation: "no log names who started these",
};

const NODE_LIMIT = 40;

function label(n: DelegationNode): string {
  const name =
    n.key === "main"
      ? "the main thread"
      : n.key === "unlinked"
        ? "agents no log names the starter of"
        : n.key.startsWith("wf:")
          ? `workflow ${n.name ?? n.key.slice(3, 11)} (${n.key.slice(3, 11)})`
          : `agent ${n.key.slice(0, 8)}`;
  return `${"  ".repeat(n.depth)}${name}`;
}

function renderTree(t: DelegationTree, project: string): string {
  const out = [`Session ${t.sessionId.slice(0, 8)} in ${project}: ${usd(t.totalMicros)} across ${t.agents} delegated agent${t.agents === 1 ? "" : "s"}, ${t.maxDepth} level${t.maxDepth === 1 ? "" : "s"} deep.`];
  out.push(`${"".padEnd(52)}${"alone".padStart(10)}${"with agents".padStart(13)}${"calls".padStart(9)}`);
  const shown = t.nodes.slice(0, NODE_LIMIT);
  for (const n of shown) out.push(`${label(n).padEnd(52)}${usd(n.directMicros).padStart(10)}${usd(n.cumulativeMicros).padStart(13)}${String(n.calls).padStart(9)}${n.flags.length > 0 ? `   ${n.flags.map((f) => FLAG_TEXT[f]).join("; ")}` : ""}`);
  const rest = t.nodes.slice(NODE_LIMIT);
  if (rest.length > 0) out.push(`and ${rest.length} more nodes costing ${usd(rest.reduce((s, n) => s + n.directMicros, 0))} on their own, counted in the totals above.`);
  if (t.unlinkedMicros > 0) out.push(`${usd(t.unlinkedMicros)} sits under agents no log names the starter of; the cost is counted, the edge is unknown.`);
  const unpriced = t.nodes.reduce((s, n) => s + n.unpricedCalls, 0);
  if (unpriced > 0) out.push(`${unpriced} call${unpriced === 1 ? "" : "s"} on a model with no price are counted and not priced.`);
  return out.join("\n");
}

/**
 * `desk delegation`: the sessions whose agents started other agents, costliest first, or one session's whole tree. An edge is read from the
 * result that named a delegated agent, in the log of the agent that started it; a cost is a list-price estimate from the logged tokens.
 */
export function delegationCommand(db: Ledger, o: { session?: string; sinceIso: string; untilIso: string; limit?: number }): { ok: boolean; text: string; trees: DelegationTree[] } {
  const folderOf = db.prepare("SELECT project_path FROM session WHERE session_id = ?");
  const project = (id: string): string => folder((folderOf.get(id) as { project_path: string | null } | undefined)?.project_path ?? null);
  if (o.session !== undefined) {
    const found = (db.prepare("SELECT DISTINCT session_id FROM model_call WHERE session_id LIKE ? ESCAPE '\\' LIMIT 3").all(`${o.session.replace(/[\\%_]/g, "\\$&")}%`) as unknown as { session_id: string }[]).map((r) => r.session_id);
    if (found.length === 0) return { ok: false, text: `No session starts with "${o.session}" in this ledger. desk sessions lists them.`, trees: [] };
    if (found.length > 1) return { ok: false, text: `"${o.session}" starts more than one session (${found.map((f) => f.slice(0, 12)).join(", ")}). Give more of the id.`, trees: [] };
    const trees = delegationTrees(db, { sessionIds: found });
    const t = trees[0] as DelegationTree;
    if (t.agents === 0) return { ok: true, text: `Session ${t.sessionId.slice(0, 8)} in ${project(t.sessionId)} started no delegated agent: ${usd(t.totalMicros)}, all of it the main thread.`, trees };
    return { ok: true, text: renderTree(t, project(t.sessionId)), trees };
  }
  const all = delegationTrees(db, { sinceIso: o.sinceIso, untilIso: o.untilIso, onlyDelegating: true }).sort((a, b) => b.totalMicros - a.totalMicros);
  if (all.length === 0) return { ok: true, text: `No session between ${o.sinceIso.slice(0, 10)} and ${o.untilIso.slice(0, 10)} started a delegated agent.`, trees: [] };
  const limit = o.limit ?? 10;
  const out = [`Sessions that started delegated agents, ${o.sinceIso.slice(0, 10)} to ${o.untilIso.slice(0, 10)}: ${all.length}. Costliest ${Math.min(limit, all.length)}:`];
  out.push(`${"session".padEnd(10)}${"project".padEnd(18)}${"total".padStart(11)}${"agents".padStart(8)}${"levels".padStart(8)}  flags`);
  for (const t of all.slice(0, limit)) {
    const flags = [...new Set(t.nodes.flatMap((n) => n.flags))].map((f) => FLAG_TEXT[f]);
    out.push(`${t.sessionId.slice(0, 8).padEnd(10)}${project(t.sessionId).slice(0, 16).padEnd(18)}${usd(t.totalMicros).padStart(11)}${String(t.agents).padStart(8)}${String(t.maxDepth).padStart(8)}  ${flags.join("; ")}`);
  }
  const deep = all.filter((t) => t.nodes.some((n) => n.flags.includes("deep_delegation_risk"))).length;
  const loops = all.filter((t) => t.nodes.some((n) => n.flags.includes("delegation_loop"))).length;
  if (deep > 0 || loops > 0) out.push(`${deep} session${deep === 1 ? "" : "s"} went deeper than ${MAX_DEPTH} levels; ${loops} had a loop in the logs.`);
  out.push("desk delegation --session <id> shows one tree. An agent whose starter no log names hangs under an unlinked node: its cost is counted and its edge is unknown.");
  return { ok: true, text: out.join("\n"), trees: all };
}
