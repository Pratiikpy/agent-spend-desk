# Task capture (DF-036), 2026-10-25

A route can only be judged on tasks like the owner's own. This turns work the owner merged and kept into tasks: the prompt they gave, the commit the work started from, the commit it ended at, and the tests that decide whether it was done. Nothing here calls a model; it finds the tasks and fixes what counts as success before any route is tried.

## What it does

`desk capture candidates` reads the ledger for sessions tied, with high or medium confidence, to commits that are on the default branch and not reverted, and for each one makes a candidate: the first prompt, read again from the tool's log and redacted (credentials, home paths and long random tokens masked; instruction-like text named and left); the commit before the session's first commit and the session's last commit; the files changed; which changed files are tests. A candidate is set aside, with every reason it fails, when:

- more than 12 files or 600 lines changed;
- a dependency file changed (the sandbox links the dependencies the repository has now);
- only documentation changed;
- no test file was added or edited, so nothing can say the work was done;
- the work took more than two prompts, the prompt is under 25 characters, was cut, or its log is gone;
- another commit sits between the session's, or a merge sits in the range, so the change is not the session's alone.

`desk capture compute <id>` pins the two commits under `refs/desk/snapshots/` (so rewriting the branch cannot lose them), then runs the owner's tests the way SWE-bench does. The before folder is the starting commit with the tests the change added or edited laid over it; the after folder is the end commit. The after run is made twice. A test that fails or is absent before and passes after is FAIL_TO_PASS, one that passes in both is PASS_TO_PASS, and one whose result differs between the two after runs is set aside as flaky and decides nothing. A task with at least one FAIL_TO_PASS test is a strong oracle; with none it is a weak oracle, and the Desk says why. A run that gave no readable results is unrunnable and claims nothing.

Presets: `node` (`node --test` with the JUnit reporter), `vitest` and `jest` (their JSON reports), `pytest` (JUnit), and `custom` (`--cmd` with `{files}` and `{out}`, reading `junit`, `tap`, `json` or the exit code alone). Tests run in a restored copy, not the working directory, with a short environment (the variables a process needs to start, plus `CI=1`), so no key in the owner's shell reaches them, and are stopped at 300 seconds.

`desk capture accept` refuses a task that is unmeasured, has no deciding test, is a weak oracle (unless `--weak`), or has instruction-like text in its prompt (unless `--ack-injection`, after reading it with `desk capture show`). `desk capture freeze` fixes the accepted tasks as a suite: refused under 12 tasks unless `--min` says otherwise (and then marked small), taken in turn from each kind-and-area family when there are more than 40, with every second task of a family held out; it hashes each task's prompt, commits and deciding tests, and the suite cannot be edited or deleted afterwards. `desk capture families` lists the kinds of work covered and the ones with none, and does not fill them.

`desk capture import <folder>` brings in tasks in the Lab's layout (`base/`, `gold/`, `hidden/`, a prompt) as small repositories of their own with two commits, so that they are measured by the same oracle as a task from history.

## What it found on this owner's ledger

The ledger holds 3 sessions whose work was merged and kept with enough confidence to link. None can be a task: all three took more than two prompts; two changed more files or lines than the limits and changed dependencies; two began with a prompt under 25 characters; one has other commits between its own; one has a merge in its range; and one starts from a commit whose parent is not in the repository. So the owner's own history yields no tasks yet, and the tool says so and why, instead of making some.

## A defect the independent list found

The check holds the tests the Desk finds against `expected.json`, the list the Lab's own audit made for each of ten hand-written tasks, by a different program. On the first run nine of ten agreed and `paginate-cursor` did not: a test named `a cursor is base64url of {"id":n} without padding` came back with `&quot;` where the quotes were. Node's JUnit reporter escapes a quote twice (`&amp;quot;`), so a correct XML reader returns the entity as text. The reader now repairs that for node's output only, because in anyone else's report a name that really says `&quot;` would be changed; a test runs a real node run with quotes in a test name, and the same ten tasks now agree with the Lab's audit on all 143 deciding tests.

## What was run

`tests/desk/capture.test.ts` (32 tests): real runs of node's test runner read as JUnit and as TAP, a real vitest run read as JSON, a jest-shaped report, exit codes; the environment the tests see (a secret set in the owner's shell is not there, `CI` is); a time limit; a command that gave no results; file names the Desk will not pass to a test command; the oracle on a repository with a planted change (the two deciding tests, the one that must keep passing, a deterministic flaky test set aside, a test still failing after the change in neither list, a weak oracle, an unrunnable one, the repository untouched); candidate discovery in a ledger made from real commits and logs, with each reason to set one aside shown in turn; the owner's review rules; a suite of 30 tasks in three families frozen to 12, held out by family, refused when small, never edited, and its hash changing with any task; ten Lab tasks imported and the first four measured against the Lab's list; and the command line end to end. `desk prove` runs `captured-task-oracle-finds-the-deciding-tests-and-agrees-with-the-lab-audit`, which measures all ten. Mutation checks: ignoring a flaky result failed the flaky test, letting a weak oracle be accepted without `--weak` failed the review test, and swapping the two lists failed three.

## Not covered

- **The owner's own tasks.** The ledger yields none, so every measurement above is on repositories built for the test and on the Lab's hand-written tasks. How the oracle behaves on a real, messy commit of the owner's, with a slow test suite and shared fixtures, has not been seen.
- **Runners.** `node` and `vitest` were run for real. `jest` and `pytest` presets were written to those tools' documented output and read through the same JSON and JUnit readers, but neither tool was run.
- **Specification.** A task's prompt may not say everything its tests check, which is the weakness of mining tasks from history. The review shows the prompt beside the tests so that the owner can judge it; nothing checks it automatically, and only the first prompt of a session is the task.
- **Dependencies.** The sandbox links the `node_modules` of the owner's repository as it is now. A commit that changed dependencies is set aside; one that did not, but whose tests depend on a library version since upgraded, can mislead.
- **Isolation.** The tests run with a short environment and a time limit, not in a container: a test that reaches the network or writes outside its folder will. The owner's tests are code they already run on their machine.
- **Selection.** The spec prefers tasks with intermediate pass rates. No route has been run on these tasks yet, so there is no pass rate to prefer; selection is by family, in turn.
- **Where review happens.** Accepting and rejecting are commands; the screens do not change anything, so there is no accept button.
