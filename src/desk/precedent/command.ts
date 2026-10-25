import { existsSync } from "node:fs";

import { OwnerMemory, PRECEDENT_TAG } from "../engines/memory.ts";
import type { Ledger } from "../ledger/db.ts";
import type { PriceSnapshot } from "../pricing/pricebook.ts";
import { openRegret } from "../regret/regret.ts";
import { citePrecedents, describePrecedent } from "./cite.ts";
import { HORIZONS, loadPrecedents, syncPrecedents, trackOutcomes } from "./store.ts";
import { formatUsd } from "../money.ts";

export interface PrecedentCommandOptions {
  db: Ledger;
  snapshot: PriceSnapshot;
  memoryDir: string;
  regretPath: string;
  nowMs?: number;
}

const day = (ms: number): string => new Date(ms).toISOString().slice(0, 10);

/** `desk precedents ...`: the policy changes the owner approved, what they did afterwards, and what a new change would be shown. */
export async function precedentsCommand(args: readonly string[], o: PrecedentCommandOptions): Promise<{ ok: boolean; text: string }> {
  const [sub = "list", ...rest] = args;
  const now = o.nowMs ?? Date.now();
  if (sub === "sync" || sub === "track") {
    const lines: string[] = [];
    if (sub === "sync") {
      if (!existsSync(o.regretPath)) return { ok: true, text: `No decision has been recorded yet (${o.regretPath} does not exist). A precedent is made when you approve a policy change: desk propose --dossier, then desk approve.` };
      const regret = openRegret(o.regretPath);
      try {
        const memory = await OwnerMemory.open({ persistDir: o.memoryDir });
        const r = syncPrecedents(o.db, regret, memory);
        lines.push(r.added.length === 0 ? "No new approved decision to record as a precedent." : `Recorded ${r.added.length} precedent${r.added.length === 1 ? "" : "s"}: ${r.added.join(", ")}.`);
        for (const s of r.superseded) lines.push(`  ${s.newer} replaces ${s.older}, which changed the same rule; the older one is kept and marked replaced.`);
        for (const s of r.skipped) lines.push(`  skipped ${s.decisionId}: ${s.why}.`);
      } finally {
        regret.close();
      }
    }
    const t = trackOutcomes(o.db, o.snapshot, now);
    lines.push(t.measured.length === 0 ? "No outcome was due." : `Measured ${t.measured.length} outcome${t.measured.length === 1 ? "" : "s"}: ${t.measured.map((m) => `${m.precedentId} at ${m.horizonDays} days`).join(", ")}.`);
    for (const w of t.waiting) lines.push(`  ${w.precedentId}: the next outcome is due in ${w.daysLeft} day${w.daysLeft === 1 ? "" : "s"}.`);
    return { ok: true, text: lines.join("\n") };
  }
  if (sub === "list") {
    const ps = loadPrecedents(o.db);
    if (ps.length === 0) return { ok: true, text: "No precedent yet. One is made for each policy change you approve (desk precedents sync)." };
    return { ok: true, text: [`${ps.length} precedent${ps.length === 1 ? "" : "s"}:`, ...ps.map((p) => `  ${p.precedentId}  ${day(p.adoptedAtMs)}${p.supersededBy ? "  (replaced)" : ""}\n    ${describePrecedent(p, now)}`)].join("\n") };
  }
  if (sub === "show") {
    const id = rest[0];
    if (!id) throw new Error("Use: desk precedents show <precedent id>");
    const p = loadPrecedents(o.db).find((x) => x.precedentId === id || x.precedentId.startsWith(id));
    if (!p) return { ok: false, text: `No precedent ${id}.` };
    const memory = await OwnerMemory.open({ persistDir: o.memoryDir });
    const m = memory.show(p.memoryId);
    const out = [`Precedent ${p.precedentId}, adopted ${day(p.adoptedAtMs)}${p.supersededBy ? `, replaced by ${p.supersededBy}` : ""}`, `  ${p.summary}`, "  What changed:", ...p.diff.map((d) => `    ${d.text}`)];
    out.push("  Outcomes, replayed on the sessions that followed:");
    for (const h of HORIZONS) {
      const x = p.outcomes.find((y) => y.horizonDays === h);
      out.push(x ? `    ${h} days: ${x.sessions} sessions, ${x.paused} paused, ${x.askedCalls} asked, ${x.deniedCalls} denied, saved ${formatUsd(x.savedMicros)}, blocked ${x.landedBlocked} of ${x.landedTotal} landed runs` : `    ${h} days: not measured yet`);
    }
    if (m) out.push(`  Memory ${m.id}, confidence ${m.confidence}${m.superseded ? ", replaced" : ""}; history: ${m.history.map((h) => `${h.action} by ${h.actor}`).join(", ")}`);
    return { ok: true, text: out.join("\n") };
  }
  if (sub === "cite") {
    const text = rest.join(" ");
    if (!text) throw new Error('Use: desk precedents cite "<the change in words>"');
    let memory: OwnerMemory | null = null;
    try {
      memory = await OwnerMemory.open({ persistDir: o.memoryDir });
    } catch {
      memory = null;
    }
    const c = citePrecedents(o.db, memory, text, now);
    return { ok: true, text: c.citations.length === 0 ? c.note : c.citations.map((x) => `${x.line}\n  (memory ${x.memoryId}, relevance ${x.relevance}${x.superseded ? ", replaced" : ""})`).join("\n") };
  }
  throw new Error("Use: desk precedents list | sync | track | show <id> | cite \"<change>\"");
}

/** `desk memory ...`: what the Desk remembers, and the engine's own ways of keeping it true. */
export async function memoryCommand(args: readonly string[], o: { memoryDir: string; miner?: (prompt: string) => Promise<string> }): Promise<{ ok: boolean; text: string }> {
  const [sub = "list", ...rest] = args;
  const memory = await OwnerMemory.open({ persistDir: o.memoryDir, ...(o.miner ? { miner: o.miner } : {}) });
  if (sub === "list") {
    const all = memory.all();
    if (all.length === 0) return { ok: true, text: "Nothing is remembered yet. desk remember \"...\" stores a note; desk memory mine \"...\" takes durable statements out of something you say." };
    return { ok: true, text: all.map((m) => `${m.id}  ${m.learnedAt}  ${m.kind}${m.superseded ? " (replaced)" : ""}\n  ${m.content}`).join("\n") };
  }
  if (sub === "show") {
    const id = rest[0];
    if (!id) throw new Error("Use: desk memory show <id>");
    const m = memory.show(id);
    if (!m) return { ok: false, text: `No memory ${id}.` };
    return { ok: true, text: [`${m.id}  confidence ${m.confidence}${m.superseded ? ", replaced" : ""}${m.supersedes ? `, replaces ${m.supersedes}` : ""}`, `  ${m.content}`, `  tags: ${m.tags.join(", ")}`, "  history:", ...m.history.map((h) => `    ${h.at.slice(0, 16).replace("T", " ")}  ${h.action} by ${h.actor}`)].join("\n") };
  }
  if (sub === "feedback") {
    const [id, kind] = rest;
    if (!id || (kind !== "helpful" && kind !== "not_helpful" && kind !== "wrong")) throw new Error("Use: desk memory feedback <id> helpful|not_helpful|wrong");
    try {
      const r = memory.feedback(id, kind);
      return { ok: true, text: `${id}: confidence ${r.before.toFixed(2)} to ${r.after.toFixed(2)}. ${kind === "wrong" ? "A wrong memory ranks well below the others now." : kind === "helpful" ? "It ranks a little higher the next time." : "It ranks a little lower the next time."}` };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  }
  if (sub === "mine") {
    const text = rest.join(" ");
    if (!text) throw new Error('Use: desk memory mine "<something you said or decided>"');
    try {
      const made = await memory.mine(text);
      return { ok: true, text: made.length === 0 ? `Nothing durable was found in that. ${o.miner ? "The model returned no statement worth keeping." : "The model-free reading keeps a sentence of 20 to 300 characters that says what is preferred, decided or must hold."}` : [`Kept ${made.length} statement${made.length === 1 ? "" : "s"} as short-term memory (sleep consolidates what is used):`, ...made.map((m) => `  ${m.id}  ${m.content}`)].join("\n") };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  }
  if (sub === "sleep") {
    const apply = rest.includes("--apply");
    const p = memory.sleepPreview();
    const plan = `${p.toConsolidate.length} to consolidate into long-term, ${p.toArchive.length} mined statement${p.toArchive.length === 1 ? "" : "s"} to archive (unused for 30 days), ${p.toSynthesize.length} group${p.toSynthesize.length === 1 ? "" : "s"} of mined statements to fold into one`;
    const guarded = p.kept > 0 ? ` ${p.kept} the engine would have archived or folded are your own words, definitions or precedents, and are kept.` : "";
    if (!apply) return { ok: true, text: `Sleep would: ${plan}.${guarded} Nothing was changed; desk memory sleep --apply runs it, after a backup you can restore.` };
    const r = memory.sleep();
    return { ok: true, text: [`Sleep ran: ${r.consolidated} consolidated, ${r.archived} archived, ${r.synthesized} folded. Backup ${r.backupId}; desk memory restore ${r.backupId} undoes it.`, ...r.actionLog.slice(0, 20).map((l) => `  ${l}`)].join("\n") };
  }
  if (sub === "restore") {
    const id = rest[0];
    if (!id) throw new Error("Use: desk memory restore <backup id>");
    try {
      memory.restore(id);
      return { ok: true, text: `Restored the memory from backup ${id}.` };
    } catch (e) {
      return { ok: false, text: (e as Error).message };
    }
  }
  throw new Error("Use: desk memory list | show <id> | feedback <id> helpful|not_helpful|wrong | mine \"<text>\" | sleep [--apply] | restore <backup id>");
}

export { PRECEDENT_TAG };
