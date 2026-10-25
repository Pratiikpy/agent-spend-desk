import type { ChangeView, ChangesBefore } from "../engines/world.ts";

/** One change in a sentence, with the figures it carries. */
export function describeChange(c: ChangeView): string {
  const d = c.detail;
  switch (c.kind) {
    case "served_model_changed":
      return `the model id the endpoint served the ${String(d["arm"])} arm changed from ${String(d["from"])} to ${String(d["to"])}`;
    case "policy_changed":
      return `the gate began running policy version ${String(d["version"])} (it was ${String(d["from"])})`;
    case "price_list_changed":
      return `the price list changed to ${c.label.replace(/^price list /, "")} (it was ${String(d["from"])})`;
    case "owner_edit":
      return `you edited the memory: ${String(d["kind"]) === "outcome_definition" ? "a definition of what landed" : "a note"} (${c.label.replace(/^(?:note|definition of landed) /, "")})`;
    case "autonomy_changed":
      return `work of kind ${String(d["workflow"])} was set to ${String(d["to"])}`;
    case "precedent_adopted":
      return `you approved the policy change ${String(d["id"])}`;
    case "model_first_seen":
      return `model ${c.label} first appeared (${String(d["calls"])} calls so far)`;
    case "model_last_seen":
      return `model ${c.label} was last used on ${String(d["lastDay"])}`;
    case "model_share_shift":
      return `model ${c.label} went from ${String(d["from"])}% to ${String(d["to"])}% of calls`;
    case "tool_version_first_seen":
      return `tool ${c.label} first appeared (${String(d["sessions"])} sessions)`;
    case "plan_first_seen":
      return `plan setting ${c.label} first appeared (${String(d["calls"])} calls)`;
    case "plan_last_seen":
      return `plan setting ${c.label} was last used on ${String(d["lastDay"])}`;
  }
}

/** The answer to "what changed before this date", as lines: each change with the sessions it touched, then what was looked at and did not change, then what could not be looked at. */
export function changeLines(q: ChangesBefore, o: { limit?: number } = {}): string[] {
  const out: string[] = [];
  if (q.beforeLedger) return [`The date ${q.date} is not after the first day the ledger covers (${q.ledgerStart}), so there is no history before it.`];
  if (q.afterLedger) return [`The date ${q.date} is after the last day the ledger covers (${q.ledgerEnd}), so changes before it are not known.`];
  const limit = o.limit ?? 12;
  if (q.changed.length === 0) out.push(`Nothing recorded as changed between ${q.windowStart} and ${q.date}.`);
  else {
    out.push(`${q.changed.length} change${q.changed.length === 1 ? "" : "s"} between ${q.windowStart} and ${q.date}:`);
    for (const c of q.changed.slice(0, limit)) {
      const touched = c.affectedSessions === null ? "" : c.affectedSessions === 0 ? "; no session began on it in the window" : `; ${c.affectedSessions} session${c.affectedSessions === 1 ? "" : "s"} began on it in the window`;
      out.push(`  ${c.day}  ${describeChange(c)}${touched}`);
    }
    if (q.changed.length > limit) out.push(`  and ${q.changed.length - limit} more`);
  }
  const stayed = [...q.unchanged.slice(0, 6).map((u) => `${u.entityKind === "tool_version" ? "tool" : u.entityKind === "plan" ? "plan setting" : "model"} ${u.label}`), ...q.unchangedSources];
  if (stayed.length > 0) out.push(`Looked at and unchanged: ${stayed.join("; ")}.`);
  if (q.notRead.length > 0) out.push(`Not looked at: ${q.notRead.map((n) => `${n.source} (${n.why})`).join("; ")}. Nothing is said about these.`);
  return out;
}
