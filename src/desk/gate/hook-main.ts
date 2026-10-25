// Entry point for a tool's blocking pre-call hook: `node src/desk/gate/hook-main.ts [--tool claude-code|codex|cursor|gemini-cli]` (Node runs TypeScript directly).
// Reads the hook event on stdin, asks the gate, and exits 0 (let the permission flow continue) or 2 (block).
import { runHook } from "./hook.ts";
import { blocked, isHookTool, type HookTool } from "./tools.ts";

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

const flag = process.argv.indexOf("--tool");
const named = flag >= 0 ? process.argv[flag + 1] ?? "" : "claude-code";
let outcome;
if (!isHookTool(named)) {
  // A hook that names a tool this build does not know cannot read its events, so it blocks rather than guess.
  const text = `Desk gate does not know the tool ${JSON.stringify(named)} and is blocking as a precaution`;
  outcome = { exitCode: 2 as 0 | 2, stdout: "", stderr: text };
} else {
  const tool: HookTool = named;
  try {
    outcome = await runHook(await readStdin(), process.env, undefined, tool);
  } catch (error) {
    outcome = blocked(tool, error instanceof Error ? error.message : String(error));
  }
}
if (outcome.stdout.length > 0) process.stdout.write(outcome.stdout + "\n");
if (outcome.stderr.length > 0) process.stderr.write(outcome.stderr + "\n");
process.exitCode = outcome.exitCode;
