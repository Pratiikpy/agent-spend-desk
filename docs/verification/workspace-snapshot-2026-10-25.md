# Workspace snapshot (DF-097), 2026-10-25

A replay of a task is only as honest as the workspace it starts from. A commit of HEAD loses three things an agent's run leaves behind: edits that are staged, edits that are not, and files git has not been told about (a scratch script, a fixture, a notes file the tests read). A snapshot keeps all three as one commit in the repository's own object store, so that a task captured from history, or a replay checkpoint, can be put back exactly.

## What it does

`desk snapshot create <name>` writes a commit under `refs/desk/snapshots/<name>` with three parents, the way `git stash --include-untracked` shapes its commits:

- the commit's own tree is every tracked file as it is in the working directory, staged or not;
- parent 1 is HEAD;
- parent 2 is a commit whose tree is the index, which is what is staged;
- parent 3 is a root commit whose tree is every untracked file that is not ignored.

Nothing is written to the working directory, the index, the stash, a branch or the config. Objects and one ref are added. The real index is read with `ls-files` and never written: `git write-tree` on it would add a cache-tree extension and change the file's bytes, so the trees are built in scratch indexes outside the repository. File contents are hashed with `--no-filters`, so line endings and attributes are not applied and a restored file hashes the same as the original, on a machine that converts line endings (the tests run with `core.autocrlf=true`).

`desk snapshot restore <name> --into DIR` writes the tracked tree and then the untracked files over it, as bytes, into a directory that must be new or empty and must be outside the repository. It returns a manifest of the sha-256 of every file and checks the directory against it. `list`, `show` and `drop` do what they say.

What it leaves out, with the reason listed and the snapshot marked `partial`:

- files that are credentials by name (`.env` and its variants except `.example`, `.sample`, `.template`, `.dist`; key and certificate files; ssh, aws, gnupg, kube and `.secrets` folders; npm, pypi, netrc and similar login files) and by content (a provider key prefix, a three-part token, a private key header). The looser masking rule the Desk uses for display, any word followed by `token =`, is not used here: in scratch code it matches `token = process.env.TOKEN`, and dropping every such file would leave the snapshot without files a replay needs;
- files that would take the untracked bytes past the cap (25 MiB; `--cap`), taken in path order, each skipped file listed;
- links, directories that are repositories, and names with a newline in them.

A held `index.lock` and an unresolved merge conflict also mark it partial, with what was done about each. A partial snapshot is recorded as such in the capture store (`workspace_snapshots.snapshot_partial`) so a replay from it can say that it was not the whole workspace and diverge rather than pretend.

## What was run

`tests/desk/snapshot.test.ts` (16 tests), in repositories built for the purpose: the three parents; the staged state in parent 2 and the working state in the commit's tree; the real index file, every working file, the status, the stash, the branches and the config unchanged across a snapshot; a clean workspace; refusal of a bad name, a taken name, a repository without a commit and a folder that is not a repository; a held lock and a merge conflict; each credential kind left out and absent from the object store while `.env.example` and a `.pub` key are kept; the cap, in path order; restoration of every file byte for byte (CRLF content, a binary file with every byte value, an empty file, a Unicode name, nested folders), with deleted files absent and ignored files not carried; verification catching a changed, a removed and an added file; restoration after `git gc --prune=now` with reflogs expired; refusal to restore into the repository, into a folder with something in it, from a ref that is not a snapshot and from one without three parents; listing and dropping; and the command line end to end against a capture store. `desk prove` runs the same shape as `workspace-snapshot-restores-every-byte-and-touches-nothing`. Mutation check: letting git convert line endings while storing failed the byte-for-byte restore test.

## Not covered

- **A real owner repository.** Every repository above was made for the test. The snapshot has not been taken of the Desk's own working tree or of another large repository.
- **Execute bits and symbolic links on Windows.** This machine is Windows, where the execute bit is not set by the file system and a link may not be creatable. The restore of the execute bit is tested only where the system has one, and that test did not run here. A link is restored as a link or, failing that, as a file holding its target, with a note; neither was exercised.
- **Submodules and nested repositories.** Left out and listed; not restored.
- **Sparse checkouts, split indexes, and repositories using `git worktree` linked directories.** Not tried.
- **Very large repositories.** The tracked files are read through `git cat-file --batch` in batches of 64 MiB; a repository of many gigabytes was not tried.
- **Sharing.** A ref under `refs/desk/` is carried by `git push --mirror` and by nothing git does by default. The snapshot can hold untracked files the owner never meant to share.
- **The credential scan.** It is a list of names and shapes, not a promise: a secret with no recognisable prefix in a file with an ordinary name is kept.
