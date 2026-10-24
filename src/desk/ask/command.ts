import { Budget, ASK_LIVE, ASK_SAMPLE } from "../agents/budget.ts";
import { MemoryTrace } from "../agents/trace.ts";
import { ENGINE_NAMES, type EngineName } from "../engines/load.ts";
import { OwnerMemory } from "../engines/memory.ts";
import { openLedger } from "../ledger/db.ts";
import { choosePort } from "../propose/command.ts";
import { ask, verifyAnswer, type AskResult } from "./ask.ts";

export interface AskCommandOptions {
  dbPath: string;
  question: string;
  ablate: string | undefined;
  noModel: boolean;
  record: boolean;
  sampleMode: boolean;
  cassetteDir: string;
  memoryDir: string;
  env: Record<string, string | undefined>;
}

export function parseAblate(text: string | undefined): { names: Set<EngineName>; bad: string[] } {
  const names = new Set<EngineName>();
  const bad: string[] = [];
  for (const raw of (text ?? "").split(",").map((s) => s.trim()).filter(Boolean)) {
    if ((ENGINE_NAMES as readonly string[]).includes(raw)) names.add(raw as EngineName);
    else bad.push(raw);
  }
  return { names, bad };
}

export function renderAnswer(r: AskResult, trace: MemoryTrace): string {
  const out: string[] = [];
  if (r.status === "refused") out.push(`Not answered. ${r.note}`);
  else if (r.status === "unknowable") out.push(`Unknowable. ${r.note ?? ""}`.trim());
  else {
    for (const s of r.sentences) out.push(s.text);
    if (r.note) out.push("", `Note: ${r.note}`);
  }
  out.push("", "how this answer was checked");
  out.push(`  route ${r.route}${r.flags.length > 0 ? ` (flags: ${r.flags.join(", ")})` : ""}; planner ${r.planner}; explainer ${r.explainer}${r.servedModel ? `; model ${r.servedModel}` : ""}`);
  for (const e of trace.events) {
    if (e.event === "desk.engine") {
      const d = e.detail as { engine: string; impl: string; conformance: string; ablated: boolean };
      out.push(`  engine ${d.engine}: ${d.impl}, conformance ${d.conformance}${d.ablated ? ", ABLATED (off for this run)" : ""}`);
    } else if (e.event === "desk.step") {
      const d = e.detail as { id: string; op: string; rows: number; query_hash: string };
      out.push(`  step ${d.id} ${d.op}: ${d.rows} rows, query ${d.query_hash.slice(0, 19)}`);
    } else if (e.event === "desk.audit") {
      const d = e.detail as { attempt: number; accepted: number; rejected: { reason: string }[] };
      out.push(`  audit attempt ${d.attempt}: ${d.accepted} accepted, ${d.rejected.length} rejected${d.rejected.length ? ` (${d.rejected.map((x) => x.reason).join(", ")})` : ""}`);
    } else if (e.event === "revision.applied") out.push("  revision applied");
    else if (e.event === "fallback.used") out.push(`  fallback: ${(e.detail as { reason: string }).reason}`);
  }
  const receipts = trace.events.flatMap((e) => {
    const id = e.event === "desk.model" ? (e.detail as { nightshift_receipt?: unknown }).nightshift_receipt : undefined;
    return typeof id === "string" ? [id] : [];
  });
  if (receipts.length > 0) out.push(`  served by Meterless Nightshift: ${receipts.length} model call${receipts.length === 1 ? "" : "s"}, receipts ${receipts.join(", ")}`);
  out.push(`  answer ${r.answerId} (check it again with: desk verify-answer ${r.answerId})`);
  return out.join("\n");
}

export async function askCommand(o: AskCommandOptions): Promise<string> {
  const { names, bad } = parseAblate(o.ablate);
  if (bad.length > 0) return `Unknown engine to ablate: ${bad.join(", ")}. The engines are ${ENGINE_NAMES.join(", ")}.`;
  if (o.question.trim() === "") return "Ask a question, for example: desk ask \"How much did we spend in September?\"";
  const db = openLedger(o.dbPath);
  try {
    const route = o.noModel ? { port: null, label: "no model (--no-model): the rule planner and rule explainer run" } : choosePort({ sampleMode: o.sampleMode, record: o.record, cassetteDir: o.cassetteDir, env: o.env });
    const memory = await OwnerMemory.open({ persistDir: o.memoryDir });
    const trace = new MemoryTrace();
    const r = await ask({ db, question: o.question, ablate: names, port: route.port, memory, trace, budget: new Budget(o.sampleMode ? ASK_SAMPLE : ASK_LIVE) });
    return `${renderAnswer(r, trace)}\n  model route: ${route.label}`;
  } finally {
    db.close();
  }
}

export async function rememberCommand(o: { memoryDir: string; text: string; outcome: boolean }): Promise<string> {
  const memory = await OwnerMemory.open({ persistDir: o.memoryDir });
  try {
    const rec = memory.remember({ content: o.text, kind: o.outcome ? "outcome_definition" : "note" });
    return `remembered ${rec.id} (${o.outcome ? "outcome definition" : "note"})`;
  } catch (e) {
    return `Not remembered: ${(e as Error).message}`;
  }
}

export async function verifyAnswerCommand(dbPath: string, answerId: string, memoryDir: string): Promise<string> {
  const db = openLedger(dbPath);
  try {
    const memory = await OwnerMemory.open({ persistDir: memoryDir });
    const r = await verifyAnswer(db, answerId, { memory });
    if (!r.found) return r.note;
    return `${r.note}\nsteps unchanged: ${r.same.join(", ") || "none"}; changed: ${r.changed.join(", ") || "none"}; sentences still holding: ${r.sentencesHolding} of ${r.sentencesTotal}`;
  } finally {
    db.close();
  }
}
