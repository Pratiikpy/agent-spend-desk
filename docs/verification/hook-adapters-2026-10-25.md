# Hook adapters for four agent tools (DF-056)

The gate stops a tool call through the tool's own blocking hook. Four tools now have an adapter: Claude Code, Codex CLI, Cursor and Gemini CLI. Each adapter reads the tool's event, asks the gate, and answers in the way that tool was seen to read a stop. `desk gate hook --tool T [--scope user|project] [--install]` says whether the tool's config holds the hook and, with `--install`, adds it beside whatever is there (the file as it was is kept as `.desk-backup`; a config that is not JSON is left alone). A hook is shown as enforced only after `desk enforcement test` has passed for that tool.

## What was run against the real tools

- **Claude Code 2.1.308**: three runs (no gate, a policy that refuses, a policy that permits). The refusal and the dead gate stopped the command; the permitting policy let it run. Passed on 2026-10-25.
- **Codex CLI 0.154.0**: the same three runs. Passed on 2026-10-25, after two findings that the tool's documentation does not give. (1) A hook that exits 2 with a reason on stderr, which the documentation says blocks, was reported "PreToolUse Failed" and the command ran. A hook that exits 0 with a `permissionDecision` of deny was reported "Blocked" and the command did not run, so Codex is answered that way. (2) Codex's own transcript file is not Claude Code's log, and handing its path to the gate made the gate refuse every call, including the control; the adapter no longer passes it. Also: a hook that is only installed does not run until the owner reviews it in Codex (`/hooks`); the live test passes `--dangerously-bypass-hook-trust` for the one hook it gives itself.
- **Cursor, Gemini CLI**: **NOT VERIFIED live.** Cursor is not installed here and Gemini CLI has no sign-in here. Both were written from the tools' documentation (Cursor's `preToolUse` with `{"permission":"deny"}`; Gemini CLI's `BeforeTool` with `{"decision":"deny"}`) and answered with the deny on stdout and exit 0, since the exit-2 route was seen not to block in Codex. Their contract tests pass; the ladder keeps them advisory until someone runs `desk enforcement test --live` where those tools are installed (a live variant exists only for Claude Code and Codex).

## What a hook sees

None of these tools' transcripts is read. A hook stops the next tool call of a session the gate has paused, a call after the emergency switch is closed, and a call after a cap has been reached by spend the gate knows of (through the gateway, the spend log or the ledger). It does not see what the tool spent on its own: Codex's spend reaches the gate only through the gateway's Responses route, which was run against a fake upstream; Cursor's and Gemini CLI's spend is not seen. A paused session can still write its handoff file, through each tool's own write tool (Write, write_file, apply_patch).

## Tests

`tests/desk/gate/tools.test.ts` (15): each tool's event in, each answer out, every failure blocks, the real hook command run as a process for each tool, the handoff exception for each tool's write tool, install and re-install in each tool's layout. `desk prove` check `enforcement-surface-tests-can-fail`: seven surfaces (four hooks, three gateway doors) pass against the gate and all fail against a gate that permits everything.
