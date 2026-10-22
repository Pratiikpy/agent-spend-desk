# Pre-existing components declaration (working draft; confirm before submission)

Purpose: the submission checklist requires every component, data set or code that existed before the 22 Oct 2026 00:00 UTC window to be declared. This file records the facts as of 2026-10-16. It is a working draft: it is updated whenever something is added, and the final text is copied into the README and the submission form.

Repository state. There is no git repository yet and nothing has been committed or pushed. The first commit will be made on or after 22 Oct 2026 00:00 UTC (hook `.claude/hooks/window_guard.py`; the hook covers the assistant's shell tools only, so no other git client, including an editor's git view, is used before then).

| Item | Where | What it is | Created | Status |
|---|---|---|---|---|
| Runtime starter | `src/runtime/canonical.ts`, `errors.ts`, `json.ts`, `schema.ts` (505 lines) | Early local code for canonical JSON, errors, JSON helpers and schemas, written with an AI assistant | 2026-10-13 | Uncommitted, local only. To be either re-created inside the window or declared here as pre-existing. Decision pending with the organizer's written answer on pre-window preparation (open question F13). |
| Design documents | `docs/` | Architecture, blueprints, research profiles, sponsor notes | 2026-10-13 to 2026-10-16 | Uncommitted. Internal working docs (`docs/intel/`, `docs/event/`, `docs/open-questions.md`, review folders) are gitignored by decision D-004. |
| Third-party reference clones | `research/` | Read-only copies of open-source repositories for study | 2026-10-13 onward | Gitignored, never part of the submission; any mechanism taken from them is credited per its licence (see `docs/design/prior-art/profiles/99-synthesis-best-of-by-module.md`). |
| Sponsor material | `meterless/`, `docs/sponsors/` | Organizer and sponsor documents and our notes | 2026-10-13 onward | Organizer originals are local reference only. |
| Tooling | `scripts/secret_scan.py`, `scripts/repo_size_check.py`, `.claude/`, `.cursor/` | Guard scripts, hooks, agent definitions | 2026-10-13 | Part of the repository; AI-assisted, logged in `docs/sponsors/ai-use-provenance-log.md`. |

Not pre-existing: no application code beyond the starter above, no data sets, no trained models.

Open: the organizers' written answer on whether local preparation before the window is eligible (open question F13); whether the runtime starter is kept, rewritten inside the window or removed.
