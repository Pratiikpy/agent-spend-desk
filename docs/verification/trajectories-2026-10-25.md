# Trajectories and replayability (DF-040), 2026-10-25

To test a route on the owner's real work, the Desk has to rebuild what an agent did and know how far it can be run again. A replay must never fire a side effect twice, so before anything is replayed, each call in each session is put in a class, and each session is put in a class for how well it was recorded. The month's accounting says how much of the work that covers and why the rest does not.

## What it does

`src/desk/trajectory/read.ts` rebuilds a session from the tool's own log: the prompts, then each tool call in order with its input and the result that came back, joined by the call's id. Inputs are redacted and hashed with the session's folder written as `<cwd>`, so the same call made from a sandbox in another folder has the same key. Text is kept only when asked for, and then only redacted (credentials, home paths, long random tokens).

Each call is `read_only` or `mutating`, with an effect (`tools.ts`). A read of the workspace (Read, Glob, Grep, LS), the network (WebFetch, WebSearch), a file edit (Edit, Write, MultiEdit, NotebookEdit), another agent (Task), and a tool the Desk does not know (every MCP tool by default) are classed by name; the doubtful ones are mutating. A shell command is a read only when every command in it is on a list of plain reads (`ls`, `cat`, `grep`, `git status`, `git log`, `git diff` and the like), nothing redirects to a file, substitutes, runs in the background, sets an environment variable, or is given as a path, and no flag writes (`find -delete`, `sort -o`, `git diff --output`). `2>&1` and `>/dev/null` write nowhere and do not count against a command. `npm test` is mutating: it runs code.

A session is then:

- `full`: nothing is missing. No stretch of the conversation was summarised away; every call has its whole result.
- `tools_only`: every call that cannot be run again has its whole result, but the transcript has a gap (a compaction, a read cut short, lines of the log that could not be read, a delegated agent's own turns). It can be re-run from its prompt, not followed.
- `insufficient`: a shell command that changes something, a network read, another agent, or an unknown tool has no recorded result, or only part of one. Not replayed.
- not eligible: it made no tool call, or the log holds no prompt from a person.

A result the tool cut short can often be made whole: when the tool kept a large output in a file of its own and left a preview and the file's path in the log, the file is read back, and the result counts as whole. When the file is gone it stays cut short.

`desk trajectories [--days N] [--keep]` reads every session in the ledger in the period and accounts for each exactly once: its log was not found, it had nothing to replay, or it is eligible and is one of the three classes. `--keep` writes the redacted calls and results of the eligible sessions into the capture store, where a replay can serve them; without it only counts are kept.

## What it found on this owner's ledger (the last 30 days, 25 October 2026)

409 sessions. 31 had nothing to replay (29 made no tool call, 2 hold no prompt from a person). 378 could have been replayed: 351 full, 5 tools only, 22 insufficient. 356 replayable plus 22 insufficient make the 378. The 22 are mostly a call that cannot be run again with only part of its result (19: a web page the tool cut short, or a large output whose file is gone), and 6 with no result at all. 156 large outputs were read back whole from the files the tool had kept them in; without that, 126 sessions were insufficient and with it 22. Across the eligible sessions, 19,505 calls are shell commands that change something or cannot be shown not to, 4,402 read the workspace, 2,896 edit a file, 1,863 read the network, 533 start an agent and 1,513 are tools not known.

That is how thoroughly the logs record the work. It is not a measure of how well a route would do it.

## What was run

`tests/desk/trajectory.test.ts` (19 tests): the class of each tool and of 14 shell lines that read and 28 that must not be taken for a read; the owner's word on a tool; a session rebuilt from a log with calls joined to results; the same key for a call from two folders, on both separator styles; redaction; a result cut short, past the cap, read back whole from its file, and one whose file is missing; compactions, lines of a delegated agent and lines that are not JSON; each class and each reason, and the two reasons to be not eligible; the accounting on eight sessions with the identities `sessions = not found + nothing + eligible` and `eligible = full + tools only + insufficient`; a session whose log has gone counted as not looked at; counts only by default, calls and results when asked, and a session seen again replaced and not repeated; the period; and the command line against a ledger file. `desk prove` runs `trajectories-fall-in-their-classes-and-the-accounting-adds-up`. Mutation checks: serving only network reads (instead of shell, network, agent and unknown) failed 2 tests, turning off the file read-back failed 1, and letting a redirect through failed 1. A first run on the real ledger found a defect in the shell rule: a stray control character in the pattern meant `2>/dev/null` was not recognised, and the tests then failed on it, which is how it was found.

## Captured at the gateway (added 2026-10-25)

`desk gate gateway --capture FILE [--keep-text]` keeps each session's tool calls and results as a trajectory with source `gateway`. A chat, messages or responses request carries the whole conversation so far, so the latest request of a session holds all of it: it is put into the shape of Claude Code's own log and read by the same code, so a call has the same key whichever way it was recorded (a test compares them). The trajectory of a session is replaced by its latest capture. A failure to keep a capture does not change what the caller gets, and is counted.

Run for real: the gateway in front of https://integrate.api.nvidia.com/v1, a two-turn conversation with a tool (`read_file`) sent through it. The first reply asked for the tool, the second request carried its result; the store held one trajectory, source `gateway`, one call, one result, class `full`. `tests/desk/gateway/capture.test.ts` (8 tests) covers the three families, redaction, the same key from either source, a sink that throws, a stream, and a refused call (not captured).

## Not covered

- **A wrapper around the tool.** There is none; the gateway is the second source. Its capture holds the conversation each request carries (tool calls and their results), not the system prompt or the model's thinking, and a streamed reply is not reassembled, so the last call of a session has no result until a further request arrives.
- **Other tools' logs.** Only Claude Code's log is read. Codex and OpenCode sessions are in the ledger but have no trajectory reader yet.
- **Delegated agents.** A subagent's own turns are in files of their own and are not followed; a session that relied on them is `tools_only` or worse.
- **What a shell line does.** The read-only list is conservative by design and will call plain reads mutating (an unlisted command, a command with a variable in its path). It does not parse every shell; a PowerShell script is taken as mutating unless it is a listed command.
- **Replay itself.** This says what could be replayed; nothing here replays it. That is the next feature (DF-041 and DF-042).
- **Retention.** `--keep` stores redacted calls and results, which are the owner's code, in a file on the owner's machine. There is no expiry; deleting the capture store deletes them.
