# Prior art 14: document intelligence and the evidence interface

Scope: (A) ingestion of contracts, audits, certificates, invoices and filings with verifiable page and character-offset locators; (B) evidence and explanation UI. Written against `00-architecture-master-spec.md` sections 6, 6a, 9, 14.

## 0. Method and limits

- Dates: every repo number below came from `gh api repos/OWNER/NAME` and every paper, spec or doc page from a WebFetch, both on 2026-10-13. Source files were read through raw GitHub or `gh api` only. Nothing was cloned or installed, and nothing was run, so **no accuracy or speed number for any parser was measured here**. Vendor and paper numbers are quoted as claims.
- The web-search budget ran out part-way through. Items that needed a further search are marked UNVERIFIED or left out (section 12).
- "Stars, licence, pushed" are as of the check date. `NOASSERTION` means GitHub could not classify the licence; the real terms are described where I read them.

## 1. Findings in ten lines

1. No extractor surveyed hands back a ready-made "page + character offset + glyph box + proof" locator. pdf.js gives per-item text with a transform and no per-character data (`TextItem` fields: `str, dir, transform, width, height, fontName, hasEOL`). Docling gives `page_no, bbox, charspan`, but `charspan` is relative to one item's text and I saw `(0, 0)` placeholders in several code paths. We must define our own locator and prove it.
2. The locator must be defined over a canonical text layer that we own, hash and ship in the dossier. Offsets into an extractor's private string, or into Markdown, are not stable evidence.
3. The text layer is also the attack surface. pdf.js `getTextContent` returns no colour, render mode, opacity or clip, so it cannot tell white-on-white text from body text. PyMuPDF `get_texttrace`, pdfplumber `non_stroking_color`, pdf.js `getOperatorList`, and PDFium `FPDFText_GetFillColor` can.
4. Hidden instructions in documents are measured in the wild: 18 manuscripts (Lin, CACM 2026) and roughly 1% of about 200,000 resumes (arXiv 2605.28999), more than 90% of which carry no explicit instruction wording.
5. Classifiers on extracted text are weak: CrackedPDFs reports that PromptGuard "has low recall when given extracted text only". The primary defence has to be architectural plus a per-character visibility verdict.
6. Digital signatures prove byte integrity of a signed revision, not that what a viewer displays is what was signed (Shadow Attacks). A revision-diff check is needed.
7. Citation UIs raise trust without raising correctness: citations alone, even random ones, increased trust, and checking them lowered it (AAAI 2025). Our UI must show a **computed verification state**, not the presence of a citation.
8. Parser benchmarks are saturated or skewed on text similarity; none surveyed scores locator round-trip fidelity (UNVERIFIED as a negative; see section 12).
9. Anthropic's Citations API pattern (the system fills `cited_text`, the model only points) is the right pattern, but it is not usable in the NVIDIA sponsor run and its PDF mode is page-level only. We copy the pattern, not the API.
10. A small, honest scope wins: line-level highlight promised only where measured locator accuracy supports it, as the master spec already says.

---

# PART A. DOCUMENT INTELLIGENCE

## A1. Locator contract (our design, built from the items below)

`SourceLocator` (immutable, content-addressed):

- `docSha256` of the original bytes; `revision` (index of the PDF incremental-update revision used).
- `layer`: `{extractor, version, configHash, normalisation, unit}` and `layerSha256` of the canonical text layer file. `unit` is fixed at Unicode code points (JS strings are UTF-16, so conversion is tested, not assumed).
- `page` (1-based, as in RFC 8118 `page=`), `start`, `end` (0-based, exclusive end, same convention as W3C `TextPositionSelector` and Anthropic `char_location`), taken over the **visible** layer only.
- `quote`: `exact`, `prefix`, `suffix` (W3C `TextQuoteSelector`).
- `quads[]`: glyph-union boxes in PDF user space with page box, rotation and CropBox recorded, so a viewer draws from stored geometry and never re-searches.
- `spanSha256` of the exact UTF-8 bytes of `exact`; `provenanceClass` in `native | ocr | vlm`; `visibility` verdict summary; `sanitiserReportSha256`.
- Verification levels, each independently checkable: L1 (offline, no parser) the slice of the shipped layer equals `exact` and hashes to `spanSha256`; L2 re-run the pinned extractor on the PDF and regenerate `layerSha256`; L3 differential extraction (a second, independent extractor agrees on the text at `quads`); L4 render the quads, OCR the crop, compare to `exact` (catches font/ToUnicode divergence and hidden or replaced text).
- Fuzzy relocation is allowed only as an explicit `relocated` state that is shown, never as `verified`.

## A2. Extractors and parsers

### A2.1 pdf.js and pdfjs-dist (Node via the legacy build)
- What: Mozilla's PDF renderer and text extractor; the same engine draws the viewer in part B.
- Verified: `mozilla/pdf.js` 53,998 stars, Apache-2.0, pushed 2026-10-13. The `mozilla/pdfjs-dist` mirror is archived (pushed 2024-07-04) but the npm package `pdfjs-dist` is at 6.4.299, Apache-2.0, repository field `mozilla/pdf.js`. https://github.com/mozilla/pdf.js
- Idea: `getTextContent({disableNormalization})` exists (so normalisation can be switched off and recorded); `getOperatorList()` exposes `OPS.setTextRenderingMode`, `setFillRGBColor`, `setFillGray`, `constructPath`, `clip`, `beginMarkedContentProps`; `getJSActions`, `getAttachments`, `getOptionalContentConfig`, `getMetadata` exist on the document.
- Use: the in-process Node extractor candidate and the browser viewer; walk the operator list to build a per-glyph visibility verdict; the structural scan reads JS actions, attachments and optional-content state without executing anything.
- Limits: text items are runs, not characters, so per-character offsets and boxes are derived by us (interpolating width over the run is an approximation to measure, not assume); no colour or opacity in the text API; the legacy-build and worker details for Node were not tested here (UNVERIFIED).

### A2.2 PDFium family: pdfium-binaries, hyzyla/pdfium, pdfium-render, LiteParse
- What: Chromium's PDF engine and wrappers. LiteParse is a Rust-core parser with Node (napi-rs), Python and WASM bindings that uses PDFium for text and Tesseract for selective OCR.
- Verified: `bblanchon/pdfium-binaries` 1,490, MIT, 2026-10-12; `hyzyla/pdfium` 190, MIT, 2026-10-10 (TypeScript, browser and Node); `ajrcarey/pdfium-render` 713, NOASSERTION, 2026-10-08; `run-llama/liteparse` 12,842, Apache-2.0, 2026-10-12, npm `@llamaindex/liteparse` 2.15.1. https://github.com/run-llama/liteparse
- Idea: the PDFium header exposes `FPDFText_GetFillColor`, `GetStrokeColor`, `GetCharOrigin`, `GetLooseCharBox`, `GetCharAngle`, `FPDFText_HasUnicodeMapError`, `IsGenerated`, `IsHyphen`, and `FPDFTextObj_GetTextRenderMode` (read from the PDFium public headers). `HasUnicodeMapError` and `IsGenerated` are direct "this character is not what it seems" signals.
- Use: PDFium as the second, independent extractor for differential extraction (L3), and as the renderer for L4 and the contrast test. LiteParse is the cheapest way to get an in-process PDFium plus bounding boxes in Node, with worker-pool hard timeouts, which our injection model wants.
- Limits: the `hyzyla/pdfium` WASM build exports only `FPDFText_LoadPage/ClosePage/CountChars/GetText` and `FPDFTextObj_GetText` in its vendored typings, so per-character geometry and colour need a custom WASM build or the Rust and Python bindings (verified from its `vendor/pdfium.d.ts`). LiteParse reconstructs layout by "grid projection", so its text is a derived string, and its README speed claim (about 2 to 5 ms per page) is a vendor claim, not measured. Its JSON field names were not read (UNVERIFIED).

### A2.3 PyMuPDF and MuPDF
- What: fast Python bindings to MuPDF with rich text and drawing introspection.
- Verified: `pymupdf/PyMuPDF` 10,896, **AGPL-3.0** (commercial licence from Artifex), pushed 2026-10-13; `ArtifexSoftware/mupdf` 2,997, AGPL-3.0. https://github.com/pymupdf/PyMuPDF
- Idea: `Page.get_texttrace()` returns per span `bbox`, per-character `(unicode, glyph id, origin, bbox)`, `color`, `opacity`, `type` (span type), `layer` (optional-content group name), `size`, `seqno` (draw order, so a later opaque rectangle from `get_drawings()` can be shown to cover earlier text). That is the richest visibility oracle I found in the sources.
- Use: **test oracle and corpus tool, not a product dependency**: it labels hidden-text ground truth for the sanitiser benchmark and cross-checks bounding boxes.
- Limits: AGPL obligations on anything shipped or served; keep it out of the core and out of the judge-run path unless a licence decision is made (Prateek decision, not mine).

### A2.4 pdfminer.six and pdfplumber
- What: pure-Python layout analysis (`LTChar` etc.) and a friendlier wrapper.
- Verified: `pdfminer/pdfminer.six` 7,037, MIT, pushed 2026-03-13; `jsvine/pdfplumber` 10,810, MIT, 2026-08-06. https://github.com/jsvine/pdfplumber
- Idea: pdfplumber char objects carry `fontname`, `upright`, `stroking_color` and `non_stroking_color` (README table), so white-on-white is a one-line filter.
- Use: a Python-side independent extractor for differential testing inside the isolated step; a labelling aid.
- Limits: slow on long documents (not measured here); no OCR; no hidden-by-occlusion logic.

### A2.5 Docling, docling-parse, docling-core, docling-serve, docling-eval
- What: IBM-origin document conversion. `docling-parse` extracts text, paths and bitmaps with coordinates at char, word and line level from programmatic PDFs; the pipeline adds DocLayNet layout and TableFormer table models and emits a `DoclingDocument`.
- Verified: `docling-project/docling` 68,811, MIT, 2026-10-13; `docling-parse` 341, MIT, 2026-10-13; `docling-core` 293, MIT, 2026-10-13; `docling-serve` 1,858, MIT, 2026-10-13; `docling-eval` 79, MIT, 2026-07-16. Papers: Docling Technical Report https://arxiv.org/abs/2408.09869 (Aug 2024); Docling toolkit paper https://arxiv.org/abs/2501.17887 (listed in search; abstract page not fetched, so treat as UNVERIFIED beyond its title).
- Idea: `ProvenanceItem` holds `page_no`, `bbox`, `charspan`; docling-parse README confirms char, word and line cell levels with `ContentLevel` switches (char cells are skipped by default and must be requested).
- Use: the optional isolated Python step, behind `docling-serve` or a subprocess, producing layout, tables and reading order, with its output reduced to our `SourceLocator` contract and re-verified at L1 to L3 (we never trust its `charspan`).
- Limits: heavy install (models), Python; `charspan` semantics are per item, with `(0, 0)` placeholders in several `docling-core` paths I saw; layout models are probabilistic so reading order can be wrong without any error signal.

### A2.6 Marker
- What: PDF to Markdown and JSON using Surya models. `datalab-to/marker` 40,421, Apache-2.0 code, pushed 2026-10-02. https://github.com/datalab-to/marker
- Licence caveat read from its README: model weights are under a modified OpenRAIL-M, free for research, personal use and startups under USD 5M funding or revenue, commercial use beyond that is paid.
- Use: a quality comparison point; its Markdown output has no offset contract, so it enters the benchmark only through a geometry-bearing JSON mode (field names UNVERIFIED).
- Limits: weights licence; GPU-leaning; not a locator source by default.

### A2.7 MinerU
- What: a large document-to-Markdown/JSON system with its own 1.2B model, MinerU2.5 (paper https://arxiv.org/abs/2509.22186, Sept 2025, coarse-to-fine two-stage parsing). `opendatalab/MinerU` 81,637 stars, pushed 2026-10-12. https://github.com/opendatalab/MinerU
- Licence read from `LICENSE.md`: Apache-2.0 plus extra terms (a separate licence is needed above 100 million monthly active users or USD 20 million monthly revenue, plus an online-service attribution obligation). GitHub reports `NOASSERTION`. Section 2 and onward were not read in full (UNVERIFIED).
- Use: benchmark candidate for scanned and complex pages. Its "state of the art" wording is the paper's claim.
- Limits: custom licence terms need a compliance read; heavy; output geometry schema not read.

### A2.8 Unstructured, Kreuzberg, open-parse, grobid
- Unstructured: `Unstructured-IO/unstructured` 15,562, Apache-2.0, 2026-10-10; its changelog mentions element `coordinates` metadata. Kreuzberg: `kreuzberg-dev/kreuzberg` 9,406, MIT, 2026-10-13, "polyglot document intelligence with a Rust core". open-parse 3,149, MIT, 2026-05-17. grobid 5,172, Apache-2.0, 2026-10-13 (scholarly PDFs; irrelevant to our document types). unpdf (unjs) 1,243, MIT, 2026-08-14 is a pdf.js wrapper for all JS runtimes.
- Use: Unstructured and Kreuzberg are cheap extra rows in the benchmark. Their offset and geometry output was not read, so no claim is made (UNVERIFIED).

### A2.9 OCR engines and VLM OCR
- Classical: Tesseract (`tesseract-ocr/tesseract` 76,965, Apache-2.0, 2026-10-10; TSV and hOCR outputs documented in tessdoc), docTR (6,385, Apache-2.0, 2026-10-13), PaddleOCR (91,026, Apache-2.0, 2026-09-16), Surya (21,492, Apache-2.0 code, 2026-09-11; model-weight licence not read, UNVERIFIED), OCRmyPDF (35,009, MPL-2.0, 2026-10-12, "adds an OCR text layer to scanned PDF files").
- VLM OCR: olmOCR (19,737, Apache-2.0, 2026-03-25; paper https://arxiv.org/abs/2502.18443 and olmOCR 2 https://arxiv.org/abs/2510.19817 trained with unit-test rewards), DeepSeek-OCR (24,009, MIT, 2026-01-27; paper https://arxiv.org/abs/2510.18234 claims 97% decoding precision below 10x compression and about 60% at 20x), PaddleOCR-VL (https://arxiv.org/abs/2510.14528, 0.9B model, 109 languages, in the PaddleOCR repo), dots.ocr (9,172, MIT, 2026-03-24), chandra (12,494, Apache-2.0, 2026-06-26), zerox (12,253, MIT, last push 2025-05-20).
- Idea: word boxes with confidences from Tesseract TSV, docTR or PaddleOCR give a legitimate `provenanceClass: ocr` locator; free-running VLM transcription gives text with **no glyph geometry and no confidence**, and VLMs can drop or invent content with no error signal.
- Use: OCR is a declared, labelled path (master spec 6a). VLM output is admissible as a **reading aid** whose spans are re-anchored against classical-OCR word boxes by exact match, else marked `vlm_unanchored` and never used as decision evidence.
- Limits: DeepSeek-OCR's compression-precision numbers are the paper's own and the benchmark behind the 97% was not identified in the fetched abstract.

### A2.10 ColPali and visual retrieval
- What: embeds page images directly (https://arxiv.org/abs/2407.01449, ICLR 2025, with the ViDoRe benchmark). `illuin-tech/colpali` 2,831, MIT, 2026-09-21; `vidore-benchmark` 278, MIT.
- Use: optional page-level recall when text extraction fails (stamps, charts, scans).
- Limits: returns pages and patch similarities, not character offsets or quotes. It cannot be a citation source; a hit must be converted by OCR plus L4 before it counts as evidence.

## A3. Benchmarks for document parsing, and their flaws

- **OmniDocBench** (CVPR 2025, https://arxiv.org/abs/2412.07626; repo 2,104 stars, Apache-2.0, 2026-09-11): nine document sources, 19 layout categories, 15 attribute labels. Critique found: the LlamaIndex post "OmniDocBench is saturated" and the nanonets post argue edit-distance scoring is dominated by linearisation choices (reached through search snippets, not fetched, UNVERIFIED). A reported audit of 2,580 annotation errors in 21,353 blocks (12.08%) could not be traced to a fetched source: UNVERIFIED, do not cite.
- **olmOCR-Bench** (inside https://arxiv.org/abs/2502.18443; 1,400 PDFs claimed): binary unit tests. A review by LlamaIndex (fetched, 2025-12-04, https://www.llamaindex.ai/blog/olmocr-bench-review-insights-and-pitfalls-on-an-ocr-benchmark) lists: about 56% arXiv-sourced, no invoices or forms, table tests only check "cell X above cell Y", exact-substring brittleness, header/footer exclusion, and ground truth generated with Sonnet 3.7 and Gemini 2.0 Flash. That review's authors sell a competing parser, so read it as an interested party.
- **ParseBench** (https://arxiv.org/abs/2604.08538, Apr 2026; repo `run-llama/ParseBench` 600 stars, Apache-2.0, 2026-10-12): about 2,000 human-verified enterprise pages, five dimensions (tables, charts, content faithfulness, semantic formatting, visual grounding), 14 methods, top score 84.9% for the authors' own LlamaParse Agentic, "no method is consistently strong". Same vendor conflict as above. What its visual-grounding metric measures was not read (UNVERIFIED).
- **PureDocBench** (https://arxiv.org/abs/2605.07492, May 2026, revised Sept 2026): 1,475 pages, matched clean, degraded and real-world versions, 58 models, best 79.69/100, mean 63.84. Useful because it holds content fixed across degradations.
- **Task datasets with spans**: CUAD (https://arxiv.org/abs/2103.06268, over 13,000 expert annotations; repo `TheAtticusProject/cuad` 569 stars, licence field empty, so reuse terms are UNVERIFIED), ContractNLI (https://arxiv.org/abs/2110.01799, 607 contracts, entailed/contradicted/neutral plus evidence spans; repo CC-BY-4.0), DocILE (https://arxiv.org/abs/2302.05658, 6.7k annotated business documents, 100k synthetic, 55 classes, KILE and LIR tasks; repo `rossumai/docile` 157, MIT, 2026-08-24; dataset terms UNVERIFIED), DocLayNet (465 stars, NOASSERTION).
- **Critical reading**: every benchmark above scores text or structure similarity against its own ground truth. None scores "does the citation `(page, start, end)` select the glyphs a human would highlight". Our own benchmark (A4) therefore needs a corpus whose character-to-glyph ground truth is known by construction.

## A4. A measured plan for choosing the parser (page + character-offset locators, Node first)

**Corpus (all licence-checked before commit; generated files are ours).**
- G1 generated born-digital: contracts, audit reports, certificates and invoices typeset from a seeded generator through two independent typesetters (headless Chromium print and a LaTeX or LibreOffice path). Ground truth `(char range -> glyph boxes)` is known by construction (DOM `Range.getClientRects` for the HTML path), so no human labels are needed. Include repeated clauses, boilerplate duplicates across vendors, two-column and three-column layouts, tables with merged cells, headers and footers, footnotes, hyphenation, ligatures, RTL and CJK fragments, rotated pages, and CropBox/MediaBox mismatch.
- G2 degraded copies of G1: rasterised at several dpi with skew, noise and JPEG, saved as image-only PDFs (scan simulation) and as PDFs with an OCR text layer (invisible text, so the legitimate-invisible case is represented).
- G3 real public documents under verified reuse terms (EDGAR filings are the likely source; reuse terms are listed NOT VERIFIED in the master spec, so G3 stays uncommitted: hashes only).
- G4 malformed and hostile: fuzzed xref, truncated streams, encrypted, huge page counts, deep object nesting, zip-bomb-like streams, and the hidden-text families of A5.
- Public sets used as external checks, not as the arbiter: CUAD and ContractNLI span data (text-level), DocILE (invoice boxes), OmniDocBench, olmOCR-Bench, ParseBench, PureDocBench for sanity ranking against the published numbers.

**Candidates.** Tier-1 in-process Node: pdf.js (legacy build), LiteParse (PDFium), PDFium via a custom WASM export of the char API. Tier-2 isolated Python: docling-parse alone, full Docling, pdfplumber, PyMuPDF (oracle), Marker, MinerU. Tier-3 OCR: Tesseract TSV, docTR, PaddleOCR, Surya, and VLM OCR as reading aid only.

**Metrics (primary first).**
1. **Silent-wrong rate**: fraction of locators that pass the extractor's own checks yet select wrong text or wrong glyphs. A typed failure is cheap; a silent wrong span is the defect that costs the product its claim. Must be 0 on G1 for any extractor allowed to issue `verified` locators.
2. **Locator round-trip exact match (M1)**: gold range -> candidate range -> normalised text equals gold. Reported per document type and layout stratum.
3. **Box fidelity (M2)**: IoU of the candidate quad union against gold glyph boxes; report mean, 5th percentile, and the fraction at IoU >= 0.9.
4. **Reading order (M3)**: count of gold clauses split or interleaved by column order; Kendall tau over blocks.
5. **Repeated-clause disambiguation (M4)**: fraction of gold spans whose `(exact, prefix, suffix)` resolves to exactly one position in the layer.
6. **Determinism (M5)**: byte-identical canonical layer across three runs, two operating systems and two Node or Python patch versions.
7. **Honest failure (M6)**: on G2 image-only and G4 malformed, rate of typed failure vs silent empty vs silent garbage.
8. **Differential agreement (M7)**: agreement between the two Tier-1 extractors per span; used as a runtime signal, so its false-alarm rate on G1 must be low and known.
9. **Cost**: p50 and p95 latency, peak RSS, cold start, timeout rate, install size, native-binary count, runtime install needs (the master spec forbids runtime installs), and licence class.
10. **Hidden-text verdict (M8)**: A5 precision and recall per technique.

**Statistics.** Cluster bootstrap over documents (not pages), 95% intervals as in the spec's section 12. Publish confusion cases, not only means. Run each stochastic or model-based candidate three times and report the worst, per the spec.

**Decision rule (proposal, to be fixed before running).** Born-digital path: the Tier-1 extractor with silent-wrong rate 0 on G1, the highest M1 lower bound, and acceptable cost; the other Tier-1 becomes the differential partner if M7 is useful. Layout, tables and scans go to the Tier-2/3 candidate that wins on M1 to M3 for those strata, and any stratum where no candidate's lower interval bound clears the pre-registered threshold gets page-level highlights only. Thresholds (suggested: M1 lower bound >= 0.98 for line-level promise) are proposals and must be committed before the run.

## A5. Hidden-text and injection-carrier sanitiser for PDFs

**Evidence base (verified).**
- Lin, "Hidden Prompts in AI-Assisted Peer Review", CACM 69(7) 2026, https://arxiv.org/abs/2507.06185: 18 manuscripts with hidden instructions via white text and microscopic fonts, four categories of prompt.
- arXiv 2605.28999 (https://arxiv.org/abs/2605.28999): about 200,000 real resumes, about 1% with hidden injections, growing over time, over 90% without explicit instruction wording (so keyword filters fail).
- CrackedPDFs (https://arxiv.org/abs/2607.19396, July 2026): 29,322 PDFs from 4,983 base documents; hybrid detector F1 0.960 held-out, but "PromptGuard has low recall when given extracted text only", a text-only TF-IDF model scores perfectly yet fails shortcut audits, and the authors state results "do not show broad real-world robustness". Treat its detector numbers as in-distribution.
- Greshake et al., indirect prompt injection (https://arxiv.org/abs/2302.12173); OWASP LLM01:2025 (https://genai.owasp.org/llmrisk/llm01-prompt-injection/): lists indirect injection from files, multimodal injection, and the mitigations segregate external content, least privilege, human approval, adversarial testing.
- Spotlighting (https://arxiv.org/abs/2403.14720): input transformations that mark provenance cut attack success from over 50% to under 2% in the authors' GPT experiments. CaMeL (https://arxiv.org/abs/2503.18813): separating control and data flow solved 77% of AgentDojo tasks with provable guarantees vs 84% undefended. Both are the authors' results on their own setups.
- Trojan Source (https://arxiv.org/abs/2111.00169): bidirectional control characters make text read differently to a machine and a human.
- Structural keywords: Didier Stevens' `pdfid.py` counts `/JS /JavaScript /AA /OpenAction /Launch /EmbeddedFile /RichMedia /XFA /ObjStm /AcroForm /JBIG2Decode` (read from source; repo 2,548 stars, no licence field).
- Open tooling: `wppoland/hidden-text-detector` (7 stars, MIT, 2026-07-28; low adoption, unvetted) detects invisible-against-background text by rendering the page and measuring the contrast of the text's own area, covered text, OCG `/OFF` layers, sub-2pt fonts, off-page text, invisible render mode, low opacity, Unicode tag characters (U+E0000 to U+E007F), variation selectors, zero-width and bidi controls. I take the **idea** (measure the rendered pixels, not the declared colour), not the code. `protectai/llm-guard` is archived (3,218 stars, last push 2026-07-08): do not depend on it. `NVIDIA/garak` (9,554, Apache-2.0) and `promptfoo` (25,963, MIT) are test harnesses for the red-team range.

**Pipeline (every stage emits a typed finding with page, offsets, technique and evidence; all hashed into `sanitiserReportSha256`).**
- S0 container: size, page and object caps; parser runs in a worker with a hard timeout and no network; never execute JS or launch actions; encrypted or password-protected files are `blocked_by_policy`, not "no text". Structural scan with the pdfid keyword set plus pdf.js `getJSActions/getAttachments/getOptionalContentConfig/getMetadata`; embedded files are listed and hashed, never opened by the same pipeline; XFA, RichMedia and Launch are quarantined.
- S1 revisions: split at each `%%EOF`/incremental update; extract each revision's visible layer; flag any divergence between the signed revision and the final one (Shadow Attacks, section A6). Records the number of revisions in the evidence.
- S2 per-glyph visibility, two independent channels. Operator channel: fill/stroke colour, render mode (3 = invisible), opacity, font size under a legibility floor, glyph origin outside the CropBox, optional-content group state, clip, and draw order against later opaque shapes (PyMuPDF `get_texttrace` + `get_drawings` as oracle; pdf.js operator list or PDFium `GetFillColor` and `GetTextRenderMode` in the product). Render channel: rasterise the page, sample the contrast inside each glyph box against its surroundings (catches colour-matched, occluded and clipped text, and techniques not on any list). A glyph is `visible` only if both channels agree; disagreement is `suspect`.
- S3 legitimate invisibility: invisible text is not malicious by itself, because OCR tools such as OCRmyPDF add an invisible text layer over a scan. Classify `ocr_layer` when the page is dominated by one image and the layer matches independent OCR of that image (L4); classify `hidden_instruction_candidate` otherwise. This distinction is the false-positive control the benchmark must measure.
- S4 character level: strip nothing silently. Detect Unicode tag characters, variation selectors, zero-width and bidi controls, mixed-script homoglyph runs, and `FPDFText_HasUnicodeMapError`/`IsGenerated` characters. Record NFKC differences, because normalisation changes length and shifts offsets.
- S5 views: build `rawLayer` (everything, with flags) and `visibleLayer` (only `visible` glyphs, with an offset map back to raw). Locators are issued **only** into `visibleLayer`. Hidden or suspect spans are never offered to any agent as evidence; they are reported as findings and feed the policy engine as a risk signal ("document contains hidden text" can force escalation by deterministic rule).
- S6 content screening is a **second line only**: injection classifiers over visible text, because CrackedPDFs shows text-only detection is weak. The first line is architectural: the model receives document text inside spotlighting delimiters, may emit only span ids (never free quotes), actions come from the closed registry, and an approval gate stands behind any consequential step. The master spec's Scout Intent guard slots in here.

**Test plan.** A seeded generator for every technique above (white-on-white, near-white, tiny font, off-page, render mode 3, OCG off, covered by a rectangle, clipped, low opacity, annotation-only text, metadata and XMP fields, embedded-file text, form-field values, Unicode tags, zero-width, bidi, homoglyphs, font/ToUnicode remap, shadow-attack revisions) crossed with benign controls (OCR layers, watermarks, light-grey design text, small legal footnotes, rotated margins). Report recall per technique and false positives on the benign set with intervals, then the end-to-end figure that matters: **does the planted instruction change the decision** with the sanitiser on and off (a decision-flip rate, not a detection F1).

**Limits.** No sanitiser finds every carrier; we claim "these techniques, at these measured rates". Text drawn as vector outlines or images is invisible to text extraction and visible to a human; the render channel plus OCR covers it only if OCR is run, so scans and image text carry their own risk class.

## A6. Digital signatures, seals and certificates

- ETSI EN 319 142-1 (PAdES), fetched version v1.1.1: https://www.etsi.org/deliver/etsi_en/319100_319199/31914201/01.01.01_60/en_31914201v010101p.pdf. Baseline levels B-B (signature only), B-T (adds a trusted timestamp), B-LT (adds certificate chain and revocation data in the DSS dictionary), B-LTA (adds archive timestamps; `DocTimeStamp`). A newer edition may exist (UNVERIFIED).
- **pyHanko** (`MatthiasValvekens/pyHanko` 784 stars, MIT, 2026-10-11): validates signatures; docs describe `validate_pdf_ltv_signature`, PAdES-LT/LTA profiles, an ETSI EN 319 102-1 based `ades_lta_validation`, and a rule-based **incremental-update diff analysis** that decides whether changes appended after signing are legitimate (second signature, comments, form filling, metadata, bookkeeping timestamps), because "incremental updates can change essentially any aspect of the resulting document" (docs read from the repo source).
- **EU DSS** (`esig/dss` 1,040, LGPL-2.1, 2026-08-28): Java library for creating, extending and validating AdES signatures. An isolated validation sidecar candidate. Neither it nor pyHanko was run here.
- Node: `vbuch/node-signpdf` (941, MIT, 2026-10-07) is described as "simple signing"; I found no verified Node validator. `Hopding/pdf-lib` (8,656, MIT) has been quiet since 2024-07-17. Validation therefore belongs in the optional Python or Java step (UNVERIFIED that no good Node validator exists).
- **Shadow Attacks** (page fetched: https://www.pdf-insecurity.org/signature-shadow/shadow-attacks.html): Hide, Replace and Hide-and-Replace manipulate a signed PDF so the signature stays valid while displayed content changes. Authors, venue and viewer-vulnerability counts were not on the fetched page (UNVERIFIED).
- Design: a certificate or contract with a signature gets a **signature evidence record**: byte-range hash, signer certificate subject and chain status, signing time source, PAdES level, validation engine and version, trust list used, modification-analysis result, and the revision-diff result from S1. "Signature present" and "signature valid" and "content equals what was signed" are three separate fields. A visible signature image or seal is a cue, never proof.
- Visual signature and seal detectors exist (a 178-image Ultralytics signature dataset page; a YOLOv11 stamp model on a 728-image dataset; a YOLOv8s model claiming mAP50 94.5% on 2,819 images, all from search snippets, not verified). They detect that something looks like a signature, not that it is genuine. Use only as a flag "page region looks signed" to prompt a structural check; never as authentication.
- Verifiable-credential and provenance standards (`contentauth/c2pa-rs` 432 stars, NOASSERTION; W3C PROV-O Recommendation 2013) are noted for the dossier export, not for document authenticity: PROV-O's `Entity/Activity/Agent` with `wasDerivedFrom` and `wasGeneratedBy` maps well to "source bytes -> text layer -> span -> claim" (https://www.w3.org/TR/prov-o/). `contentauth/c2pa-node-v2` is archived; C2PA support for PDF was not checked (UNVERIFIED).

---

# PART B. EVIDENCE AND EXPLANATION UI

## B1. Standards for locating things

### B1.1 W3C Web Annotation Data Model
- Recommendation, 23 Feb 2017: https://www.w3.org/TR/annotation-model/. Selectors include `TextQuoteSelector` (one required `exact`, optional `prefix`, `suffix`), `TextPositionSelector` (`start` inclusive, `end` exclusive, 0-based), `FragmentSelector`, `RangeSelector`, `SvgSelector`, `DataPositionSelector`, and `refinedBy` chaining. The `w3c/web-annotation` repo is dormant (156 stars, 2017).
- Use: our `SourceLocator` serialises to a Web Annotation target: `FragmentSelector` (`page=N`, RFC 8118) refined by `TextPositionSelector` and `TextQuoteSelector`, plus an `SvgSelector` for `quads`. Any annotation tool can then read our evidence, and the export is a standard rather than a private format.
- Limits: the model has no notion of a hash, an extractor version or a visibility verdict; those are our extension properties, declared in the export context.

### B1.2 RFC 8118 PDF fragment identifiers
- Informational RFC, March 2017, https://www.rfc-editor.org/rfc/rfc8118. Parameters: `page`, `nameddest`, `structelem`, `comment`, `zoom`, `view`, `viewrect`, `highlight=left,right,top,bottom`, `search`, `ef`; units 1/72 inch from the upper left. Disagreements with ISO 32000-2 resolve in favour of ISO.
- Use: deep links in the export (`#page=12&highlight=...`) open correctly in many viewers. Browser support of `highlight` was not checked (UNVERIFIED), so the console viewer never relies on it.

### B1.3 Text Fragments (WICG)
- Draft Community Group Report, 13 Dec 2023, https://wicg.github.io/scroll-to-text-fragment/ (repo 615 stars, NOASSERTION): `#:~:text=[prefix-,]start[,end][,-suffix]`; requires user activation, top-level navigation only, cross-origin needs an opener-isolated destination, and the matching timing must not leak whether a match exists. It addresses HTML and plain text; PDF viewers are not mentioned.
- Use: for evidence that is a web page (registry pages, filings in HTML) the dossier links with a text fragment built from our `TextQuoteSelector`. It is a convenience link, not a verification.

### B1.4 Hypothesis client and its anchoring
- `hypothesis/client` 737 stars, NOASSERTION (mixed BSD-style), 2026-10-13. Their blog (https://web.hypothes.is/blog/fuzzy-anchoring/) documents four strategies in order: range selector, position selector, context-first fuzzy match on prefix and suffix, then selector-only fuzzy match, using a modified diff-match-patch (Bitap). `google/diff-match-patch` is archived (8,132 stars, last push 2024-05-22).
- Idea worth taking: store three selectors (position, quote with context, range) so each can check the others.
- Idea to reject for verification: silently falling back to fuzzy matching hides drift. In Plumbline a changed layer means `relocated`, shown as such.

## B2. Viewers and highlight libraries

### B2.1 react-pdf-highlighter and react-pdf-highlighter-extended
- `agentcooper/react-pdf-highlighter` 1,407 stars, MIT, last push 2024-11-22, pins `pdfjs-dist` 4.4.168. `DanielArnould/react-pdf-highlighter-extended` 110 stars, MIT, 2024-11-22, v8.1.0 (`pdfjs-dist ^4.4.168`), a refactored fork. https://github.com/DanielArnould/react-pdf-highlighter-extended
- Idea: highlights stored as `ScaledPosition { boundingRect, rects[], pageNumber, usePdfCoordinates }` with scaled coordinates (read from `types.ts`), so they survive zoom. That matches our `quads`.
- Use: reference for the coordinate maths. The master spec says static files and no bundler, no runtime install, so the console should use a thin custom layer over the pdf.js text and canvas layers rather than the React library. Both libraries trail pdf.js by two major versions (4.4 vs npm 6.4.299), and neither is maintained since late 2024.

### B2.2 pdf.js viewer text and annotation layers
- Source of the text layer used for selection and find, with an annotation layer for links and widgets. Use `getTextContent` items for click-to-highlight, but draw `quads` from the locator, not from the text layer.
- Limits: canvas rendering is inaccessible to assistive technology by itself (see B6).

### B2.3 Annotorious
- `recogito/annotorious` 869 stars, BSD-3-Clause, 2026-10-06. Image annotation with W3C Web Annotation output. Use if scanned pages need region evidence drawn on images; otherwise unnecessary.

## B3. Citation-grounded answer interfaces and what research says about them

### B3.1 Anthropic Citations API
- Docs (https://platform.claude.com/docs/en/build-with-claude/citations): citation types for plain text (`start_char_index`, `end_char_index`, 0-indexed, exclusive end), PDF (page numbers, 1-indexed, exclusive end) and custom content (block indices). `cited_text` does not count toward output tokens. The docs state "citations are guaranteed to contain valid pointers to the provided documents". PDFs are chunked into sentences, scanned PDFs without extractable text are not citable, and citations cannot be combined with structured outputs.
- Idea: **the model points, the system quotes.** The pointer is validated by construction and the quote is filled by code.
- Reading it critically: "valid pointer" means the span exists in the document, not that it supports the claim; the claim-to-span support check remains our L2 entailment. PDF mode gives page and sentence granularity only, which is too coarse for our locator.
- Use: copy the pattern into our `ModelPort`: present the visible layer as numbered chunks with stable ids, let the model emit `(claimId, chunkId or span range)`, have code fill `exact` and compute `spanSha256`, and let L0 reject any id that does not exist. This also works with the NVIDIA-hosted model, where Anthropic's API is not available.

### B3.2 Research on citation presentation (all fetched)
- Liu, Zhang, Liang, "Evaluating Verifiability in Generative Search Engines" (https://arxiv.org/abs/2304.09848, 2023): across four commercial systems 51.5% of generated sentences were fully supported by citations and 74.5% of citations supported their sentence. Old systems; the lesson is the metric pair, which we adopt as citation recall and precision.
- Ding et al., "Citations and Trust in LLM Generated Responses" (https://arxiv.org/abs/2501.01303, AAAI 2025): citations, even random, raised trust; checking them lowered it. Design consequence: a visible badge must reflect a computed result, otherwise the UI manufactures unearned trust.
- Martin-Boyle et al., "PaperTrail" (https://arxiv.org/abs/2602.21045, CHI 2026, 26 scholars): a claim-and-evidence interface with supported, unsupported and omitted-information categories lowered trust yet participants kept relying on the system, with cognitive burden the stated cause. Closest published relative to our ledger UI; our difference is cryptographic verification state plus a counterfactual panel. A small n and a scholarly task limit generalisation.
- Vasconcelos et al., "Explanations Can Reduce Overreliance on AI Systems During Decision-Making" (https://arxiv.org/abs/2212.06823, CSCW 2023, 5 studies, 731 participants): people engage with explanations when the cost of checking is low relative to the benefit. Design consequence: one click from claim to highlighted source.
- Buçinca et al., "To Trust or to Think" (https://arxiv.org/abs/2102.09692, 199 participants): cognitive forcing functions cut overreliance more than plain explanations but were liked least. Design consequence: add friction only at the approval gate.
- Uncertainty-display literature (for example work by Hullman and colleagues) could not be fetched before the search budget ended: UNVERIFIED, no claim made. The uncertainty shown is therefore limited to the ordinal tags the spec already defines, never a probability.
- Scite, Elicit and Perplexity product UIs were not examined (no fetch): UNVERIFIED, not used as design authority.

## B4. Explanation UIs: counterfactuals, provenance, diff

- **Wachter, Mittelstadt, Russell**, https://arxiv.org/abs/1711.00399 (Harvard JOLT 2018): explanation as "the smallest change to the world that can be made to obtain a desirable outcome". **Ustun, Spangher, Liu**, https://arxiv.org/abs/1809.06514 (FAT* 2019): recourse, with actionable vs non-actionable variables. Combined, they give the vocabulary for "minimal flip": the minimal set of evidence corrections that changes the decision, split into correctable by the vendor, correctable by us (a stale registry read), and immutable (a sanctions hit).
- **DiCE** (`interpretml/DiCE` 1,528 stars, MIT, last push 2025-07-13) and Google PAIR's **What-If Tool** (1,023, Apache-2.0, 2026-09-21): interactive counterfactual exploration for ML models, with feature sliders and nearest-counterexample views. Both target statistical models; Plumbline's decision is a deterministic function, so the panel can recompute exactly instead of approximating.
- **jsdiff** (`kpdecker/jsdiff` 9,213, BSD-3-Clause, 2026-10-07): word and line diffs for truth-table and as-of comparisons in the browser without a build step.
- **PROV-O** as above for the provenance graph vocabulary.
- Unverified: dedicated timeline-UI libraries and published guidance on bitemporal timeline UIs were not surveyed.

## B5. Design: the evidence viewer ("click a claim, see the verified span and its hash")

**Layout (desktop; on mobile the panels stack as a bottom sheet).**
1. Left: the claim ledger. Each claim row shows its verdict label, the ordinal confidence tag, and one chip per cited span: source name, page, and a status icon plus a text label (never colour alone).
2. Centre: the source viewer. Clicking a chip loads the document (hash-checked against `docSha256` before rendering), scrolls to the page, and draws the highlight from stored `quads`. Layer toggle: "visible text", "hidden text findings", "raw".
3. Right: the proof drawer for the selected span, as a short vertical list: `docSha256` (first 8 and last 4 characters, full value on expand and copy), `layerSha256` and extractor id/version, `spanSha256`, offsets, the page/offset deep link, the visibility verdict, the sanitiser findings on that page, the signature record if any, and the L1 to L4 results.
4. Bottom of the drawer: the counterfactual control (B5.3).

**B5.1 Verification state is computed in the browser, not asserted.** On click the page runs WebCrypto SHA-256 over (a) the loaded PDF bytes, (b) the bundled canonical layer, (c) the UTF-8 slice at `[start,end)` and compares with the dossier. The chip turns to `verified` only if all three match and the slice equals `quote.exact`. This reuses the offline verifier logic of differentiator 1 in the spec, so the UI cannot show green where the standalone verifier would not. States, each with distinct icon, label and `aria` text: `verified exact`, `verified (OCR, confidence n)`, `relocated (layer differs)`, `hash mismatch`, `hidden text finding`, `quote absent`, `not checked`, `unavailable`. These mirror the spec's rule that fetch states are never collapsed.

**B5.2 Highlights.** Rectangles from `quads`, drawn on an overlay canvas aligned to the pdf.js viewport; the text layer is used only for selection. A `<mark>` element wrapping the quote exists in a parallel "quote view" panel (prefix in grey, exact in `<mark>`, suffix in grey), which is also the screen-reader path. Stored coordinates are scaled (as in `ScaledPosition`) so zoom and resize do not break them. Multi-column and table spans render one rectangle per line box.

**B5.3 "What would change this".** For a selected decision, list the minimal flips computed by deterministic recomputation (spec 9, L4): each row states "remove evidence E" or "correct field F to V" and the resulting verdict, tagged correctable/immutable. Toggling a row re-runs the shared TypeScript policy engine in the page against the frozen case snapshot and policy version, shows the verdict diff (jsdiff on the truth table), and labels it exactly as the spec does: a sensitivity test under this snapshot and policy version, not real-world causation. Reaching the original verdict again from a toggled state is shown as a round trip, which doubles as a self-check on the recomputation.

**B5.4 Friction in the right place.** Reading-effort economics (Vasconcelos) say keep checking cheap; cognitive-forcing results (Buçinca) say add friction only where it matters. So: browsing is one click and free of friction; the approval button for an L2 or L3 action stays disabled until the reviewer has opened every span marked critical by L4 (opening is logged in the trace), and a rejection form asks which span failed. Reviewer behaviour is logged for the evaluation in contribution 3.

**B5.5 Timeline and as-of.** The as-of control re-queries bitemporal facts and re-renders the truth table with a diff against the previous as-of, reusing the jsdiff view. Source documents have revision and fetch-time badges.

## B6. Accessibility of the evidence interface (WCAG 2.2, W3C Recommendation 12 Dec 2024, https://www.w3.org/TR/WCAG22/)

- 1.4.1 Use of Color (A): every state has text and an icon as well as colour. 1.4.11 Non-text Contrast (AA): highlight outlines, status icons and focus rings at least 3:1 against adjacent colours, checked in light and dark. 1.3.1 Info and Relationships (A): claim, evidence and verdict relationships are structural (lists, `aria-describedby`, headings), not visual. 2.4.7 Focus Visible (AA) and 2.5.8 Target Size Minimum (AA, 24 by 24 CSS px): chips and toggles. 1.4.13 Content on Hover or Focus (AA): the proof drawer must be dismissible, hoverable and persistent, so it opens on click or Enter, not hover.
- A PDF drawn on a canvas is not exposed to assistive technology. The quote view, the proof list and a plain-text rendering of the page's visible layer are the accessible equivalent, and each claim chip is a real button with an accessible name containing document, page and status.
- Keyboard: arrow keys move between chips and highlights on a page; `Enter` opens the proof drawer; `Esc` returns focus to the chip. Verified with a screen reader during QA, as the master guide requires; none of this was tested here.

---

# 11. Ranked synthesis

## 11.1 Top 10 ideas

1. **Canonical visible-layer locator with level-wise verification (A1).** One owned, hashed text layer; offsets and quote and hash over it; L1 offline, L2 replay, L3 differential, L4 render-and-OCR. It is the base of the evidence model and the offline verifier.
2. **The model points, the system quotes (B3.1 pattern).** Span ids from the model, code-filled `exact` and hash, L0 rejection of unknown ids. Removes fabricated quotes by construction.
3. **Per-glyph visibility verdict from two channels (A5 S2), with locators issued only into the visible layer.** Turns the text-layer attack surface into a measured, typed finding that also feeds policy.
4. **Locator-fidelity benchmark with by-construction ground truth (A4).** Two typesetters, known glyph boxes, silent-wrong rate as the primary metric. It chooses the parser by measurement and is itself a publishable artefact.
5. **Differential extraction (pdf.js vs PDFium) as a runtime signal (A1 L3, A4 M7).** Cheap, independent, and catches extractor-specific silent errors.
6. **Revision-diff for signed documents (A5 S1, A6).** Closes the Shadow Attack gap that "signature valid" leaves open; separate fields for present, valid and content-unchanged.
7. **Computed verification chips in the evidence viewer (B5.1).** Browser-side SHA-256 of document, layer and span; no green without the standalone verifier agreeing. Answers the finding that citation presence alone inflates trust.
8. **Minimal-flip panel using the shared policy engine (B5.3),** vocabulary from Wachter and Ustun, correctable vs immutable evidence, round-trip self-check.
9. **Friction only at the approval gate (B5.4),** with logged evidence-opened events, based on Vasconcelos and Buçinca, which also generates the user-study data.
10. **Export evidence as W3C Web Annotation plus RFC 8118 links plus PROV-O (B1, A6).** A standards-based dossier any tool can read, with our hashes as declared extensions.

## 11.2 Ideas we should NOT adopt

- **Fuzzy re-anchoring as verification** (Hypothesis-style fallbacks): hides drift; allowed only as the labelled `relocated` state.
- **Model-written quotes or model-guessed character offsets**: this is the defect L0 exists to catch; the model never produces `exact`.
- **VLM OCR transcripts as decision evidence:** no glyph geometry, no confidence, silent omissions; reading aid only until anchored to classical OCR boxes.
- **Injection classifiers as the primary defence** (and `llm-guard`, archived): CrackedPDFs shows low recall on extracted text alone and shortcut-prone benchmarks.
- **Treating invisible text as malicious by default:** OCR layers are legitimately invisible; an unconditional strip breaks scanned documents.
- **PyMuPDF/MuPDF in the shipped core:** AGPL; use as an oracle only, pending a licence decision by Prateek.
- **Marker or MinerU as defaults** without a licence read: Marker's weights and MinerU's extra terms carry conditions.
- **ColPali as a citation source:** page-level, no offsets.
- **Visual signature or seal detection as authenticity:** presence of a mark proves nothing; structural PAdES validation does.
- **The Anthropic Citations API itself:** not available under the NVIDIA sponsor profile, and its PDF granularity is sentence and page; copy the pattern only.
- **react-pdf-highlighter libraries in the console:** two pdf.js majors behind, unmaintained since late 2024, and the spec asks for no bundler; copy the coordinate model.
- **Using public parser leaderboards to pick the parser:** they score similarity, several are vendor-run, and none tests locator fidelity.
- **Probability-style uncertainty display:** the spec's ordinal tags stand until calibration earns more; the literature to support more was not verified.

## 11.3 Three research contributions a grant reviewer would value

1. **A locator-fidelity benchmark and harness for document parsers.** Corpus typeset with by-construction character-to-glyph ground truth; metrics are silent-wrong rate, round-trip exact match, box IoU, repeated-clause disambiguation, determinism and honest failure; results with document-clustered intervals for Tier-1 Node extractors and a Tier-2 Docling step. In the sources I checked, published benchmarks score text or structure similarity (and ParseBench has an unread visual-grounding dimension), so this would fill a gap; that gap claim is limited by the survey, not proven.
2. **Decision-impact evaluation of document-borne injection with a per-glyph visibility sanitiser.** Instead of detector F1 on a labelled set, measure the rate at which planted hidden content flips a downstream policy decision, with the sanitiser on and off, by technique, plus false positives on legitimate invisible text (OCR layers, watermarks). The artefact is a generator, a corpus and a scoreboard mapped to OWASP LLM01 mitigations, extending the controlled-benchmark approach of CrackedPDFs to outcome impact.
3. **A controlled study of verified-evidence UI versus citation-presence UI.** Reviewers judge counterparty cases containing planted wrong, mismatched and hidden-text citations under three conditions (citation badge only; claim-evidence mapping as in PaperTrail; computed hash-verified state plus minimal-flip panel). Outcomes: planted-error detection rate, time to decision, reliance calibration, and trust shift. It tests the Ding et al. finding that citations inflate trust in a decision-support setting and whether computed verification fixes it. Sample size and ethics review are open items.

## 12. What I could not verify

- Any parser's accuracy, speed or memory on our document types: nothing was run. All numbers above are papers' or vendors' claims.
- LiteParse JSON schema and speed claim; Marker, MinerU, Unstructured and Kreuzberg geometry outputs; Surya model-weight licence; MinerU licence beyond section 1; whether a Node build of PDFium exposing char geometry exists (the `hyzyla/pdfium` build does not).
- The OmniDocBench 12.08% annotation-error audit (search snippet only); the LlamaIndex "OmniDocBench is saturated" and nanonets posts (not fetched); ParseBench's visual-grounding metric; DeepSeek-OCR's benchmark for the 97% figure.
- Shadow Attacks authors, venue and prevalence (page lacked them); ETSI EN 319 142-1 newer editions; a Node PAdES validator; C2PA for PDF; EU Trusted List handling.
- Reuse terms of CUAD (licence field empty), DocILE data, EDGAR/SEC documents, OFAC and CourtListener bodies (already NOT VERIFIED in the master spec).
- Browser support for RFC 8118 `highlight` and for text fragments in PDFs.
- Uncertainty-visualisation research, Scite, Elicit and Perplexity UIs, and timeline-UI guidance: the search budget ended before these were fetched.
- Generalisation of the user-study findings (Ding, PaperTrail, Vasconcelos, Buçinca) to a counterparty-release decision setting; all were run on other tasks and populations.
- The accessibility behaviour of the proposed viewer: designed against WCAG 2.2 text, not tested.
