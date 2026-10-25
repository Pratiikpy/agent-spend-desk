# Replaying a recorded session without running what it cannot undo (DF-041)

A replay gives the model under test a sandbox copy of the repository and a toolbox. Seven tools are offered (Read, Glob, Grep, LS, Edit, Write, RunTests). Each is confined to the sandbox: a path that resolves outside it, by `..`, an absolute path or a symlink, is refused after its real path is resolved. Every other tool the recorded session used is not run. A call to one is answered from the recording by a key made from the tool and its input (credential shapes masked, so that distinct commands keep distinct keys). A read-only call with no recording gets a stub that says so. A mutating call with no recording, such as a remote push, a migration or a deploy, ends the replay with the status `diverged` and is never run. `RunTests` output is normalised for timing so that two runs of the same code read the same.

## What was exercised

`tests/desk/replay-toolbox.test.ts` (15): confinement by path, absolute path and symlink; edit and write inside the sandbox; the recording served by key; the stub for a read-only miss; `diverged` for a mutating miss; repeatable test output. The prove check `replay-never-runs-what-it-could-not-undo` replays a session whose recording contains a real HTTP POST, a push to a bare repository and a folder deletion, against a live local server, the bare repository and a real folder, and requires that none of them is touched: the server saw no request, the remote gained no commit, the folder was intact.

## Not covered

Only the tools of one agent family (Claude Code's names) are classified as read-only or mutating; others fall to a mutating default, which stops the replay and does not run them. A command that mutates state through a read-only-looking tool is not detectable from its name.
