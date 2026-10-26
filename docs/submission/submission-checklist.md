# Submission Checklist

No time limit applies to us. Submission is through HackOS and happens only when Prateek chooses. The only date gate: nothing is committed before 22 Oct 2026 00:00 UTC. Sources: `docs/event/02-faq.md` §7, `03-participant-journey-map.md` §6.2, `01-welcome-guide.md` §9.

Creating the first submission **locks the team**. Do not create it until the team is final.

## Status on 2026-10-26

Code, tests and checks: every numbered feature but DF-121 is built (128 of 129); `desk prove` is 60 PASS, 0 FAIL, 0 NOT RUN and the suite is 2,655 tests, both from fresh clones on Windows 11 (Node 24.20) and Ubuntu 22.04 (Node 22.23) at `4485f52`, logs in `docs/verification/clean-room/`. The deck PDF was rendered again on 2026-10-26 from `deck.html` (25 slides). The video script, README and product description match the build. What follows is the 2026-10-23 status, still true where it names things only Prateek can do: the video upload, the HackOS submission and team, the Cursor log (DF-121), and the two links checked logged out.

## Status on 2026-10-23 (what exists, what is not done, what only Prateek can do)

Done and checked: slide deck (`docs/submission/deck/deck.html` and `desk-deck.pdf`, 25 slides with the architecture diagram, the stack, both sponsors' use, product screens, the head-to-head and canary evidence, what is not proven); sponsor technology explanation; README run from a fresh clone (verified on Windows 11 and Ubuntu 22.04, Node 22 and 24); sample inputs and a cleaned trace under `input_examples/` and `output_examples/`; `desk prove` with the checks listed in the README; secret scan on the tree and on history; size check.

Uploaded (https://youtu.be/dsRGX73lZAQ, unlisted): a 3:56 captioned motion-graphic video (`scripts/demo-video-motion/`, rendered with Remotion; the render of 2026-10-26 is outside the repository). Every figure in it is read from a real run or a committed result file, it has no voice, and the scene-by-scene script is `demo-video-script.md`. The older screen recording (`scripts/demo-video/`) is not to be uploaded: its title card claims Cursor use the repository does not support.

Not done, and only Prateek can do it:
- Upload the video and put its link in the HackOS form; create the submission (it locks the team); choose Track 3.
- Cursor: the required IDE. No Cursor session is logged in `docs/sponsors/cursor-usage-log.md`; the explanation claims none. Work in Cursor and log real sessions, or accept a weaker sponsor score.
- Zetaris and Meterless "running on your machine" as an eligibility condition is unconfirmed by the organisers.
- Instruction files (`CLAUDE.md`, `AGENTS.md`, `.claude/`) are kept local and ignored by git; they are not in the repository or its history.
- Check the repository link while logged out, and the video link in a private window.

## A. Required components

- [ ] **Demo video**, 1–4 minutes, uploaded and playable from a logged-out browser
  - [ ] shows the main workflow end to end
  - [ ] shows how the agent solves the selected challenge
  - [ ] shows key features
  - [ ] shows **how Zetaris is integrated**
  - [ ] shows **how Meterless is integrated**
  - [ ] recorded from a real run (no hardcoded path); logs or traces visible
- [ ] **Slide deck** complete: problem and users · solution · agent workflow/architecture · technical stack · how Zetaris and Meterless were used · what was unique about the sponsor usage · product visuals · future enhancements
- [ ] **GitHub repository** link works while logged out
  - [ ] all source present
  - [ ] README covers setup, usage, dependencies
  - [ ] Colab links included if agents run in Colab
- [ ] **Sponsor technology explanation** covers: Zetaris · Meterless · how Cursor was used · where NVIDIA contributes · what was unique · (bounty only) how Bright Data collected or scraped data

## B. Form declarations

- [ ] Primary track selected (exactly one)
- [ ] Pre-existing components declared (product code, data prepared before 22 Oct)
- [ ] Team members correct and complete

## C. Repository gates

- [ ] `python scripts/secret_scan.py` passes on the working tree **and** on git history
- [ ] `.env` is gitignored; `.env.example` has placeholders only
- [ ] `python scripts/repo_size_check.py` passes (no large files, archives, checkpoints)
- [ ] No files that look personal or unprofessional; `docs/event/` is not in the repo
- [ ] `data/README.md` documents every source: URL, licence, subset, record count, how to regenerate, limitations
- [ ] `input_examples/` and `output_examples/` present, with at least one committed sample trace in `output_examples/traces/`
- [ ] Commit history is clean and professional; first commit is after 22 Oct 00:00 UTC

## D. Clean-room run (do not skip)

- [ ] Fresh clone in an empty directory, following the README literally, on a machine or user profile that has never run the project
- [ ] Runs with `SAMPLE_MODE=true` and no sponsor credentials, degrades gracefully, produces useful output
- [ ] Runs with real credentials, produces the headline output
- [ ] A full agent run stays predictable and bounded (organizer target 5–10 minutes)
- [ ] No manual data steps, no runtime package installs
- [ ] Each external dependency killed in turn: system degrades gracefully, logs say why

## E. Quality gates

- [ ] Judge-simulator review done in the last 24 hours; every item scoring below 3 either fixed or consciously accepted in `docs/DECISIONS.md`
- [ ] Discount triggers all clear (see `docs/evaluation/judging-rubric-and-self-scoring.md`)
- [ ] Every claim in README, deck and video is backed by something a judge can inspect
- [ ] Limitations stated plainly; no overclaiming accuracy, safety or production readiness

## F. After submitting

- [ ] Open the submission as a judge would; click every link; play the video
- [ ] Re-clone from the submitted repo link and run once
- [ ] Note the submission timestamp in `docs/DECISIONS.md`
- [ ] Any push after submitting is re-checked with the same gates

## Not covered by this checklist (unknown until HackOS is read)

The submission form's exact fields, file-size limits for the video, and whether the deck must be a specific format. See `docs/open-questions.md` F11.
