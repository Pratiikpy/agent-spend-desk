# Profile: VectifyAI/PageIndex

Reader: Haiku (low effort), 2026-10-16, about 130 seconds, 92k tokens, 26 tool calls. Shallow clone (depth 1), deleted after the profile pass. Paths relative to `pageindex/` unless stated.

Spot-check (reviewer, against the files): MIT licence (confirmed); the constant `FLAT_TREE_MAX_NODES = 10` and a check on flat trees built from pages at `flash/api.py:16,178` (confirmed; what happens next, cloud rejection against local acceptance, is the reader's account); the package has a flash extractor, a local API, a local chat loop, agent tools, a client, cloud API and errors module (confirmed by listing). The 98.7% accuracy on FinanceBench, the per-page cost and the cost-saving chart are the project's own README claims and were not checked: NOT VERIFIED. Result: PASS on structure; benchmark claims unverified.

## 1. What it is
A "vectorless" retrieval approach: build a hierarchical table-of-contents tree for a long document, then let a model reason over the tree to pick sections, and fetch the pages. MIT; the company also sells a hosted version.

## 2. Architecture map
Flash extraction (layout-based tree from PDF geometry with no model call at index time), a local API and store, a local chat loop, an agent tool contract (`browse_documents`, `get_document_structure`, `get_page_content`, `remove_document`), a client for local and cloud modes, model routing through LiteLLM.

## 3. Features and how each behaves
Input is a PDF. Output is a list of nodes with title, start and end page, optional summary and children; a field says how the structure was found (detected outline, bookmarks, hybrid, plain pages, unreadable). Failure behaviour: bad headers, empty and encrypted files are rejected; with no headings the tree falls back to one node per page. Retrieval returns page text with a citation tag naming document, page and block.

## 4. How people use it
`pip install pageindex`, create a client with a storage path, submit a document, ask a question. Streaming chat with optional display of reasoning and tool calls. Tests cover the client, tools, extraction and chat. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M2 document tree and cross-references)
Heading level is the smaller of the style rank and the numbering depth, capped at 6; each node's end page is the next heading's start minus one, promoted to the subtree maximum for parents. A tool-first agent reads the outline, then asks for specific page ranges. State per document: the tree, page-to-node map and metadata. Lost in local mode: OCR, images and block-level structure.

## 6. Agent patterns
One agent with a two-step retrieval pattern; errors return a structured message with suggested next steps; no critic loop, no confidence signal.

## 7. Model and data layer
Separate model slots for indexing and for chat; any provider through LiteLLM; local file storage or the hosted service.

## 8. Hackathon-care checks
Flash mode runs offline and deterministically; chat needs a model key; no Docker file; no JSONL trace seen. Benchmark and cost figures are the vendor's.

## 9. Traps seen
A test fixture with stub summaries is not a real index; summaries fixed at index time may not suit different questions; flat documents above ten pages are handled differently by the hosted and local paths; scanned PDFs are not read locally.

## 10. Reuse
MIT: copy with credit. Candidate parts: layout-based heading detection, the tree schema with node ids and page ranges, the tool contract, the error envelope with next steps.

## 11. Verdict: ADAPT for M2 (and the spec's document tree)
Copy: (1) a deterministic, model-free structure pass: headings from style and numbering, page ranges per node; (2) the outline-first tool pattern: show the tree, then fetch only chosen pages; (3) errors that tell the caller what to do next.
Avoid: (1) summaries fixed at index time: ours are produced per question and stored with the question; (2) rejecting or degrading flat documents without saying so: record the structure source; (3) benchmark numbers quoted from the vendor: we publish only our own measured results.
Where we are already ahead: each cited span has a stored text-layer hash and offsets that re-verify offline.
