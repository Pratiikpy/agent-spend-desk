import type { Ledger } from "../ledger/db.ts";

/**
 * The delegation tree of a session (DF-094): which agent started which, what each cost on its own, and what it cost with everything it started.
 *
 * The edges come from the logs and nothing is guessed: a delegated agent writes its own log and carries an id, and the agent that started it
 * is the one whose log holds the result that names that id. An agent whose starter the logs do not name (its starter's log was not read, or the
 * client wrote no result) hangs under a synthetic `unlinked` node, so that the roll-up never drops a dollar. A workflow (a script that starts a batch of
 * agents) is a node of its own, started by whichever agent's log holds the result that launched it, with its agents below it. The cumulative cost of the root is
 * always the cost of every call of the session, which the tests hold to.
 */
export const MAX_DEPTH = 5;

export type DelegationFlag = "deep_delegation_risk" | "delegation_loop" | "unlinked_delegation";

export interface DelegationNode {
  sessionId: string;
  /** "main" for the thread the person talked to, the agent id for a delegated agent, `wf:<run>` for a workflow run, "unlinked" for the synthetic node. */
  key: string;
  /** The owner's own label for a workflow script, when the log names one. */
  name: string | null;
  parentKey: string | null;
  depth: number;
  calls: number;
  unpricedCalls: number;
  directMicros: number;
  /** This node's own cost plus that of every agent below it. */
  cumulativeMicros: number;
  children: number;
  flags: DelegationFlag[];
}

export interface DelegationTree {
  sessionId: string;
  /** Root first, then every other node in the order a reader would walk the tree: each node followed by what it started, the costliest first. */
  nodes: DelegationNode[];
  totalMicros: number;
  maxDepth: number;
  agents: number;
  unlinkedMicros: number;
}

export interface WorkflowRow {
  session_id: string;
  run_id: string;
  parent_source_id: number | null;
  name: string | null;
}

export interface SourceRow {
  session_id: string;
  source_id: number | null;
  agent_id: string | null;
  workflow_run?: string | null;
  calls: number;
  unpriced: number;
  micros: number | null;
  sidechain: number;
}

export interface EdgeRow {
  session_id: string;
  child_agent_id: string;
  parent_source_id: number | null;
}

/** The trees of the sessions named, or of every session with a delegated call between two times. */
export function delegationTrees(db: Ledger, o: { sessionIds?: readonly string[]; sinceIso?: string; untilIso?: string; onlyDelegating?: boolean }): DelegationTree[] {
  let ids: string[];
  if (o.sessionIds) ids = [...o.sessionIds];
  else {
    ids = (
      db
        .prepare("SELECT DISTINCT session_id FROM model_call WHERE ts >= ? AND ts <= ? AND is_sidechain = 1")
        .all(o.sinceIso ?? "0000", o.untilIso ?? "9999") as unknown as { session_id: string }[]
    ).map((r) => r.session_id);
  }
  const out: DelegationTree[] = [];
  const bySession = db.prepare(
    `SELECT m.session_id, m.source_id, s.agent_id, s.workflow_run, COUNT(*) calls, SUM(CASE WHEN c.class = 'estimated' THEN 0 ELSE 1 END) unpriced,
            SUM(CASE WHEN c.class = 'estimated' THEN c.total_micros ELSE 0 END) micros, SUM(m.is_sidechain) sidechain
     FROM model_call m LEFT JOIN cost_event c ON c.call_id = m.call_id LEFT JOIN ingest_source s ON s.id = m.source_id
     WHERE m.session_id = ? GROUP BY m.session_id, m.source_id`,
  );
  const edgesOf = db.prepare("SELECT session_id, child_agent_id, parent_source_id FROM delegation_edge WHERE session_id = ?");
  const runsOf = db.prepare("SELECT session_id, run_id, parent_source_id, name FROM workflow_run WHERE session_id = ?");
  for (const id of ids) {
    const sources = bySession.all(id) as unknown as SourceRow[];
    if (sources.length === 0) continue;
    const tree = buildTree(id, sources, edgesOf.all(id) as unknown as EdgeRow[], runsOf.all(id) as unknown as WorkflowRow[]);
    if (o.onlyDelegating && tree.agents === 0) continue;
    out.push(tree);
  }
  return out;
}

interface Acc {
  calls: number;
  unpriced: number;
  micros: number;
}

/** Pure: build one session's tree from its per-log cost and its edges. Exported so that the rules can be tested without a ledger. */
export function buildTree(sessionId: string, sources: readonly SourceRow[], edges: readonly EdgeRow[], workflows: readonly WorkflowRow[] = []): DelegationTree {
  // Every log of the session that is not a delegated agent's is the person's own thread, whether one file or the chain of files a resumed session leaves.
  const keyOfSource = new Map<number | null, string>();
  const acc = new Map<string, Acc>();
  for (const r of sources) {
    const key = r.agent_id !== null ? r.agent_id : r.sidechain > 0 ? "unlinked" : "main";
    keyOfSource.set(r.source_id, key);
    const a = acc.get(key) ?? { calls: 0, unpriced: 0, micros: 0 };
    a.calls += r.calls;
    a.unpriced += r.unpriced;
    a.micros += r.micros ?? 0;
    acc.set(key, a);
  }
  // A workflow run is a node of its own, with no calls: it costs what its agents cost.
  const runName = new Map<string, string | null>();
  const runOf = new Map<string, string>();
  for (const w of workflows) runName.set(`wf:${w.run_id}`, w.name);
  for (const r of sources) if (r.agent_id !== null && r.workflow_run) runOf.set(r.agent_id, `wf:${r.workflow_run}`);
  for (const run of new Set(runOf.values())) if (!acc.has(run)) acc.set(run, { calls: 0, unpriced: 0, micros: 0 });
  for (const w of workflows) if (!acc.has(`wf:${w.run_id}`) && [...runOf.values()].includes(`wf:${w.run_id}`)) acc.set(`wf:${w.run_id}`, { calls: 0, unpriced: 0, micros: 0 });
  // An agent's parent: the node of the log the naming result sits in; failing that, the workflow run its log sits in. An agent with neither, or whose
  // starter's log is not one of this session's, is unlinked, and so is a workflow run no log names the starter of.
  const parentOf = new Map<string, string | null>();
  const edgeOf = new Map(edges.map((e) => [e.child_agent_id, e]));
  const runRow = new Map(workflows.map((w) => [`wf:${w.run_id}`, w]));
  const nodeOfSource = (sourceId: number | null | undefined): string | undefined => (sourceId === undefined ? undefined : keyOfSource.get(sourceId));
  for (const key of acc.keys()) {
    if (key === "main") parentOf.set(key, null);
    else if (key === "unlinked") parentOf.set(key, "main");
    else if (key.startsWith("wf:")) {
      const p = nodeOfSource(runRow.get(key)?.parent_source_id);
      parentOf.set(key, p !== undefined && p !== key ? p : "unlinked");
    } else {
      const e = edgeOf.get(key);
      const p = e ? nodeOfSource(e.parent_source_id) : undefined;
      const inRun = runOf.get(key);
      parentOf.set(key, p !== undefined && p !== key ? p : inRun !== undefined ? inRun : "unlinked");
    }
  }
  if (!acc.has("main")) {
    acc.set("main", { calls: 0, unpriced: 0, micros: 0 });
    parentOf.set("main", null);
  }
  if (!acc.has("unlinked") && [...parentOf.values()].includes("unlinked")) {
    acc.set("unlinked", { calls: 0, unpriced: 0, micros: 0 });
    parentOf.set("unlinked", "main");
  }

  // A loop is a walk up from a node that meets a node twice: the loop is cut where it is found and its members are flagged.
  const flags = new Map<string, Set<DelegationFlag>>();
  const flag = (k: string, f: DelegationFlag): void => {
    const s = flags.get(k) ?? new Set<DelegationFlag>();
    s.add(f);
    flags.set(k, s);
  };
  for (const key of acc.keys()) {
    const seen: string[] = [];
    let cur: string | null = key;
    while (cur !== null && !seen.includes(cur)) {
      seen.push(cur);
      cur = parentOf.get(cur) ?? null;
    }
    if (cur !== null) {
      const cycle = seen.slice(seen.indexOf(cur));
      for (const k of cycle) flag(k, "delegation_loop");
      parentOf.set(cycle[cycle.length - 1] as string, "main");
    }
  }
  const depth = new Map<string, number>();
  const depthOf = (k: string): number => {
    const known = depth.get(k);
    if (known !== undefined) return known;
    const p = parentOf.get(k);
    const d = p === null || p === undefined ? 0 : depthOf(p) + 1;
    depth.set(k, d);
    return d;
  };
  for (const k of acc.keys()) {
    if (depthOf(k) > MAX_DEPTH) flag(k, "deep_delegation_risk");
    if (k === "unlinked") flag(k, "unlinked_delegation");
  }

  const children = new Map<string, string[]>();
  for (const [k, p] of parentOf) if (p !== null) children.set(p, [...(children.get(p) ?? []), k]);
  const cumulative = new Map<string, number>();
  const cum = (k: string): number => {
    const known = cumulative.get(k);
    if (known !== undefined) return known;
    const total = (acc.get(k)?.micros ?? 0) + (children.get(k) ?? []).reduce((s, c) => s + cum(c), 0);
    cumulative.set(k, total);
    return total;
  };
  for (const k of acc.keys()) cum(k);

  const nodes: DelegationNode[] = [];
  const walk = (k: string): void => {
    const a = acc.get(k) as Acc;
    nodes.push({ sessionId, key: k, name: runName.get(k) ?? null, parentKey: parentOf.get(k) ?? null, depth: depthOf(k), calls: a.calls, unpricedCalls: a.unpriced, directMicros: a.micros, cumulativeMicros: cum(k), children: (children.get(k) ?? []).length, flags: [...(flags.get(k) ?? [])].sort() });
    for (const c of [...(children.get(k) ?? [])].sort((x, y) => cum(y) - cum(x) || x.localeCompare(y))) walk(c);
  };
  walk("main");
  const agents = [...acc.keys()].filter((k) => k !== "main" && k !== "unlinked" && !k.startsWith("wf:")).length;
  return {
    sessionId,
    nodes,
    totalMicros: cum("main"),
    maxDepth: Math.max(...nodes.map((n) => n.depth)),
    agents,
    unlinkedMicros: acc.has("unlinked") ? cum("unlinked") : 0,
  };
}
