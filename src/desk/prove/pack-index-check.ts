import { createServer } from "node:http";
import { mkdtempSync, readFileSync, rmSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { SAMPLE_RUNS } from "../canary/command.ts";
import { TASKS } from "../canary/tasks.ts";
import { importPolicyPack } from "../pack/import.ts";
import { readPack } from "../pack/pack.ts";
import { parsePolicyYaml } from "../policy/parse.ts";
import { buildPayload, bytesOf, digestOf, publish } from "../regindex/index.ts";

/**
 * Taking in what others wrote (DF-065) and sharing what the owner chooses (DF-064), each against the thing it must not do. A pack that widens the policy in force, one that
 * reroutes and one that smuggles a field are refused and write nothing; one that narrows is drafted in shadow and leaves the policy in force as it was. The index payload holds
 * no task text; nothing is sent while it is off or before a preview is accepted; what a real local server receives is the previewed bytes, and a redirect is not followed.
 */
export async function packIndexProve(): Promise<{ ok: boolean; detail: string }> {
  const root = mkdtempSync(join(tmpdir(), "desk-prove-pack-"));
  const fails: string[] = [];
  const server = createServer((req, res) => {
    const chunks: Buffer[] = [];
    req.on("data", (c: Buffer) => chunks.push(c));
    req.on("end", () => {
      got.push(Buffer.concat(chunks).toString("utf8"));
      if (req.url === "/moved") {
        res.statusCode = 302;
        res.setHeader("location", "http://example.invalid/x");
      }
      res.end("ok");
    });
  });
  const got: string[] = [];
  try {
    const policy = join(root, "policy.yaml");
    const before = 'version: 1\nrules:\n  - id: only-alpha\n    kind: permit\n    when:\n      project: { in: ["alpha"] }\n';
    writeFileSync(policy, before);
    const pack = (rules: unknown[], extra: Record<string, unknown> = {}): ReturnType<typeof readPack> => readPack(JSON.stringify({ schema: "desk.pack.v1", kind: "budget_policy", name: "p", version: "1.0.0", description: "x", content: { rules }, ...extra }));
    const drafts = join(root, "drafts");
    const opts = { currentPolicyPath: policy, draftsDir: drafts, now: () => new Date("2026-10-25T12:00:00Z") };
    const widen = importPolicyPack(pack([{ id: "beta", kind: "permit", when: { project: { in: ["beta"] } } }]), opts);
    const route = importPolicyPack(pack([{ id: "cheap", kind: "route", when: {}, route: { model_map: { "claude-opus-5": "claude-haiku-5-5" } } }]), opts);
    if (widen.status !== "rejected" || route.status !== "rejected") fails.push("a pack that widens or reroutes was imported");
    if (existsSync(drafts)) fails.push("a refused pack wrote a draft");
    let smuggled = false;
    try {
      readPack(JSON.stringify({ schema: "desk.pack.v1", kind: "budget_policy", name: "p", version: "1.0.0", description: "x", content: { rules: [{ id: "a", kind: "permit", when: {} }], command: "x" } }));
    } catch {
      smuggled = true;
    }
    if (!smuggled) fails.push("a pack with an extra field in its content was read");
    const ok = importPolicyPack(pack([{ id: "stop", kind: "forbid", when: { waste_rule: { in: ["C-LOOP-1"] } }, action: "pause_with_checkpoint" }]), opts);
    if (ok.status !== "drafted" || !ok.draftPath) fails.push("a pack that only narrows was not drafted");
    else {
      const draft = parsePolicyYaml(readFileSync(ok.draftPath, "utf8"));
      if (draft.rules.map((r) => r.id).join() !== "only-alpha,stop") fails.push("the draft is not the policy in force plus the pack's rule");
      if (!/"status": "shadow"/.test(readFileSync(ok.metaPath as string, "utf8"))) fails.push("the draft does not start in shadow");
    }
    if (readFileSync(policy, "utf8") !== before) fails.push("importing changed the policy in force");

    const payload = buildPayload({ canaryRunsPath: SAMPLE_RUNS, now: () => new Date("2026-10-25T00:00:00Z") });
    const text = bytesOf(payload);
    if (TASKS.some((t) => text.includes(t.id) || text.includes(t.prompt.slice(0, 30)))) fails.push("the index payload names a task");
    await new Promise<void>((r) => server.listen(0, "127.0.0.1", r));
    const base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
    const env = { DESK_INDEX: "on", DESK_INDEX_URL: `${base}/index` };
    const consent = { digest: digestOf(payload), acceptedAt: "2026-10-25T00:00:00Z" };
    for (const [label, e, c] of [["off", {}, consent], ["unaccepted", env, null], ["changed", env, { digest: "0".repeat(64), acceptedAt: "x" }]] as const) {
      try {
        await publish({ payload, consent: c, env: e });
        fails.push(`the index was sent while ${label}`);
      } catch {
        /* refused, as it must be */
      }
    }
    if (got.length > 0) fails.push("a refused send reached the server");
    const sent = await publish({ payload, consent, env });
    if (sent.status !== 200 || got.length !== 1 || got[0] !== text) fails.push("what the server received is not the previewed bytes");
    try {
      await publish({ payload, consent, env: { DESK_INDEX: "on", DESK_INDEX_URL: `${base}/moved` } });
      fails.push("a redirect was followed or accepted");
    } catch (e) {
      if (!/redirect/.test((e as Error).message)) fails.push(`a redirect was refused for the wrong reason: ${(e as Error).message}`);
    }
    return fails.length === 0 ? { ok: true, detail: "a widening pack, a rerouting pack and a smuggled field were refused with nothing written; a narrowing pack became a shadow draft and left the policy untouched; the index payload named no task, was refused while off, unaccepted or changed, reached a real server as exactly the previewed bytes, and a redirect was not followed" } : { ok: false, detail: fails.join("; ") };
  } finally {
    await new Promise<void>((r) => (server.listening ? server.close(() => r()) : r()));
    rmSync(root, { recursive: true, force: true });
  }
}
