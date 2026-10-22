# Submission Checklist

No time limit applies to us. Submission is through HackOS and happens only when Prateek chooses. The only date gate: nothing is committed before 22 Oct 2026 00:00 UTC. Sources: `docs/event/02-faq.md` §7, `03-participant-journey-map.md` §6.2, `01-welcome-guide.md` §9.

Creating the first submission **locks the team**. Do not create it until the team is final.

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
