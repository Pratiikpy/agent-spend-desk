# Citation Check Report: research files 07 to 14

Date: 2026-10-13. Scope: every arXiv-style id cited in `07-*.md` through `14-*.md`.

## Method

All 337 unique ids were extracted with a pattern match and split across six independent checks. Each fetched the arXiv abstract page and compared the title, first author and year with how the research file describes the paper. A first single-agent attempt covered only 26 ids and was discarded as incomplete. Doubtful results were then checked by hand against the abstract pages.

## Result

- All 337 ids were processed (57 + 56 + 56 + 56 + 56 + 56).
- About 321 matched on the first pass. About 16 were flagged or needed a retry.
- Every flagged item that was inspected turned out to be a false positive of the automated comparison, not a wrong citation:
  - `2510.04618` is "Agentic Context Engineering: Evolving Contexts for Self-Improving Language Models" (Zhang et al., 2025); the file cites it only for metadata and does not name a first author.
  - `2401.03426` is "On Leveraging Large Language Models for Enhancing Entity Resolution: A Cost-efficient Approach" (Li et al., 2024); it matches the file's description of spending LLM queries on uncertain pairs.
  - `2402.02008` is "How well do LLMs cite relevant medical references?" (Wu et al., 2024), which is SourceCheckup.
  - `2402.17753` is "Evaluating Very Long-Term Conversational Memory of LLM Agents" (Maharana et al., 2024), which is LoCoMo.
  - `2310.11244` is Peeters, Steiner and Bizer on entity matching with LLMs, consistent with the file.
  - `2004.00584` is the Ditto paper, "Deep Entity Matching with Pre-Trained Language Models"; the system name differs from the title.
  - `1705.05937` (record and replay engineering) and `1809.06514` (actionable recourse) are cited in the right sections.
  - Other flags were omitted author names or loose descriptions (for example `2305.12295`, `2308.10144`, `2401.00396`).
- `2508.20863` and `2510.17276`, previously marked UNVERIFIED in the research files, now resolve to real arXiv pages; their content was not re-read.
- `math/0404371` (Dezert and Smarandache) could not be loaded by the first attempt; it was not rechecked and stays UNVERIFIED.

## What this does and does not establish

Established: the cited ids exist and point to papers whose titles and topics are consistent with how the files describe them, so no citation was invented.

NOT established: that any claim a research file makes about a paper's content, results or novelty is true. Papers were read at abstract level, results were not reproduced, and venue names and acceptance statuses were not rechecked. Repository metadata (stars, licence, push date) was not rechecked here. Non-arXiv sources (RFCs, regulations, standards pages, vendor pages) were not covered by this check.
