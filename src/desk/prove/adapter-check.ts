import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import type { Ledger } from "../ledger/db.ts";
import { sandboxAvailable, testAdapter } from "../open/adapter.ts";
import { parseEvents } from "../open/events.ts";
import { exportEvents } from "../open/export.ts";

/**
 * The open format and the adapter harness, on the sample (DF-063). The sample ledger is written as `desk.events/1`, read back clean, and its token sums are the ledger's. The
 * shipped reference adapter is loaded and reproduces its golden files; a copy whose golden output is changed by one token is refused; a copy that imports the network module
 * is refused; a copy whose detect claims everything is refused. A harness that cannot refuse a broken adapter has shown nothing by loading a good one.
 */
export function adapterProve(db: Ledger, referenceDir: string): { ok: boolean; detail: string } {
  const sb = sandboxAvailable();
  if (!sb.ok) return { ok: false, detail: sb.reason };
  const work = mkdtempSync(join(tmpdir(), "desk-prove-adapter-"));
  try {
    const out = join(work, "export.jsonl");
    const written = exportEvents(db, out);
    if (typeof written === "string") return { ok: false, detail: `the sample ledger could not be exported: ${written}` };
    const parsed = parseEvents(readFileSync(out, "utf8"));
    if (parsed.problems.length > 0) return { ok: false, detail: `the export does not read back as desk.events/1: line ${parsed.problems[0]!.line}: ${parsed.problems[0]!.message}` };
    const want = db.prepare("SELECT COUNT(*) AS n, SUM(input_tokens) AS i, SUM(output_tokens) AS o FROM model_call").get() as { n: number; i: number; o: number };
    const got = { n: parsed.calls.length, i: parsed.calls.reduce((s, c) => s + c.input_tokens, 0), o: parsed.calls.reduce((s, c) => s + c.output_tokens, 0) };
    if (got.n !== want.n || got.i !== want.i || got.o !== want.o) return { ok: false, detail: `the export holds ${got.n} calls, ${got.i} input and ${got.o} output tokens; the ledger holds ${want.n}, ${want.i} and ${want.o}` };
    const text = readFileSync(out, "utf8");
    if (/"(estimated|total_micros|prompt|content)"/.test(text)) return { ok: false, detail: "the export carries a field it should not" };

    const good = testAdapter(referenceDir);
    if (good.loaded === null) return { ok: false, detail: `the reference adapter is not loaded: ${good.refusal ?? "unknown"}` };
    if (good.fixtures.length < 2 || !good.fixtures.every((f) => f.ok)) return { ok: false, detail: "the reference adapter did not reproduce every golden file" };

    const reference = readFileSync(join(referenceDir, "adapter.mjs"), "utf8");
    const broken = (label: string, edit: (dir: string) => void, expect: RegExp): string | null => {
      const dir = join(work, label);
      cpSync(referenceDir, dir, { recursive: true });
      edit(dir);
      const t = testAdapter(dir);
      const why = [t.refusal ?? "", ...t.fixtures.map((f) => f.detail)].join(" | ");
      if (t.loaded !== null) return `${label}: a broken adapter was loaded`;
      return expect.test(why) ? null : `${label}: refused, but not for the reason expected (${why.slice(0, 200)})`;
    };
    const problems = [
      broken("golden-changed", (d) => {
        const g = join(d, "fixtures", "sample.jsonl.golden.jsonl");
        writeFileSync(g, readFileSync(g, "utf8").replace('"input_tokens":1200', '"input_tokens":1201'));
      }, /the output differs from fixtures\/sample.jsonl.golden.jsonl/),
      broken("network", (d) => writeFileSync(join(d, "adapter.mjs"), `import net from "node:net";\n${reference}`), /may not import "node:net"/),
      broken("claims-everything", (d) => writeFileSync(join(d, "adapter.mjs"), reference.replace(/detect\(head\) \{[\s\S]*?\n  \},\n\n  \/\/ Turn/, "detect() { return true; },\n\n  // Turn")), /detect says it recognises an empty file/),
      broken("sample-swapped", (d) => writeFileSync(join(d, "fixtures", "sample.jsonl"), "another file\n"), /is not the file the manifest pins/),
    ].filter((x): x is string => x !== null);
    if (problems.length > 0) return { ok: false, detail: problems[0] as string };
    return {
      ok: true,
      detail: `the sample ledger's ${got.n} calls were written as desk.events/1 and read back clean with the same token sums; the reference adapter reproduced its ${good.fixtures.length} golden files twice over in the sandbox; copies with a changed golden, a network import, a detect that claims everything and a swapped sample were each refused for that reason`,
    };
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}
