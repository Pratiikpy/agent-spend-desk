# The enforcement ladder: what the Desk can actually stop, and on what evidence (2026-10-25)

Feature DF-052 built. The Policy screen and `desk enforcement` say, tool by tool, whether the Desk can stop it.

## The three levels

- **Enforced**: a surface the Desk has *tested* stops the tool. For a hook, that means the real tool was run and a refused call did not run. For a gateway door, that the tool itself was run through it.
- **Advisory**: the tool can be stopped or asked, but nothing has been shown to do it: an MCP self-check (the agent may ignore it), a hook that has not been run live ("advisory, not tested"), a gateway door tested without the tool, or a tool at another version than the one tested.
- **Notify only**: no pre-call hook and no model traffic the Desk can meter. Caps on it produce notices and month-end findings only.

"Enforced" is never assumed: it needs a recorded result in `data/desk/enforcement.json`, and a live result for one version does not count for another.

## How it is tested

`desk enforcement test` runs, against the Desk's own gate, with no model call: the hook (a call over the cap is blocked; a permitted call is let through silently; an unreachable gate, a missing token and input that is not JSON all block; a session stopped for a checkpoint may write its handoff and nothing else) and both gateway doors against a stand-in model endpoint (a permitted call is forwarded; an over-cap call is refused and never reaches the model; a gate that cannot write blocks the call). `--live` runs the real Claude Code three times with its shell tool, on the cheapest model, a few cents: with no gate running, with a policy that refuses, and with a policy that permits, and the marker file a command would write is the evidence.

**Run on this machine, 2026-10-25** (`docs/verification/enforcement-results-2026-10-25.json`): the hook contract, the OpenAI door and the Anthropic door passed all their checks. The live run against **Claude Code 2.1.308** passed: with no gate the call was blocked (fails closed), with a refusing policy it was blocked and the gate recorded one refusal, with a permitting policy the command ran (the control). So Claude Code reads **enforced**; the other tools read as the table below. The same three runs were recorded by hand on 2026-10-22 in `gate-enforcement.md`; this is that run made repeatable.

| Tool | Level | Why |
|---|---|---|
| Claude Code | enforced | the PreToolUse hook, run live on 2.1.308 |
| Codex CLI | advisory | MCP only: it speaks the Responses API, which the gateway does not meter, and no usable hook is known (not verified) |
| OpenCode | advisory | its traffic can be pointed at the Anthropic door, which is tested, but OpenCode has not been run through it |
| Cline | advisory | the same, for the OpenAI door |
| Cursor | notify only | a hosted IDE agent: no hook, and its traffic goes through its own servers |
| GitHub Copilot CLI | notify only | no hook known and no gateway path (not verified) |
| Gemini CLI | advisory | MCP only: it speaks Google's API, which neither door meters |

## What ran

`tests/desk/enforce.test.ts` (15): nothing enforced before a test; a contract test is not a live test; a live pass enforces, a version change or a failed live run returns the tool to advisory and says why; a door tested without the tool stays advisory; a tool with nothing is notify only with its reason; every tool named once; results kept newest per surface and robust to a missing or damaged file; the surface tests pass against the Desk's gate and **fail against a gate that permits everything**, so a pass means something. One case in the UI server test (the Policy route carries the ladder). Full suite: 109 files, 1,421 tests.

## Not covered

- **The live test covers Claude Code only.** Codex, OpenCode, Cline, Cursor, Copilot and Gemini were not run: their rows come from what each tool is known to expose, and say "not verified" where that is a belief.
- A tool that Claude Code is pointed at the gateway through (`ANTHROPIC_BASE_URL`) was not run live; the door is tested with a stand-in endpoint.
- The live run needs `claude` signed in on the machine and spends a few cents; it was run once, not repeatedly, and it asks the model to do something trivial, so a model that refused the request would read as a pass for the refusing policy (the control run guards against that: it must produce the marker).
- A user who removes the hook from their settings is not stopped; that is outside what a hook can show (`gate-enforcement.md`).
- The version check reads `claude --version` at most once in ten minutes.
