# AI-Use Provenance Log

Purpose: a dated, honest record of where generative AI was used in this project, so a funder or organizer can see it, and so a prompt provenance log exists from the start. Some funders require disclosure of generative-AI use and a log of the model, the dates and times, the prompts and the unedited outputs; none can be reconstructed afterwards. Entries are appended, never edited.

How to keep it. For every working session record: date and time range (UTC), tool and model, purpose, which files were created or changed, whether any code was generated, human review applied, and where the full unedited transcript is archived. Full transcripts are stored outside the repository in a private archive and referenced by file hash; the repository holds this index only.

## What exists so far (reconstructed 2026-10-13; the transcripts below are not in the repository)

| Date (UTC) | Tool and model | Purpose | Outputs touched | Code generated | Transcript |
|---|---|---|---|---|---|
| 2026-10-13 | Claude Code (Sonnet 5.5) | Read the organizer documents; create the project structure, instruction files, guard scripts and hooks; clone 38 reference repositories; coordinate sub-agents that wrote prior-art teardowns, research notes, sponsor readouts and a coverage matrix; write and revise the architecture specification and decision log | `CLAUDE.md`, `AGENTS.md`, `.cursor/rules/`, `.claude/`, `scripts/`, `docs/` | Guard scripts only (Python); an abandoned TypeScript starter that is discarded | Claude Code session transcript, to be archived with its hash |
| 2026-10-13 | Sub-agents of the above (default model; some on a smaller model for mechanical checks) | Per-repository teardowns, per-module research, citation checks, consistency scans, adversarial review | `docs/design/prior-art/`, `docs/sponsors/*-readout.md`, `docs/evaluation/reviews/` | None | Per-agent transcripts in the same session archive |
| 2026-10-13 | Two other assistants (a Google model and an OpenAI model; versions not recorded) used by Prateek | Independent reviews of the architecture, pasted back into the session | Informed `docs/DECISIONS.md` D-009 and D-011 | None | Not held in this project; to be exported by Prateek and archived |

## Actions outstanding

- Archive the Claude Code session transcript(s) and the two review conversations to a private location, record their hashes here.
- Cursor became optional on 22 October 2026 and was not used; `docs/sponsors/cursor-usage-log.md` stays empty and claims nothing.
- State in any grant text which period is covered by this log and which earlier period, if any, is not.

## Entry template

| Date (UTC) | Tool and model | Purpose | Outputs touched | Code generated | Human review | Transcript hash |
|---|---|---|---|---|---|---|
|  |  |  |  |  |  |  |


## Entry 2026-10-16: 56-repository profile pass

| Date (UTC) | Tool and model | Purpose | Outputs touched | Code generated | Human review | Transcript hash |
|---|---|---|---|---|---|---|
| 2026-10-16 | Claude Code (Sonnet 5.5) as reviewer and writer; Haiku subagents (low effort) and the Gemini CLI (agy, plan mode, local files only) as readers | Per-repository profiles of 56 reference repositories (architecture, features, real use, mechanism, agent patterns, model and data layer, hackathon-care checks, traps, reuse, verdict); reviewer spot-checked at least three cited facts per profile against the code and wrote every verdict | `docs/design/prior-art/profiles/`, `docs/design/00-architecture-master-spec.md` (v5.2), `docs/design/07-product-requirements-and-feature-list.md`, `docs/design/modules/98-profile-pass-additions.md`, `docs/DECISIONS.md` (D-026) and related notes | None (documents only; third-party code was read, not copied) | Spot-checks recorded in each profile header; verdicts written by the reviewer | Not archived |
