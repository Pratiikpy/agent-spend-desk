# Clean-room runs: the logs

A clean-room run is a fresh clone of one commit, with nothing carried over from the working tree, taken through install, typecheck, the whole test suite and `desk prove`. The README says a commit was verified this way; these are the logs that say so, kept so that the claim can be read and not only believed.

## 2026-10-25, commit `9d9f620`

| | Windows 11 | Ubuntu 22.04 (WSL2) |
|---|---|---|
| Node | 24.20.0 | 22.23.2 |
| Log | `2026-10-25-windows-11-node-24.20.log` | `2026-10-25-ubuntu-22.04-node-22.23.log` |
| `npm ci` | installed from the lock file | installed from the lock file |
| `npx tsc --noEmit` | clean (`TSC OK`) | clean (`TSC OK`) |
| `npx vitest run` | 110 files, 1,451 tests passed | 110 files, 1,450 tests passed, 1 skipped |
| `desk prove` | 35 PASS, 0 FAIL, 0 NOT RUN | 35 PASS, 0 FAIL, 0 NOT RUN |

The skipped test on Ubuntu reads a PDF invoice twice and needs `pdftotext`, which that machine does not have. The card's figures hash is the same in both logs (`sha256:797c813a83e0`).

Each log was made by this sequence, in a new directory that held nothing else:

```
git clone <the working repository> <fresh directory>
cd <fresh directory>
git rev-parse --short HEAD            # printed as the first line
npm ci
npx tsc --noEmit                      # prints TSC OK when it is clean
npx vitest run                        # the file and test counts, and VITEST EXIT
npm run desk --silent -- prove        # every check, and PROVE EXIT
```

The logs have their colour codes removed and nothing else changed.

## What these runs do not cover

- Node 22.19 (the oldest the package allows) and macOS were not run. Windows ran on Node 24.20 and Ubuntu on Node 22.23.
- A clone of the working repository on the same machine is not a clone from GitHub: no network fetch of the repository was involved. The model route was the recorded one (`SAMPLE_MODE`), as `desk prove` runs it, so these runs say nothing about a live model.
- They show that this commit passes its own checks on two operating systems. They do not show that the checks are enough; the notes in the folder above this one say, feature by feature, what each check does not cover.
- Two runs were made at once on the same machine, as the earlier verification was, and the timing-sensitive checks passed under that load. A slower machine is not tested.

A first attempt at the Windows run the same evening failed at `npm ci` because an earlier run's `desk prove` was still holding files in the same directory; it was discarded and the run repeated in a clean directory. That attempt is not a result and is not in this folder.
