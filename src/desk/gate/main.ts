// Stand-alone entry for the gate: `tsx src/desk/gate/main.ts serve|mcp|open|close|status|integrity ...`.
// The main CLI exposes the same commands as `desk gate ...` through runGateCli.
import { runGateCli } from "./cli.ts";

process.exitCode = await runGateCli(process.argv.slice(2));
