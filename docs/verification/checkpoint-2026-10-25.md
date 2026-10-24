# Pause with checkpoint: stop the session, get a handoff, resume only with a reason (2026-10-25)

Feature DF-051 built. Before, a cap or a loop stop was a refusal and the session simply failed on every call; nothing was left for whoever came back.

## What happens now

When a **loop stop** (a `forbid` rule whose action is `pause_with_checkpoint`) or a **cap on a window that does not clear by itself** (the day, the month, a session, one model's or project's day or month) refuses a request, the gate opens a checkpoint for that session:

1. It writes a handoff file (`data/desk/handoffs/checkpoint-<n>-<session>.md`) with what the Desk knows: why, the person, the project, when, and how it resumes.
2. The refusal tells the agent: finish the current step, write a short handoff (what is done, what is open, the branch) into that file, and stop.
3. From then on the gate allows nothing else in that session: a paid call, a gateway request or a hook tool call is refused with the checkpoint's number. The one exception is the Claude Code hook allowing a `Write`, `Edit` or `MultiEdit` of exactly that file, so the agent is able to do what it was told. A write to `<file>.bak`, to another file in the folder, a `Read` of it, or a shell command that redirects into it is refused.
4. Other sessions, and other people, are not stopped.

A cap on the last ten minutes or the last hour is **not** a checkpoint: it clears by itself, and stopping a session until someone came back would only be a nuisance. A gate started without a handoff directory behaves as it did, a refusal and nothing more. The owner's emergency switch overrides all of it.

## Resuming

`desk gate checkpoints` lists the stopped sessions and where each handoff goes; `desk gate status` counts them. `desk gate resume --session ID`:

- refuses unless the agent wrote its handoff (the part of the file below the marker; an unchanged template is not a handoff), or the owner passes `--no-handoff`, which is recorded;
- looks at the request that stopped the session (the amount it needed is kept) and, if its cap still binds, refuses with the window named and asks for an **extension**: `--extend-usd N --for 2h --reason "..."`;
- grants an extension only with the owner key, a reason in words, a positive amount and 1 minute to 24 hours, and only if it is enough: an extension too small to let the session through is refused, not granted and wasted;
- writes the grant as a **signed event** in the gate's hash-chained record (`approved`, reason `checkpoint_resumed`, with the handoff's hash and the windows and amount), and the headroom applies to the windows that bound, as if that much had not been spent, until it expires;
- needs nothing more when the cap no longer binds (a new day, a window that slid), and says so.

## What ran

`tests/desk/gate/checkpoint.test.ts` (19) and `checkpoint-cli.test.ts` (3): what counts as a stop, the file written, the instruction naming its path, the session stopped and others not, the hook allowing only the handoff write (six refusals tried), a ten-minute cap leaving no checkpoint, a loop stop opening one only once, no handoff directory, the emergency switch, a restart, the handoff read from the marker, resume refused without a handoff, with a cap that still binds (naming the window), with too small an extension, with a missing reason or key or a silly amount or length; a signed extension that lets the session spend and then ends, lapsing after its time, a new day needing none, resume without a handoff recorded as such, and the command line end to end. All 129 earlier gate tests pass. Full suite: 108 files, 1,405 tests.

**A defect found on the way, in the work of earlier today:** the hook path built its request without the new windows, so a session cap, a velocity cap or a per-model cap was never enforced by the Claude Code hook (the authorize path, the gateway and MCP were). Fixed, with a test.

## Not covered

- Not run against a live Claude Code session: the hook contract is the one read from the documentation on 2026-10-22, and the handoff exception depends on `tool_input.file_path` being in the event, which the tests supply.
- A tool that has no hook and no gateway gets nothing: no checkpoint is possible there, and DF-052 says so.
- Only the Claude Code hook can allow the agent to write its handoff. On the gateway and MCP doors the agent is told where to write, with its own tools, which the Desk does not gate.
- A checkpoint is a record in the gate's database and a file; the resume event is in the hash-chained record, the checkpoint row itself is not.
- The extension applies to the windows that bound at the time and is not tied to one session: while it lasts, any of the person's sessions benefits.
