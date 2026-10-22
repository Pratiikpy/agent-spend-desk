// Entry point for the Claude Code PreToolUse hook: `node src/desk/gate/hook-main.ts` (Node runs TypeScript directly).
// Reads the hook event on stdin, asks the gate, and exits 0 (let the permission flow continue) or 2 (block).
import { runHook } from "./hook.ts";

async function readStdin(): Promise<string> {
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of process.stdin) {
    const b = chunk as Buffer;
    size += b.length;
    if (size > 1_048_576) throw new Error("hook input over 1 MiB");
    chunks.push(b);
  }
  return Buffer.concat(chunks).toString("utf8");
}

let outcome;
try {
  outcome = await runHook(await readStdin(), process.env);
} catch (error) {
  const text = `Desk gate could not decide and is blocking as a precaution: ${error instanceof Error ? error.message : String(error)}`;
  outcome = { exitCode: 2 as const, stdout: "", stderr: text };
}
if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout + "\n");
if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr + "\n");
process.exitCode = outcome.exitCode;
