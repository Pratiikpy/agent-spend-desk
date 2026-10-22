# Module 02: Document Intelligence (M2) Blueprint

## v5.1 alignment (2026-10-15, spec section 0 wins where this blueprint disagrees)

- Add a deterministic document tree with a cross-reference follower (PageIndex pattern); model summaries are navigation aids labelled `EXTRACTED`, never evidence (D-016).
- The render-and-OCR check is mandatory on every span a decision-bearing claim cites; a divergence is a structural finding that escalates. Bidirectional controls and confusables are reported as findings, never stripped from the text layer (D-015).


## Integration revision (2026-10-13)

Source: `99-integration-register.md`. Nothing here is built; the edits state the resolved design in place.

**Applied**
- INT-003: no private `RawHash`; digests are the shared `RawHash` (`sha256:`) and `DocHash` (`jcs:`). DI-01 types, `configHash`, ids, cassette `analysisHash`, interfaces table.
- INT-004 (P0): `DocLocator` and `SpanRecord` gain `byteStart`/`byteEnd` and `unit: "codepoint"`; the layer builder emits and cross-checks both; LV1 slices bytes, checks code-point boundaries and counts, and fails `LOCATOR_UNIT_MISMATCH` (`V5.` in the verifier); no normalisation, M4 must not assume NFC. DI-01, DI-14 step 3, tests DI-U01, DI-U04, DI-W01.
- INT-005: span id rule fixed (`sp_` + 24 hex, includes the page, `DocHash` form); `SpanRecord` is the one text-span type, M4's `Span` is a view, `spanSha` is the stored quote hash, models see aliases only. DI-01, DI-08, new test DI-P06.
- INT-011: LV1 to LV4 kept as the locator-verification names (SF2).
- INT-015: findings and completeness reach M5 as `doc.risk.<code>` and `doc.complete.<docType>`, restrict-only, feeding `escalate` never `reject`. DI-05, DI-11.
- INT-019: `SandboxProfile` carries M8's `CompartmentBackend`; "network denied" appears only beside the probed backend name; drills run per backend. DI-10.
- INT-022: field specs re-use M8's closed-kind `FieldSpec`; M2 adds `parser: ParserId`, `anchors`, `holdRelevant` (replaces `critical` everywhere). DI-08 (`groundValue`), DI-11.
- INT-041: input is a blob reference plus its `Evidence` from M1 channel 11j, not a channel; output labels inherit and never rise. Section 1, interfaces.
- INT-047: DI-13 is a requirements document; the one generator is M11 E4's; DI-12 keeps metrics and harness. DI-02 and DI-12 build notes follow (bake-off 4 after step 11).
- INT-052: evidence members become blob roles plus `evidence/derived/<docId>/..` (adds `pages/<n>.png` rasters at 144 dpi); `chipState` returns the named ten states, `layer-only` first-class, M10 owns colour. DI-14.
- INT-056: `SandboxPort` replaces the proposed `ctx.tools.sandbox`; requests row points to it.
- INT-065 and register section 4: SF4, 6, 7, 9, 11, 12 are spec text edits and the body already states them (DI-05 gains "never `reject`"); DI-15 row replaced by the register's version; DI-10 build notes follow register section 5.

**Named but not applied**
- INT-062 (SF13, OCR sponsor wording): a spec and sponsor-note edit; the body already makes classical OCR the judge default.
- INT-051 (verifier structure, rights-gated PDFs): does not name M2; DI-14 was checked against it and is consistent, so no edit.

**Spec feedback:** all 13 items are marked below; none is Open. Items resolved by INT-011, INT-062 and INT-065 need the spec text edits the register assigns to the spec owner.

**New contradictions and gaps found**
- INT-015 says a missing feature is "level 0" while INT-014 removes numeric levels from M5; M2 says only "can only hold".
- INT-041 gives no label rule for M2 outputs; "inherit, never raise" is my reading (M8 C9 item 3 is consistent). M1 and M8 to confirm.
- INT-005 fixes the id width but not the digest form; the `plumbline/span/v1` domain tag is proposed here and must differ from the tag M4 uses for field-span ids.
- INT-022 kind mapping (names and free text as `span_ref`, amounts as `decimal`) is proposed; M8 to confirm, and M3 must read name text from the layer by span.
- INT-044 lists no document stage as class B replay, while INT-042 makes the sandbox call a slot-keyed effect, so a novel document in replay could be a `CassetteMiss`; "replayable on any input" in the interfaces table is not settled.
- M2's metric ids M0 to M12 collide with module names in prose (for example "M5 determinism"); not renamed, it spans about 30 sentences outside the register's scope.
- Fixed inside this file: DI-U02 and DI-U03 claimed page-local span stability although spans bind the whole-file `textLayerHash`.

Status: design. Nothing here is built or measured; every design claim is a hypothesis with a named test. Template and shared types: `00-conventions-and-shared-types.md`. Contract refined: `../00-architecture-master-spec.md` v3.1 sections 7 (owner), 9 (L0 locator checks), 13 (verifier), 14 (evidence viewer), 5 (compartments), 9a (guarantee table). Decisions in force: D-005 (no build limit), D-007 and D-011 (Node, JSON Schema, bake-offs), D-012 (suppression and steering, `SEC-I18`).

## 0. How this blueprint was researched

- Dates: all checks 2026-10-13. Repository numbers come from `gh api repos/OWNER/NAME` (stars, licence, last push, archived). Papers and standards were fetched. Web search budget ran out, so some leads are labelled UNVERIFIED.
- **Code actually read (through `gh api` raw content; no clones exist under `research/` for document tools, nothing was cloned, run or installed):** pdf.js `src/display/api.js`, `src/display/canvas.js`, `src/core/evaluator.js`, `src/core/fonts.js` (class `Glyph`) at `main`, plus identifier greps at tag `v6.4.299`; PDFium public headers `fpdf_text.h`, `fpdf_edit.h`, `fpdf_signature.h`, `fpdfview.h`; pyHanko `sign/diff_analysis/policy_api.py` and `policies.py`, `rules_api.py`; pdfminer.six `layout.py`; the generated function list and `index.d.ts` of `@embedpdf/pdfium` 2.15.1; GitHub security advisories for `pdfjs-dist`; the Node.js v22 permissions documentation.
- **Read only at README or abstract depth:** Docling and docling-parse (README), Tesseract.js (docs), LiteParse, MinerU, Marker, everything cited from `prior-art/14` and `10`.
- Everything from `prior-art/14` is reused by section pointer (`14 §A2.1`), not re-verified, except where a claim there is tested again below (the PDFium-in-Node gap, section DI-02).

## 1. Scope and contract

**Job.** Turn an untrusted document (PDF; scans through a declared OCR path) into (a) an owned, hashed, **visible** text layer with verifiable locators; (b) typed findings about everything the layer deliberately excludes or that makes the document suspect (hidden text, injection carriers, signature facts, extractor disagreement); (c) a span table that lets a model cite by id while code supplies the quote; (d) deterministic field candidates for double extraction; (e) the data contract the browser and the offline verifier use to re-check a cited span.

**Input.** A blob reference to one document: the `RawHash` of its bytes in the content store behind M7 `StorePort`, handed over by M1 channel 11j (document intake: case attachment, internal document lake or web-fetched document) together with the `Evidence` record that carries `bodyHash`, authorship, trust and the rights class (INT-041). M2 receives a blob, not a channel; intake caps (count, size, type) are M13's, content checks are M2's. Also `AnalysisOptions` (profile, budgets, relying-party trust anchors for signatures) and ports from M7 (`SandboxPort`, clock, budget). **Output.** `DocumentAnalysis` (section DI-01 types). Derived text, spans and field candidates carry the input `Evidence` label and are never raised (`UNTRUSTED` for attachments and web documents, at most `EXTRACTED` for the internal lake); findings derive from vendor bytes, are always `UNTRUSTED`, and are consumed restrict-only by M5 and M8.

**Depends on:** M7 (`SandboxPort`, budgets, trace, cassette of analysis hashes), M8 (per-run datamark nonce, `CompartmentBackend` and compartment rules), M1 (channel 11j: blob reference, `Evidence` label, rights class). **Depended on by:** M3 (field candidates, origin), M4 (L0 quote check, span table), M5 (`DocRisk` facts), M8 (carrier findings), M9 (package members, LV1 rule for the verifier core), M10 (viewer), M11 (generates the corpus to this module's DI-13 requirements and reports the DI-12 metrics), M14 (extractor prompts and grounding).

**Not a product dependency:** Python. The judge path is Node plus WASM only. Docling, pyHanko, PyMuPDF and pdfplumber appear only in the evaluation tier (spec section 19a, bake-off 8).

## 2. Component list

| Id | Component | Spec anchor |
|---|---|---|
| DI-01 | Text layer, locator model, verification levels LV1 to LV4 | 7, 9, 13 |
| DI-02 | Extraction pipeline: adapters (pdf.js, PDFium, Docling fixtures, OCR), judge-run default, bake-off 4 protocol | 7, 19a |
| DI-03 | Layout: reading order, columns, tables, headers and footers | 7 |
| DI-04 | Per-glyph visibility from operators and pixel ablation | 7, 5 |
| DI-05 | Hidden-text and injection-carrier findings; the policy risk signal | 5, 7 |
| DI-06 | Signed PDFs: presence, validity, revision diff | 7 |
| DI-07 | Declared OCR path | 7 |
| DI-08 | Span table and the model-points, system-quotes contract | 2, 7, 9 |
| DI-09 | Second-extractor differential (LV3) | 7 |
| DI-10 | Hostile-file isolation, resource limits, fuzzing | 5, 7 |
| DI-11 | Deterministic field proposer and schema completeness | 5 (double extraction) |
| DI-12 | Locator-fidelity benchmark and metrics | 7, 17, 19a |
| DI-13 | Document corpus requirements (generator owned by M11 E4) | 16, 17 |
| DI-14 | Evidence-viewer data contract and standards export | 14 |
| DI-15 | Guarantee-table row and claims lint for documents | 9a |

Cross-cutting decision (applies to all): **we own the layer builder, the visibility classifier, the linearisation, the span table and the locator.** Extractors are adapters that emit per-glyph observations; two adapters (pdf.js, PDFium) double as each other's differential. No extractor's private string, offset or Markdown is ever evidence.

---

## DI-01 Text layer, locator model, verification levels

### 3. Best references
- W3C Web Annotation Data Model (Recommendation 2017-02-23): `TextQuoteSelector`, `TextPositionSelector`, `FragmentSelector` (14 §B1.1). Defines selectors; has no hash, extractor or visibility notion. Licence: W3C document licence (not checked).
- RFC 8118 PDF fragment identifiers (14 §B1.2). Browser support for `highlight` is UNVERIFIED.
- Hypothesis client anchoring (14 §B1.4): three stored selectors check each other; fuzzy fallback exists. Its fuzzy fallback is the behaviour we reject for verification.
- Anthropic Citations API (14 §B3.1): the system fills `cited_text`; PDF mode is page and sentence granular. The pattern is copied, the API is not used (unavailable under the sponsor profile).
- pdf.js `TextItem` (`api.js`, typedef): `str, dir, transform, width, height, fontName, hasEOL`. No per-character data.
- Docling `ProvenanceItem` with `charspan` (14 §A2.5): per item, with `(0, 0)` placeholders seen in several paths.
- PDFium text page API (`fpdf_text.h`): per character index, Unicode, boxes, origin, matrix, font size, fill and stroke colour, `IsGenerated`, `HasUnicodeMapError`.

### 4. What they actually do
- **pdf.js `getTextContent` does not give the characters a content stream draws.** In `evaluator.js`: glyphs flagged `isInvisibleFormatMark` are skipped (line 3023 region); synthetic spaces are inserted from cursor movement (`compareWithLastPosition`); each run goes through `runBidiTransform`, which calls `normalizeUnicode` unless `disableNormalization` is set and then applies the bidi algorithm (line 2711 region). No reference to `textRenderingMode` appears between `getTextContent` (line 2419) and the end of the text pipeline (grep of the file), so render mode 3 text is returned like any other. Consequence: its string cannot be mapped 1:1 to glyphs, and it silently includes invisible text.
- **pdf.js operator list carries per-glyph data.** `fonts.js` class `Glyph` has `originalCharCode, fontChar, unicode, accent, width, vmetric, operatorListId, isSpace, isInFont`. The evaluator folds `Tj`, `TJ`, `'`, `"` into `OPS.showText` (lines 1921 to 1963) and converts every fill colour operator (gray, CMYK, colour-space) into `OPS.setFillRGBColor`; patterns become `setFillColorN` or `setFillTransparent`; `ca` arrives through `OPS.setGState` (lines 2013 to 2106, 1165). So colour, mode and per-glyph Unicode with advance width are recoverable; positions must be recomputed by us from the text matrix, CTM, spacing and `TJ` adjustments (the arithmetic `canvas.js showText` performs).
- **PDFium exposes per-character facts directly** (headers): `FPDFText_GetUnicode`, `GetLooseCharBox`, `GetCharOrigin`, `GetFillColor`, `GetTextObject` (to reach `FPDFTextObj_GetTextRenderMode` in `fpdf_edit.h`), `IsGenerated` ("generated by PDFium", for example inserted spaces and newlines), `HasUnicodeMapError` ("invalid unicode mapping").

### 5. Decision
**Own.** Reject offsets into any extractor string, Markdown or Docling `charspan`. Adopt W3C selectors only as an export format (DI-14). Adapt Hypothesis' idea of storing quote context beside position (each selector checks the other), but never relocate silently.

### 6. Implementation design

```ts
// Digests use the shared kinds (INT-003; no private type here): RawHash `sha256:<hex>`, plain SHA-256 of the exact bytes (`sha256sum` reproduces it), for original
// documents, layer text and span text; DocHash `jcs:<hex>` (domain tag, newline, JCS bytes) for every JSON member, id and config digest.
type Milli = number;   // shared integer scale, here thousandths of a point; the JCS profile forbids floats, so ALL geometry in hashed JSON is integer
type Quad = readonly [Milli, Milli, Milli, Milli, Milli, Milli, Milli, Milli]; // 4 corners, PDF user space, counter-clockwise from baseline-left
type DocId = Id<"doc">;   // `doc_` + first 32 hex digits of docSha (the hex part of the RawHash)
type LayerId = Id<"ly">;  // `ly_` + first 32 hex of the DocHash of [docSha, revision, kind, pipelineVersion]
type SpanId = Id<"sp">;   // span id rule (INT-005): `sp_` + first 24 hex of the DocHash (domain `plumbline/span/v1`) of [textLayerHash, page, start, end]; includes the page, so unique across pages
                          // structured-field spans (`kind: "field"`) are M4's and use `sp_` + hash("span", evidenceHash, jsonPointer); they are not SpanRecords

interface PageGeom { page: number; mediaBox: [Milli,Milli,Milli,Milli]; cropBox: [Milli,Milli,Milli,Milli]; rotate: 0|90|180|270; userUnitPermille: number }

interface TextLayerManifest {            // JCS; its DocHash uses domain "plumbline/text-layer/v1"
  layerId: LayerId; docId: DocId; docSha: RawHash; revision: number;      // PDF incremental-update revision used (final = highest)
  kind: "visible" | "raw";
  textLayerHash: RawHash;                // SHA-256 of layer.txt bytes (UTF-8): page texts joined by U+000C
  geoHash: RawHash;                      // SHA-256 of layer.geo bytes (per-char boxes, delta-coded ints)
  unit: "codepoint";                     // canonical offsets count Unicode code points (JS UTF-16 is converted, tested with astral vectors); every span also carries UTF-8 byte offsets (INT-004)
  normalisation: "none+format-drop-v1";  // see below: no NFC/NFKC; ignorable and bidi format characters dropped with findings
  orderMethod: "xycut-v1" | "structtree" | "stream";
  pages: { page: number; chars: number; state: "extracted" | "scan_ocr" | "failed" | "not_checked"; provenanceClass: "native" | "ocr" }[];
  extractor: { pipelineVersion: string; configHash: DocHash; adapters: { id: string; version: string; buildHash: RawHash }[] };
  pageGeom: PageGeom[];
}
```

**Layer file (`layer.txt`).** UTF-8; page texts in page order joined by one U+000C. A U+000C produced by a glyph is replaced by U+FFFD with a finding. Locators are **page-relative** so editing page 5 never moves page 2, and carry two offset pairs over the same page text: code points (canonical) and UTF-8 bytes (so the offline verifier can slice with no Unicode logic). The layer builder emits both and refuses to admit a span unless the code-point count of the bytes before `byteStart` equals `start`. Page text is the glyph Unicode sequence in reading order with these synthetic characters only: U+0020 between words, U+000A at line ends, U+000A U+000A at block ends, U+0009 between table cells in a row. Synthetic characters carry `synthetic: true` in `layer.geo` (they have no quad and cannot start or end a span).

**No Unicode normalisation of the layer.** NFC or NFKC would change length and shift offsets (a pdf.js behaviour we avoid). A glyph mapping to several characters (ligature) contributes all of them, all mapped to that glyph. M4's matching normaliser (`prior-art/04` §0a, index map) handles ligature, quote and dash variants; it keeps an index map from raw positions and must not assume an NFC layer (INT-004). **Format-drop rule v1:** drop Unicode default-ignorable code points and bidi controls (U+200B to U+200F, U+202A to U+202E, U+2060 to U+2064, U+2066 to U+2069, U+FEFF, U+00AD, tag characters U+E0000 to U+E007F, variation selectors U+FE00 to U+FE0F and U+E0100 to U+E01EF) except ZWNJ and ZWJ inside Arabic, Indic or emoji sequences; each drop emits a finding (DI-05). Rationale: the layer is what a model reads, and invisible code points are a carrier (`SEC-I06`).

**Hyphenation.** Line-end hyphens stay in the text (`indemni-` U+000A `cation`). The layer manifest carries `joinHints: {page, atOffset}[]` (`atOffset` in page-relative code points) for line-end hyphens followed by a lowercase letter, which M4's normaliser consumes to join. Spec feedback item 8.

**Sidecar `layer.geo`.** Per page, per layer character: glyph reference `(objectId, glyphIndex)` and quad; synthetic characters flagged. Delta-coded varints, deflated, hashed as `geoHash`. Size is NOT VERIFIED (estimate: 4 to 10 bytes per character after compression). The sidecar is needed only by LV3, LV4, the viewer's drill-down and the benchmark; **LV1 needs only `layer.txt` and the span record.**

```ts
interface DocLocator {                   // serialises into the shared `Locator {kind:"doc", resolver:"textlayer", ref:docId, docSha, revision, layerId, textLayerHash, unit, page, start, end, byteStart, byteEnd}` (INT-004); the rest lives in SpanRecord
  docId: DocId; docSha: RawHash; revision: number; layerId: LayerId; textLayerHash: RawHash;
  unit: "codepoint";                     // fixed; `start`/`end` count Unicode code points; the layer is never normalised
  page: number;                          // 1-based (RFC 8118)
  start: number; end: number;            // 0-based, end exclusive, code points, page-relative, over the VISIBLE layer only
  byteStart: number; byteEnd: number;    // UTF-8 byte offsets into the same page text, end exclusive; the verifier cross-checks both pairs
}
type LvResult = { level: "LV1"|"LV2"|"LV3"|"LV4"; verdict: "pass"|"fail"|"inconclusive"|"not_run"; reason: string; detail?: Json };
```

**Verification levels** (named LV1 to LV4 here; the spec calls them L1 to L4, which collides with M4's L0 to L4, spec feedback item 2):
1. **LV1 (offline, no parser, no PDF).** `pure function lv1(layerTxt, span)`: split the layer bytes on 0x0C (U+000C is one byte in UTF-8) and take the page; slice the page bytes `[byteStart, byteEnd)` with no Unicode logic; require the slice to equal `utf8(span.exact)` and `sha256(slice) == spanSha`; require `sha256(layerTxt bytes) == textLayerHash`; require `byteStart < byteEnd` and not inside a synthetic character boundary; require both ends on code-point boundaries (not a UTF-8 continuation byte, except an end at the page end) and the code-point count of the page bytes before `byteStart` to equal `start` and inside the slice to equal `end - start`. Any disagreement between the byte reading and the code-point reading is `fail` with reason `LOCATOR_UNIT_MISMATCH` (the verifier core reports `V5.LOCATOR_UNIT_MISMATCH`). The verifier core (M9) implements exactly this in a second language against shared vectors; the code-point-only implementation used by the browser (DI-14) and the layer builder must reach the same verdict on the same vectors.
2. **LV2 (extractor replay).** Re-run the pinned pipeline on the original PDF; the regenerated `textLayerHash` must equal. `inconclusive` when the pipeline version is unavailable; **fail** when it is available and differs (non-determinism is a defect, DI-12 M5).
3. **LV3 (second extractor agrees).** DI-09.
4. **LV4 (render and OCR).** Render the span's quads, OCR the crop with the declared OCR path, compare to `exact` under a tolerance recorded in the result; `inconclusive` when OCR confidence is below a floor. Catches font, ToUnicode and encoding remaps and replaced glyph shapes (`SEC-I04`).
**Level policy** (data in the pack): evidence cited in a decision needs LV1; a field marked `holdRelevant` (payee, account, amount, expiry, sanctions-relevant name; one flag name shared with M8 and M14, INT-022) also needs LV3 `pass`, else a gap `unverified_locator` caps confidence; LV2 and LV4 run in `--deep` verify mode and on sampled spans in CI. A locator whose LV1 passes but whose LV3 is `fail` is shown as `extractor_disagree`, never `verified`.

**Relocation.** If a layer of a different pipeline version is built for the same `docSha`, a locator can be re-anchored by `(exact, prefix, suffix)` uniqueness; the result is a new locator with `state: "relocated"` and both hashes. Never `verified` until LV1 passes against the new layer; never applied silently.

**Determinism.** All geometry is quantised to 1/64 pt before any decision (word gap, line grouping, order), using integer comparisons and total-order sort keys with explicit tie-breaks, so the layer cannot flip across platforms because of float noise. Trigonometry for rotated text uses a table of exact 90-degree multiples and a single `Math.atan2` path for other angles; cross-OS equality is a test (M5 in DI-12).

### 7. Tests and acceptance
- `DI-U01` LV1 vectors, each with both offset pairs: ASCII, astral code points, combining marks, ligature, RTL, U+000C-bearing glyph, empty span, span across a synthetic character; negative vectors for the unit check (byte offset inside a multi-byte sequence, UTF-16 offsets supplied as code points, byte end past the page, code-point count not matching `start`), each expected `LOCATOR_UNIT_MISMATCH`.
- `DI-U02` property: for any generated layer, every `SpanRecord` passes LV1; any single-byte mutation of `layer.txt` fails LV1 for every span (the `textLayerHash` check binds the whole file); with that check disabled by a test seam, it fails exactly the spans on the touched page and none on other pages.
- `DI-U03` offsets: page-relative stability (changing page k's content leaves the offsets, in code points and bytes, of other pages' spans unchanged; their ids change only because ids bind `textLayerHash`).
- `DI-U04` cross-implementation: second LV1 implementation (verifier core language, byte-slicing) agrees with the code-point implementation on 10,000 generated cases, including unit-mismatch mutants.
- `DI-U05` determinism M5 matrix (DI-12). **Disproved if** a single locator passes LV1 yet selects text different from what the benchmark ground truth (DI-12) says the PDF displays at that place, for a candidate allowed to issue `verified`.

### 8. Risks and NOT VERIFIED
- The W3C selectors count position in "characters"; whether that equals code points or UTF-16 units in the Recommendation text was not re-read here. Our export states the unit as an extension (DI-14).
- Per-char sidecar size and encode speed: NOT VERIFIED.
- Dropping ZWJ outside Arabic, Indic and emoji contexts might alter legitimate text in scripts not in the corpus (Thai, Khmer): recorded as a finding, never silent; script coverage is limited to the corpus.

### 9. Build notes
First component to build: it fixes the types every other module imports and unblocks M4 L0 and the verifier. The `RawHash`/`DocHash` prefixes and the shared `Locator` come from the step 1 kernel contracts (register section 5); this component adds no private digest or locator type. Order: types and JCS profile, LV1 pure function and vectors, layer writer, manifest, then the rest.

---

## DI-02 Extraction pipeline, adapters, judge-run default and bake-off 4

### 3. Best references
- pdf.js / `pdfjs-dist` 6.4.299 (Apache-2.0, 53,996 stars, pushed 2026-10-13; `engines.node >=22.13.0 || >=24`; optional dependency `@napi-rs/canvas`): `getOperatorList`, `getTextContent`, `getJSActions`, `getAttachments`, `getOptionalContentConfig`, `getMetadata`, `getMarkInfo`, `getFieldObjects`, `getPermissions` (`api.js`).
- PDFium wrappers: `@embedpdf/pdfium` 2.15.1 (MIT, npm; repository EmbedPDF/embed-pdf-viewer, SDK Apache-2.0 with a Fair-Source server we do not use; `LICENSING.md` read), `bblanchon/pdfium-binaries` (MIT, 1,490 stars, native), `hyzyla/pdfium` (MIT, 190 stars; per `14 §A2.2` exposes only `CountChars/GetText`), LiteParse (Apache-2.0, 12,843 stars; PDFium plus grid projection).
- Docling (MIT, 68,815 stars) and docling-parse (MIT, 341 stars; v7 `DecodeConfig(do_sanitization, keep_glyphs)` and `ContentConfig(char|word|line cells, shapes, bitmaps)`, README): offline Tier 2.
- pdfplumber (MIT) and PyMuPDF (AGPL-3.0, oracle only) as test oracles (`14 §A2.3/4`).
- Benchmarks and their flaws: OmniDocBench, olmOCR-Bench, ParseBench, PureDocBench (`14 §A3`): all score similarity to their own truth, none scores locator round trip.

### 4. What they actually do
- pdf.js (read): operator list gives per-glyph Unicode and widths; render options include `operationsFilter(index, operatorList) => boolean` and `recordOperations` (per-operation bounding boxes), both present in `api.js` and `canvas.js` (`executeOperatorList` consults the filter at the loop head) and present in tag `v6.4.299` (identifier grep, 10 matches). `getDocument` defaults relevant to us: `stopAtErrors` false (it **recovers silently**), `maxImageSize` unlimited, `disableFontFace` true under Node, `useSystemFonts` false under Node.
- `@embedpdf/pdfium` `index.d.ts` declares `FPDFText_GetFillColor`, `HasUnicodeMapError`, `IsGenerated`, `GetCharBox`, `GetLooseCharBox`, `GetFontSize`, `FPDF_RenderPageBitmap`, `FPDFBitmap_Create`, `FPDFPage_RemoveObject`, `FPDFFormObj_CountObjects/GetObject/RemoveObject`, `FPDFPageObj_GetClipPath`, `FPDFTextObj_GetTextRenderMode`, `FPDF_GetSignatureCount`, `FPDFSignatureObj_GetContents`. **These are declarations in a type file, not executed here.** This answers the open question in `14 §12` (whether a Node-usable PDFium exposes per-character geometry and colour): the answer is "declared yes in `@embedpdf/pdfium`; to be exercised in bake-off 4".
- Docling Parse: char, word and line cells with coordinates, `do_sanitization` is a decode option; what that sanitisation removes was not read.

### 5. Decision
**Adapt.** Own the pipeline and the `GlyphSource` abstraction; adopt `pdfjs-dist` and `@embedpdf/pdfium` (or pdfium-binaries) as adapters pending the bake-off; Docling as offline fixtures re-anchored into our layer; reject Marker, MinerU, Unstructured and Kreuzberg as defaults (licence conditions, no offset contract, `14 §11.2`); reject LiteParse as primary (its text is a derived grid-projection string; it enters the bake-off as a candidate only).

### 6. Implementation design

```ts
interface GlyphObs {                     // one drawn glyph, emitted by an adapter; pure data
  page: number; objId: string; glyphIdx: number; seq: number;          // seq = draw order within the page
  cps: number[];                          // code points this glyph maps to (ligature: several), [] if none
  quad: Quad; fontSize: Milli; fontKey: string; origin: [Milli, Milli];
  fill: { r: number; g: number; b: number; a: number } | "pattern" | "unknown";  // integers 0..255 (alpha from ExtGState ca scaled to 0..255)
  renderMode: 0|1|2|3|4|5|6|7; clipped: boolean | "unknown"; ocgHidden: boolean | "unknown"; inMarkedContent: string[];
  flags: { generated?: boolean; unicodeMapError?: boolean; isInFont?: boolean; type3?: boolean };
}
interface GlyphSource {
  id: "pdfjs" | "pdfium" | "docling-fixture" | "ocr";
  version: string; buildHash: RawHash;
  open(bytes: Uint8Array, caps: Caps): Result<DocHandle, DocError>;
  pageGeom(h: DocHandle, page: number): PageGeom;
  glyphs(h: DocHandle, page: number): Result<GlyphObs[], DocError>;     // may be partial: error carries the glyphs obtained and a reason
  structure?(h: DocHandle, page: number): StructHint[];                 // tagged-PDF tree, tables, headings (optional)
}
```

**Pipeline** (all inside the sandbox child, DI-10; the parent only receives validated results):
1. **S0 intake (parent).** size cap, `docSha` (re-hashed from the blob; a mismatch with the `Evidence.bodyHash` is a typed failure, never a silent re-label), magic bytes (`%PDF-` within the first 1024 bytes; polyglot check: report the offset), encryption flag by quick scan; `docId`. Non-PDF image types go to the scan path (DI-07). Failure states are values: `blocked_by_policy` (encrypted, caps), `failed(parse)`, never empty text.
2. **S1 inspect (child).** Own `PdfInspector` (DI-06): xref chain, object streams, revisions, signatures, structural scan. Disagreement with pdf.js on page count is a finding (parser differential).
3. **S2 observe (child).** For each page up to the page cap: run adapters A (pdf.js) and B (PDFium) to `GlyphObs[]`. A missing page is `not_checked`, not empty.
4. **S3 visibility (DI-04)** classifies every glyph. 5. **S4 layout (DI-03)** builds lines, blocks, tables, order. 6. **S5 build layers** (visible and raw) with `charMap`. 7. **S6 spans (DI-08)**. 8. **S7 differential (DI-09)** A vs B. 9. **S8 findings and risk (DI-05)**. 10. **S9 field candidates (DI-11)**. 11. **S10 package**: hash members, write `DocumentAnalysis`.

`pdf.js` open options (pinned in config, hashed into `configHash`): `isEvalSupported: false` (the documented workaround for CVE-2024-4367, advisory GHSA-wgrm-67xf-hhpq: arbitrary JS execution when `isEvalSupported` is true, patched 4.2.67), `stopAtErrors: true` (a verification system must not accept recovered partial parses silently; recovered mode is a separate `salvage` profile whose layers are marked `provenance: salvage` and cannot be `verified`), `maxImageSize` finite, `disableFontFace: true`, `useSystemFonts: false` with `standardFontDataUrl` and `cMapUrl` pointing at vendored, hashed files (no network, no system-font dependence: determinism), `useWorkerFetch: false`. A second advisory (CVE-2026-16633, `enableScripting` default true in browser builds, patched 6.2.108) concerns the viewer: the console viewer (DI-14) sets `enableScripting: false` and a strict CSP.

**Judge-run default (Node only, no Python, no runtime install).** Observation adapters A (pdf.js operator list) and B (PDFium WASM through `@embedpdf/pdfium`), OCR through Tesseract.js with a vendored `eng.traineddata`. Disk budget proposal (NOT VERIFIED, to be measured): `pdfjs-dist` 34.9 MB unpacked in the registry (ship the legacy build subset only), `@embedpdf/pdfium` 7.6 MB, `tesseract.js` 1.4 MB plus one `tesseract.js-core` build (the package is 30.6 MB with all variants), `tessdata_fast` `eng.traineddata` 4.1 MB (Apache-2.0). `@napi-rs/canvas` (optional dependency of pdf.js) is a native addon, so it is **not** used inside the sandbox (Node's permission model blocks addons unless `--allow-addons`, DI-10); all rendering inside the sandbox is PDFium WASM.

**Tier 2 (offline, evaluation tier only).** Docling plus docling-parse run in a pinned container on the committed demo and benchmark documents and emit `docling-fixture/<docSha>.json` with the contract `{documentHash, extractionVersion, items:[{page, bbox, label, text, charspan?, tableCells?, readingIndex}]}`. At analysis time the fixture is loaded only if `documentHash == docSha`. **Docling never supplies a locator.** Each item is re-anchored: collect our visible glyphs whose quad centre lies inside `bbox`; compare the concatenated text to `item.text` under exact then normalised equality; on success attach `StructHint {kind: label, readingIndex, tableCell}` to the covered layer range; otherwise count it as `unanchored` and ignore it. A novel document without a fixture gets Tier-1 structure and `layoutSource: "tier1"` in the manifest (the honest degrade).

**Bake-off 4 protocol (spec 19a item 4), pre-registered in `eval/prereg/bakeoff-4.md` before any run.**
- Candidates: P1 pdf.js adapter; P2 PDFium WASM adapter; P2n pdfium-binaries native via a thin Node addon (evaluation only, to separate WASM from PDFium behaviour); P3 LiteParse; T2a docling-parse; T2b full Docling; Oracle-1 pdfplumber; Oracle-2 PyMuPDF (AGPL, never shipped); OCR rows: Tesseract.js, docTR, PaddleOCR (`14 §A2.9`).
- Corpus: PLD-1 (generated by M11 E4 to the DI-13 requirements), dev/test split by base-document cluster; thresholds are tuned on dev and frozen before test is opened.
- Metrics: M0 to M12 of DI-12; cost columns: p50/p95 latency per page, peak RSS, cold start, install bytes, native binaries, licence class, number of owned lines.
- **Eligibility rule (fixed in advance):** a source may be the *primary* observation adapter only if, on the G1 test split, silent-wrong locators = 0 with the document-clustered one-sided 95% upper bound reported, M5 determinism = pass on both OSes, and M6 honest-failure rate on G2/G4 has zero silent garbage. Among eligible sources choose the one with the highest M1 lower bound, then lowest owned code. The other eligible Tier-1 source becomes the differential partner. If neither is eligible, the module ships page-level locators only (no quads, no line highlight) and says so.
- **Line-level highlight promise:** per stratum (layout class), only if the lower 95% bound of M2 (box IoU ≥ 0.9 fraction) ≥ 0.98; otherwise page-level plus quote view.
- Output: `eval/reports/bakeoff-4/` and a `docs/DECISIONS.md` record whichever way it falls.

### 7. Tests and acceptance
`DI-U10` each adapter on the 40-document smoke set must produce `GlyphObs` with plausible invariants (quad inside page, positive area, cps in range); `DI-U11` adapter contract tests with injected failures (truncate a stream, mid-page throw) produce partial results plus typed errors; `DI-U12` pinned-build test: adapter `buildHash` mismatch refuses to run; `DI-U13` pdf.js options test: a hostile font file that triggers the CVE-2024-4367 pattern does not execute (positive control: same file against `isEvalSupported:true` on the vulnerable version in the evaluation tier only); `DI-U14` Docling fixture re-anchor: planted wrong `bbox` is counted `unanchored`, never attached.

### 8. Risks and NOT VERIFIED
- Whether pdf.js produces reliable per-glyph positions after our recomputation (rotated, Type3, vertical writing, `Tz`, `Ts`): the measurement is the bake-off. Type3 glyphs have no Unicode in the operator list reliably: flagged `type3`, excluded from `verified`.
- `@embedpdf/pdfium` runs under the Node permission model, the real per-char output matches the declarations, and the WASM heap stays within caps: all NOT VERIFIED.
- Installed Node 22.17.0 satisfies `pdfjs-dist` engines (`>=22.13.0`); the repository `main` branch requires `>=22.22.3` (pdf.js `package.json`), relevant if we ever track `main`. `doctor` prints the fix.

### 9. Build notes
After DI-01 and a small hand-made smoke set (adapter contract tests, DI-U10 to DI-U14): adapters, then the shared layer builder. Bake-off 4 runs after the one corpus generator (M11 E4, build step 11) and the DI-12 harness exist, not at step 3a (register section 5, V4); every later component's thresholds depend on the chosen primary.

---

## DI-03 Layout: reading order, columns, tables, headers and footers

### 3. Best references
- pdfminer.six `layout.py` (MIT, 7,037 stars, last push 2026-03-13): the classical chars to lines to boxes to groups pipeline.
- Docling reading order and TableFormer (`14 §A2.5`): learned layout and table structure; probabilistic, can be wrong without an error signal.
- LayoutReader / ReadingBank (arXiv 2108.11591, Wang et al.; 500,000 document images; seq2seq with text and layout): fetched abstract only.
- Tagged PDF structure tree (pdf.js `getMarkInfo`, `StructTreeRoot`): author-declared order, absent in most scans and many generated documents.
- Recursive XY-cut (Ha, Haralick, Phillips, 1995): named from memory, **UNVERIFIED**, not fetched.

### 4. What they actually do
pdfminer (read, `layout.py`): `LAParams` thresholds are relative to character size (`char_margin=2.0`, `line_margin=0.5`, `word_margin=0.1`); `group_objects` joins characters into a line when they are horizontally aligned within `line_overlap` and closer than `char_margin`; lines are grouped into boxes by `line_margin`; boxes are grouped hierarchically by an agglomerative heap keyed on `dist(box1, box2)` (area of the combined rectangle minus the two areas, with an `isany` guard so no other box sits between); the final order inside a group is a linear key `(1 - boxes_flow) * x0 - (1 + boxes_flow) * (y0 + y1)` with `boxes_flow=0.5` default (an explicit left-to-right versus top-to-bottom trade-off: this is the heuristic that interleaves two columns when it is wrong). Docling uses learned models; their failure is silent.

### 5. Decision
**Adapt** (re-implement) a deterministic pipeline in the pdfminer spirit with an explicit column-gutter step, keep tagged-PDF structure and Docling hints as *candidate orders* only. Reject learned reading order in the judge path (non-deterministic across versions, no error signal). Reading order cannot create a false quote (offsets refer to the layer), but a wrong order creates wrong sentences and interleaved columns that mislead the entailment judge, so order quality is measured (M3) and spans never cross a block boundary.

### 6. Implementation design
Input: visible `GlyphObs` of a page. Output: `PageLayout { lines, blocks, tables, headersFooters, order }`.
1. **Words.** Sort glyphs along the baseline direction (page rotation and per-run rotation resolved); gap > 0.25 em (em = median font size of the run) or a space glyph ends a word. Thresholds are parameters frozen by dev split.
2. **Lines.** Cluster by baseline (integer-quantised) within 0.5 em overlap; superscripts and subscripts attach when overlapping horizontally.
3. **Column gutters.** Vertical projection of word boxes over the text area; a gutter is a vertical band at least 1.5 em wide with no ink for at least 60% of the page text height; produces column intervals. Pages with ruled boxes use the ruling lines (from pdf.js `constructPath` rectangles and lines, or PDFium path objects) as additional separators.
4. **Blocks.** Within each column interval, lines join into blocks when the vertical gap is below 0.8 em and indent/alignment is compatible; headings (font size or weight larger than neighbours, or short bold line) are single blocks.
5. **Order.** Recursive XY-cut over blocks: split on the widest empty horizontal band, else the widest empty vertical band; leaves are read top-to-bottom. Candidates: `xycut-v1`, `structtree` (if present and complete), `stream` (content order). Choice rule: use `structtree` if its coverage of visible glyphs is ≥ 99% and it does not disagree with `xycut-v1` by more than the pre-registered Kendall-tau margin; otherwise `xycut-v1`. `orderMethod` is recorded in the manifest, and a disagreement larger than the margin is an info finding `order_ambiguous` (it routes the page to LV3/LV4 with larger sampling).
6. **Tables.** (a) *Ruled:* intersect horizontal and vertical ruling segments (tolerance 0.5 pt) into a grid; cells are grid rectangles, merged cells from missing interior rulings. (b) *Unruled:* cluster word left/right/centre edges across consecutive lines into columns (at least three rows with consistent alignment); row boundaries at line clusters. (c) Rows emitted left to right with U+0009 between cells and U+000A between rows. Each cell becomes a span with `table: {tableId,row,col,rowSpan,colSpan, colHeaderSpanIds, rowHeaderSpanIds}`. Header rows: first row if bold or ruled-thicker or repeated on the next page. A table whose structure confidence is low is emitted as plain lines with `table: null` and an info finding; never a guessed grid.
7. **Headers and footers.** A line is `running` if, on at least 60% of pages (min 3), a line with the same normalised text (digits masked) sits at the same quantised y within 2 pt; running lines are kept in the layer (they are visible text) but flagged `role: "header"|"footer"`, excluded from field proposal and from entailment spans by default, and page numbers are parsed so cited page labels can be shown ("page 3 of 12").
8. **Footnotes and sidebars.** Blocks with smaller font at the page bottom are `footnote`; they remain in the layer in reading order after the main text of their column.

### 7. Tests and acceptance
`DI-U20` unit tests per step on synthetic pages (two columns with a floating figure; three columns; table with merged cells; unruled table; rotated page; vertical writing). `DI-M3` reading-order metric on PLD-1: count of gold clauses split or interleaved by order, Kendall tau over blocks, per stratum with document-clustered intervals; baselines: stream order, pdfminer defaults (oracle tier), Docling order (fixtures). `DI-M4b` table metric: cell-text exactness and cell-to-header association accuracy on the generated tables; baselines TableFormer via Docling fixtures. **Disproved if** xycut-v1 interleaves columns on more than 2% of two-column pages (lower bound of the acceptable rate is pre-registered) where `stream` order does not.

### 8. Risks and NOT VERIFIED
Footnotes spanning columns, text on a path, text in images, mixed RTL and LTR tables, and multi-page tables are weak points; any failure degrades to lines with a finding. Real-world contract and certificate layouts (EDGAR-style, scanned certificates) are not in the first corpus (rights); generalisation is not claimed.

### 9. Build notes
After the adapters. A first version using `stream` order plus lines is enough to run the bake-off; the full pipeline is built once the bake-off picks the primary and M3 has a baseline.

---

## DI-04 Per-glyph visibility from operators and pixel ablation

### 3. Best references
- `wppoland/hidden-text-detector` (7 stars, MIT, 2026-07-28; unvetted): measures contrast of the text's area in a render (`14 §A5`). Idea taken, code not.
- PyMuPDF `get_texttrace` and `get_drawings` (AGPL; oracle only), pdfplumber `non_stroking_color` (`14 §A2.3/4`).
- Lin, CACM 2026 (arXiv 2507.06185), arXiv 2605.28999 (about 1% of 200,000 resumes, over 90% without instruction wording), CrackedPDFs (arXiv 2607.19396): the prevalence and the weakness of text-only detectors (`14 §A5`).
- pdf.js `operationsFilter` and `recordOperations` (read, DI-02): the tool for the ablation render.
- PDFium `FPDFPage_RemoveObject`, `FPDFFormObj_RemoveObject`, `FPDF_RenderPageBitmap` (headers; declared in `@embedpdf/pdfium` types).

### 4. What they actually do
`hidden-text-detector` and every operator-only approach decide from the declared colour, size, mode. Declared state misses colour-matched text on a coloured background, text covered by a later shape, text clipped away, text under an image, and any technique nobody listed. Contrast of "the text's own area" in a render also misfires when the area happens to be dark for reasons unrelated to the text. None of the surveyed tools isolates the *text's own contribution to the pixels*.

### 5. Decision
**Own.** Two channels, and the pixel channel is an **ablation render**, not a contrast heuristic: render the page with and without all text, and attribute the pixel difference to each glyph's box. A glyph is visible only if both channels agree. This is a design claim; its recall and false-positive rates are measured (DI-12), not assumed.

### 6. Implementation design
**Channel O (operators).** For each `GlyphObs`: `op.drawn = renderMode in {0,1,2,4,5,6}` (3 and 7 draw nothing; 4 to 6 add to clip), `op.sizeFloor = fontSizeEffective >= FLOOR_PT` (effective = font size times |CTM·Tm| scale; initial floor 1.5 pt hidden, below 4 pt `tiny`), `op.onPage` (quad intersects CropBox after rotation), `op.ocgOn` (optional-content state resolved from the default config `/D`, `/OFF`, `/AS` usage), `op.clipOk` (quad intersects the active clip path; clip tracking is implemented in the adapter, `unknown` when not computed), `op.alpha > 0` (ExtGState `ca`, soft mask presence as `unknown`), `op.notOccluded` (no later opaque fill whose recorded bounding box covers the glyph quad; bounding boxes from pdf.js `recordOperations` or PDFium page objects; opacity of the occluder < 1 gives `unknown`). Fill colour is recorded, not used as a verdict by itself.

**Channel P (pixels, ablation).** Inside the sandbox with PDFium WASM:
1. Render page at scale S (default 2.0, 144 dpi; 4.0 for pages with `tiny` glyphs) into `T` (all content, annotations as displayed).
2. Remove every text page object, recursing into form XObjects (`FPDFPage_RemoveObject`, `FPDFFormObj_RemoveObject`), keep clip-only text modes' clip effect out of scope (documented limit); render again into `B` (background). Fallback adapter: pdf.js with `operationsFilter` that returns false for `OPS.showText` indices (requires `@napi-rs/canvas`, so evaluation tier only).
3. For each glyph box (quad rasterised at scale S, inflated by 1 px): `inkDelta = max over pixels of max channel |T - B|` (0..255) and `inkMass = count of pixels with |T - B| > INK_EPS`. Whitespace glyphs inherit the verdict of the nearest non-space neighbours in the same word and are never evaluated alone.
4. Contrast of the ink against the background it sits on: `cr = contrastRatio(meanColour(T where changed), meanColour(B around))` (WCAG 2 relative luminance formula). A glyph is `ink_visible` iff `inkMass >= MASS_MIN` and `cr >= CR_MIN`; `faint` iff ink exists but `cr < CR_MIN` (candidates: watermark, light design text, colour-matched text). Initial `INK_EPS`, `MASS_MIN`, `CR_MIN` are placeholders tuned on dev and frozen: NOT VERIFIED.

**Combination (pure function).**
```ts
type GlyphClass = "visible" | "hidden" | "suspect" | "faint" | "not_assessable";
function classifyGlyph(o: OpObs, p: PixObs | "not_run"): { cls: GlyphClass; technique: Technique[]; }
// 1. p === "not_run" or glyph type3/unknown colorspace  -> "not_assessable" unless operator says hidden (then "hidden")
// 2. operator says not drawn / off page / ocg off / size below floor / alpha 0   -> "hidden" with the matching technique
// 3. operator drawn AND pixel ink_visible                                           -> "visible"
// 4. operator drawn AND pixel no ink (white-on-white, covered, clipped, same-colour) -> "hidden" technique "no_ink"
// 5. operator undecided ("unknown") AND pixel ink_visible                          -> "visible"
// 6. operator drawn AND pixel faint                                                -> "faint"   (kept out of visible layer, finding, see DI-05)
// 7. any other disagreement                                                        -> "suspect"
```
**What enters the visible layer:** `visible` only. `faint`, `suspect`, `hidden`, `not_assessable` go to the raw layer with their flag; a fact that needs text from a page with `not_assessable` glyphs is a gap, not a pass. This is the fail-closed direction: a false quarantine costs availability (measured as `quarantine_fp_rate`), a false admit costs safety.

**Scans and OCR layers.** On a page where one image covers at least 85% of the page and all native text is render mode 3, the page is `scan_candidate`; the native invisible text is not evidence. The visible layer for that page is produced by the declared OCR path (DI-07), and the native layer is compared to it: similarity ≥ `TAU_OCR` classifies the native layer as `benign_ocr_layer` (info), lower as `hidden_instruction_candidate` (restrict). Pages where OCR is disabled are `not_checked` for evidence purposes.

**Annotations and form fields.** Widget and annotation text (FreeText, stamps, field values) is visible content added after signing in many attacks. The inspector extracts their text; the pixel channel renders with and without annotations in the rectangle; if ink appears it enters the layer in a separate block marked `origin: "annotation"`, else it is a carrier finding.

**Glyph-shape remap.** A glyph can draw one shape and map to another Unicode (custom encoding, ToUnicode tampering, `ActualText` marked content). Operators and pixels both say "visible". Defences: `HasUnicodeMapError` and `isInFont` flags; OCR cross-check of each line (LV4 in bulk): per-line similarity of layer text to OCR of the render below `TAU_REMAP` gives finding `glyph_remap_suspect`. Cost-bounded by the document OCR budget; unchecked pages carry `remap_unchecked` in the manifest and hold-relevant spans from them cannot reach LV4 `pass`.

### 7. Tests and acceptance
`DI-V01` technique grid on generated pages (DI-13 H-series): for each technique, recall of "not in visible layer" with 95% one-sided lower bound; pre-registered target 0.95 at 60 base documents per technique if all are caught (0.05^(1/60) = 0.951). `DI-V02` benign controls (OCR layers, watermarks, light-grey headings, legal footnotes 6 pt, rotated margin text, gradient backgrounds): false-quarantine rate with upper bound (300 base documents all clean gives 0.99%). `DI-V03` oracle agreement: PyMuPDF `get_texttrace` and pdfplumber colours as labelling aids on the generated corpus (truth is the generator's own record, not the oracle). `DI-V04` positive control: same corpus with visibility enforcement off must show the planted instruction in the model input (M11 decision-flip harness). `DI-V05` channel independence: ablation of channel O alone and P alone, reporting which techniques each misses. **Disproved if** a technique in the grid reaches the visible layer, or the benign false-quarantine upper bound exceeds the pre-registered availability budget.

### 8. Risks and NOT VERIFIED
Clip-only text modes, soft masks, blend modes and transparency groups can make the ablation delta differ from a human's perception; pattern-filled text; Type3 fonts; very small text at low scale; render differences between PDFium and Acrobat (a document can render differently in another viewer: the layer certifies PDFium's rendering, stated in the 9a row). Ablation render cost per page: NOT VERIFIED.

### 9. Build notes
Needs the PDFium adapter and the generator's H-series. Build the pure `classifyGlyph` and the technique grid first; the pixel channel second.

---

## DI-05 Hidden-text and injection-carrier findings; the policy risk signal

### 3. Best references
OWASP LLM01:2025 and OWASP Agentic Top 10 2026 (ASI01, ASI05; `10 §G4`), Spotlighting (arXiv 2403.14720), Trojan Source (arXiv 2111.00169), Unicode UTS #39 version 18.0.0 (2026-08-27; skeleton and mixed-script detection: resolved script set empty), CrackedPDFs, Didier Stevens `pdfid.py` keyword list (`14 §A5`), `prior-art/10` attack families `SEC-I01` to `SEC-I06`, `SEC-I17`.

### 4. What they actually do
`pdfid.py` counts keyword tokens in raw bytes (`/JS /JavaScript /AA /OpenAction /Launch /EmbeddedFile /RichMedia /XFA /ObjStm /AcroForm /JBIG2Decode`; read in `14`): it misses name-escaped keywords (`/J#61vaScript`) and keywords inside compressed object streams. Detector models (PromptGuard, the CrackedPDFs hybrid) are probabilistic; `10 §F2` makes them telemetry that may only force escalation.

### 5. Decision
**Adapt + own.** The primary defence is architectural and costs nothing at run time: **the model sees only the visible layer**, so every non-visible carrier (hidden glyphs, metadata, XMP, embedded files, JavaScript, optional-content layers, annotations that do not render ink, form values not displayed) is absent from the model input by construction. Detection exists to emit a *signal* so policy escalates, and to measure. Visible-in-plain-sight instructions are not an M2 problem: they are untrusted data handled by M8's restrict-only gate and quarantined extractor.

### 6. Implementation design
```ts
type Technique = "render_mode_3" | "tiny_font" | "off_page" | "ocg_hidden" | "alpha_zero" | "clipped" | "occluded" | "no_ink" | "same_colour"
  | "annotation_no_ink" | "meta_text" | "xmp_text" | "embedded_file" | "js_action" | "launch_action" | "xfa" | "richmedia"
  | "unicode_tag" | "variation_selector" | "zero_width" | "bidi_control" | "mixed_script_word" | "glyph_remap_suspect"
  | "unicode_map_error" | "benign_ocr_layer" | "watermark_faint" | "revision_shadow" | "parser_differential" | "polyglot";
interface DocFinding {
  id: Id<"fd">; docId: DocId; page: number | null; technique: Technique; severity: "info" | "warn" | "restrict";
  extent: { glyphs: number; chars: number }; rawRange?: { start: number; end: number };   // in the RAW layer; never in the visible layer
  previewInert: string;      // at most 80 code points, escaped, control characters shown as \u{...}; for human panes only, never for a model
  previewHash: RawHash; detector: { id: string; version: string }; channels: { operator: string; pixel: string };
  trust: "UNTRUSTED";        // derived from vendor bytes; consumed restrict-only
}
interface DocRisk {          // typed facts for M5; absent finding is NOT permission
  docId: DocId; codes: DocRiskCode[]; hiddenGlyphs: number; hiddenPages: number[]; visibleLayerCoverage: number /* permille of glyphs admitted */;
  completeness: "full" | "partial";    // partial when pages were not_checked or caps were hit
  findingIds: Id<"fd">[];
}
type DocRiskCode = "HIDDEN_TEXT" | "SUSPECT_TEXT" | "FAINT_TEXT" | "ACTIVE_CONTENT" | "EMBEDDED_FILE" | "SIGNATURE_INVALID" | "POST_SIGNATURE_CHANGE"
  | "EXTRACTOR_DISAGREE" | "GLYPH_REMAP" | "INVISIBLE_UNICODE" | "MIXED_SCRIPT" | "OCR_ONLY" | "LOW_OCR_CONFIDENCE" | "ENCRYPTED" | "PARSE_RECOVERED" | "PAGE_CAP" | "UNCHECKED_PAGES";
```
**Severity map** (data in the pack, shown as default): `restrict` for HIDDEN_TEXT with `hiddenGlyphs >= 1` where technique is not `benign_ocr_layer`, ACTIVE_CONTENT, EMBEDDED_FILE with executable-like type, POST_SIGNATURE_CHANGE, GLYPH_REMAP, EXTRACTOR_DISAGREE on a hold-relevant span, SIGNATURE_INVALID when a signature is present; `warn` for FAINT_TEXT, INVISIBLE_UNICODE, MIXED_SCRIPT, OCR_ONLY; `info` for benign classes. **Inputs to M5** (INT-015; restrict-only): M5's feature registry takes `doc.risk.<code>` (one typed feature per `DocRiskCode`, carrying the severity from this map and the counts) and `doc.complete.<docType>` (DI-11 `DocCompleteness`), each with a conformance test; a missing or unknown value can only hold, never permit. Any `restrict` code sets minimum action `escalate` for the case; `warn` codes add reason codes and raise the corroboration requirement for document-derived release-enabling facts. Document findings feed `escalate`, never `reject`, and "no findings" is never clearance. The severity map is one data file shared with M5; the rules are M5's; M2 supplies the vocabulary, the severities and the counts.
**Structural scan** (DI-06 inspector, after name-hex decoding and object-stream expansion): counts and locates `/JS /JavaScript /AA /OpenAction /Launch /EmbeddedFile /RichMedia /XFA /AcroForm /URI /SubmitForm /GoToR`, embedded file names (path traversal characters flagged: `SEC-I17`), file attachments hashed and never opened by this pipeline, optional-content groups and their default state, XMP and Info dictionary strings (extracted, hashed, kept in `carrierText` for human panes, never in the model input). Compare with pdf.js `getJSActions`, `getAttachments`, `getOptionalContentConfig`, `getMetadata`; mismatch is `parser_differential`.
**Character-level scan:** per the format-drop rule (DI-01), Unicode tag characters, variation selectors, zero-width and bidi controls are counted with positions in the raw layer; mixed-script words (UTS #39 resolved script set empty, excluding Common and Inherited) get `mixed_script_word`; homoglyph comparison against a SOR vendor name is M3's job, M2 exposes `scriptRuns` for it.
**Telemetry classifier (optional, never a gate):** an instruction-likeness score over hidden text, recorded for research, set to `telemetry_only`. Its recall is irrelevant to the guarantee.
**Preview handling:** hidden text excerpts are stored hashed with an inert preview; the console renders them as `textContent` in a labelled pane. A test asserts no hidden-text content reaches any prompt (`DI-S04`).

### 7. Tests and acceptance
`DI-S01` technique recall per technique on H-series with intervals (60 base documents per technique); `DI-S02` benign twins and benign controls, false-positive rate by code; `DI-S03` **decision-flip rate** (the metric that matters, harness in M11): planted instruction changes the decision with visibility enforcement off (positive control must be nonzero) versus on; reported with document-clustered intervals and the extractor steer rate (`SEC-I18` oracle: decision equals the benign twin's decision); `DI-S04` egress: instrument the prompt builder and assert no hidden or carrier text appears in any model input across the whole corpus; `DI-S05` structural scan against name-escaped and object-stream-embedded keywords (the cases `pdfid` misses); `DI-S06` Unicode tag/zero-width/bidi/homoglyph vectors. Disproved if a planted hidden instruction reaches a model input, or the on/off flip rates are equal.

### 8. Risks and NOT VERIFIED
No detector finds every carrier; the claim is "these techniques at these measured rates". Instruction text drawn as vector outlines or inside images is invisible to text extraction but visible to a human; it reaches the pipeline only through OCR and is then ordinary visible text. Suppression (an injection making a hold-relevant field vanish) is `SEC-I18`, bounded by the required-positive-evidence policy (spec section 5), not by M2.

### 9. Build notes
After DI-04 and the inspector (DI-06); the severity map and the `DocRisk` schema are agreed with M5 before either is frozen.

---

## DI-06 Signed PDFs: presence, validity, content unchanged since signing

### 3. Best references
- Shadow Attacks (Mainka, Mladenov, Rohlmann, NDSS 2021, fetched): "16 of 29 PDF viewers tested were vulnerable", and a `PDF-Detector` tool to stop shadow documents from being signed or to detect exploits afterwards. The project evaluation page (pdf-insecurity.org) lists 26 applications and 20, 24 and 23 vulnerable to Hide, Replace and Hide-and-Replace: the two pages disagree on counts; we cite neither as a rate.
- ETSI EN 319 142-1 PAdES baseline levels B-B, B-T, B-LT, B-LTA (`14 §A6`); RFC 5652 CMS (fetched: §5.3 SignerInfo, §5.4 digest of the DER `SignedAttrs` with the explicit SET OF tag, §5.6 verification against `messageDigest`).
- pyHanko (MIT, 784 stars): `ModificationLevel` (`NONE`, `LTA_UPDATES`, `FORM_FILLING`, `ANNOTATIONS`, `OTHER`), `DiffPolicy`/`StandardDiffPolicy`, whitelist rules (`CatalogModificationRule`, `ObjectStreamRule`, `XrefStreamRule`, `SigFieldModificationRule`, `DSSCompareRule`, `DocInfoRule`, `MetadataUpdateRule`), orphan detection `_find_orphans` (policies.py). Read code.
- PDFium signature API (`fpdf_signature.h`, read): `FPDF_GetSignatureCount`, `FPDFSignatureObj_GetContents`, `GetByteRange`, `GetSubFilter`, `GetReason`, `GetTime`, `GetDocMDPPermission`: extraction, not validation.
- PKI.js (`pkijs` 3.4.1, BSD-3-Clause, 1,400 stars, depends on asn1js) and `@peculiar/x509` (MIT) as Node CMS/X.509 libraries; EU DSS (LGPL-2.1, Java) as sidecar candidate (`14 §A6`).

### 4. What they actually do
pyHanko decides "was this document modified after signing" by walking historical revisions: each object changed in a later revision must be approved by a whitelist rule at a stated modification level; reachability from the page tree and orphan analysis guard against hiding; unapproved changes raise `SuspiciousModification`. It is object-semantic, which is exactly where Shadow Attacks live (they use legal features). Viewers show a green tick when the CMS signature verifies over the ByteRange and the incremental update looks "allowed". PDFium's API extracts the signature dictionary and contents but does not validate.

### 5. Decision
**Own** a TypeScript implementation with three independent checks, and adapt pyHanko's rule vocabulary as the *object-level* check; reject "signature valid" as one field. Use `node:crypto` for digests, RSA/ECDSA verification and `X509Certificate`, a small own DER reader for CMS (`SignedData`), and PKI.js as the *second implementation* in tests (devDependency). pyHanko (Python) is the evaluation-tier oracle that signs the benchmark documents and validates our results.

### 6. Implementation design
```ts
interface SignatureRecord {
  id: Id<"sg">; docId: DocId; fieldName: string | null; subFilter: string; revisionIndex: number;     // revision whose end the ByteRange ends at
  present: true;
  byteRange: { values: number[]; coverage: "whole_file_but_contents" | "gap" | "overlap" | "malformed"; bytesAfter: number };
  cms: { parsed: boolean; digestAlg: string; messageDigestMatches: boolean | "n/a"; signatureMath: "valid" | "invalid" | "unsupported"; signerCert?: { subject: string; issuer: string; serial: string; sha256: RawHash } };
  chain: { result: "anchored" | "untrusted_root" | "broken" | "not_checked"; anchorsSource: "relying_party_pins" | "none"; synthetic: boolean };
  time: { claimed?: Iso; timestampToken?: { genTime: Iso; messageImprintMatches: boolean; tsaChain: string } };
  revocation: "embedded_ok" | "embedded_bad" | "not_checked";          // from DSS / adbe-revocationInfoArchival only; no network
  pades: "B-B" | "B-T" | "B-LT" | "B-LTA" | "none/unknown";
  docMdp?: 1 | 2 | 3;
  contentSinceSigning: ContentSinceSigning;
}
type ContentSinceSigning =
  | { verdict: "byte_identical" }
  | { verdict: "benign_update"; levels: ("LTA_UPDATES" | "FORM_FILLING")[]; ruleIds: string[] }
  | { verdict: "visible_change"; pages: number[]; textDelta: number; pixelDeltaRatio: number }
  | { verdict: "structure_change_unapproved"; refs: string[] }
  | { verdict: "unknown"; reason: string };
```
Three fields stay separate: **present** (a `/Sig` or `/DocTimeStamp` dictionary with `/ByteRange` and `/Contents`), **valid** (`cms.signatureMath`, `messageDigestMatches`, `byteRange.coverage`, `chain`), **content unchanged** (`contentSinceSigning`). A green UI state requires all three plus a relying-party-pinned anchor; without pins the maximum is "signature math valid, signer not trusted".

**Algorithm.**
1. `PdfInspector` (own tolerant parser): parse the xref chain (classic tables, xref streams, hybrid, `/Prev`), object streams, names with `#xx` escapes, find every `%%EOF` and `startxref` to split revisions; report polyglot and trailing bytes.
2. For each signature: validate `/ByteRange` (4 integers, monotone, first range starts at 0, second ends at file end of that revision, the gap exactly equals the `/Contents` hex string including delimiters; any other value is `gap`/`overlap`/`malformed`: this is the signature-wrapping family of "1 Trillion Dollar Refund" (CCS 2019, Mladenov et al.; named from memory, UNVERIFIED, not fetched)).
3. CMS: parse DER; recompute digest over the ByteRange bytes; compare to `messageDigest`; recompute digest of DER `SignedAttrs` re-tagged as `SET OF` (RFC 5652 §5.4); verify the signature with the signer certificate's public key; unsupported algorithms yield `unsupported`, never `valid`.
4. Chain to relying-party anchors using `X509Certificate.checkIssued` and signature verification; EU trusted lists and AATL are not loaded by default (data availability and licence not read: NOT VERIFIED); synthetic CA for demo and tests, labelled `synthetic: true`.
5. Timestamp token (RFC 3161) inside unsigned attributes: verify imprint and TSA signature; DSS dictionary parsed for embedded OCSP/CRL; no network revocation.
6. **Content since signing, three independent sub-checks:**
   (a) *Bytes:* if `bytesAfter == 0` and no later revision: `byte_identical`.
   (b) *Rendered content (language-independent, Shadow-resistant):* reconstruct the signed revision (file truncated at that revision's `%%EOF`); run the visible-layer pipeline on both; compare page text hashes; render both revisions with PDFium and compare raster differences per page, excluding rectangles of widgets/signature fields permitted by FORM_FILLING; `pixelDeltaRatio` = changed pixels outside permitted rectangles over page pixels.
   (c) *Objects:* adapt pyHanko's idea in a stricter, smaller rule set: every object that differs between the signed revision and the final one must be (i) new and unreachable from the page tree, catalog, resources and annotations (orphans; flagged `info`), or (ii) matched by a whitelist rule: DSS/VRI updates, `DocTimeStamp` append, new signature field and appearance, form field `/V` and widget `/AP` for fields not locked by `/FieldMDP`, `Info`/XMP updates. Anything else reachable is `structure_change_unapproved` with the object refs. Also check `/DocMDP` permission P against the observed level.
   Verdict precedence: `visible_change` over `structure_change_unapproved` over `benign_update` over `byte_identical`; if any sub-check cannot run, `unknown` with the reason, and risk code `POST_SIGNATURE_CHANGE` is **not** emitted as clear.
7. A document with an incremental update after a signature whose (b) and (c) are both clean is `benign_update` and still reported; the revision count is evidence.

### 7. Tests and acceptance
`DI-G01` CMS verification vectors against pyHanko-signed and OpenSSL-signed files (evaluation tier generates; fixtures committed): valid, tampered content byte, tampered signed attribute, wrong key, unsupported algorithm. `DI-G02` second implementation (PKI.js) agrees on every vector. `DI-G03` attack corpus built by our writer: Hide (overlay appended after signing), Replace (appended objects change displayed text), Hide-and-Replace, ByteRange gap/overlap, appended second `/Contents`, page-tree swap, form-field change on a locked field, harmless DSS/LTV update, harmless form fill. Metrics: detection recall per attack with intervals, false positive rate on benign updates (the three fields reported separately, never a single "tampered" bit). `DI-G04` differential against `PDF-Detector` if available (availability UNVERIFIED) and against pyHanko's diff analysis on the same files. `DI-G05` pin handling: no pins gives `untrusted_root`, never `anchored`. Disproved if a Shadow-style document yields `byte_identical` or `benign_update`.

### 8. Risks and NOT VERIFIED
CMS and X.509 corner cases (BER indefinite lengths, PSS, EdDSA, SHA-3, countersignatures, PAdES-LTA chains) beyond the vectors; pixel comparison across revisions fails for legitimately animated or time-dependent content (JavaScript is not executed, so only static content is compared); a Node PAdES validator was not found in the earlier survey (`14 §A6`), hence own code; legal effect of any signature is out of scope.

### 9. Build notes
Inspector first (also needed by DI-05 and DI-10), then the structural pieces, then CMS, then the three sub-checks; attack corpus built together with the generator.

---

## DI-07 Declared OCR path

### 3. Best references
Tesseract (Apache-2.0, 76,967 stars) and Tesseract.js (Apache-2.0, 38,760 stars; npm 7.0.0 with `tesseract.js-core` 6.1.2 Apache-2.0), `tessdata_fast` (Apache-2.0, 4.1 MB `eng.traineddata`), docTR, PaddleOCR, Surya, OCRmyPDF (MPL-2.0), VLM OCR (olmOCR, DeepSeek-OCR, PaddleOCR-VL, dots.ocr, chandra) with the cautions in `14 §A2.9`; PureDocBench for degradation design (`14 §A3`).

### 4. What they actually do
Classical engines emit words with boxes and confidences (Tesseract TSV and hOCR; Tesseract.js docs describe defaulting to a CDN download of language data and core, overridable with `langPath`, `corePath`, `workerPath`). Free-running VLM transcription gives text with no glyph geometry or confidence and can drop or invent content silently. Tesseract.js output option names in version 7 were not read (UNVERIFIED).

### 5. Decision
**Adopt** Tesseract.js (WASM, offline paths pinned and vendored) as the declared judge-run OCR; **adapt** the output into `GlyphObs`-like word observations with `provenanceClass: "ocr"`; VLM OCR is a reading aid only, its spans admissible only after exact re-anchoring to classical-OCR words, else `vlm_unanchored` and never evidence (`14 §11.2`). Reject silent fallback: OCR runs only for pages classified `scan_candidate` or when LV4 and remap checks ask; the manifest says `provenanceClass` per page.

### 6. Implementation design
1. Rasterise the page with PDFium at 300 dpi (150 for large pages; cap pixels), deterministic colour handling.
2. Run Tesseract.js with `langPath`, `corePath`, `workerPath` pointing at vendored, hashed files, `cacheMethod: none`, no network (a test blocks it); page segmentation mode and engine settings are part of `configHash`; single worker per child (the Node permission model is not inherited by worker threads, DI-10, so the OCR WASM runs in the child's main thread or in a child process of its own).
3. Output: words `{text, quad, confPermille}`; lines by Tesseract's own line ids and by our DI-03 clustering; layer text built with the same synthetic-character rules; `layer.geo` stores the OCR boxes; each span gets `confMinPermille`. Words below `CONF_FLOOR` stay in the raw layer; a span containing them cannot be `verified` for hold-relevant fields.
4. **Declared status:** `OCR_ONLY` risk code (warn) for scanned documents; `LOW_OCR_CONFIDENCE` (warn). Facts from OCR text are `EXTRACTED`, and for hold-relevant fields require double extraction from two OCR configurations (different scale or segmentation), disagreement being a conflict item (spec section 5).
5. Determinism: same input bytes, same build, single-threaded: expected identical output; tested on both OSes (DI-12 M5). If not identical, OCR output is stored as a fixture and LV2 for OCR spans is `inconclusive` by design.
6. Language: English-only data ships; other scripts are `not_supported` findings (not guessed).

### 7. Tests and acceptance
`DI-O01` G2 degraded copies (dpi 100 to 300, skew, noise, JPEG, low contrast): word accuracy against known source text, character error rate by degradation, with document-clustered intervals, per engine (Tesseract.js, docTR and PaddleOCR in the evaluation tier); `DI-O02` honest failure: blank page, photo, upside-down, rotated 90 degrees: typed result, never garbage as `ok`; `DI-O03` offline test: all network blocked, vendored model hashes checked; `DI-O04` OCR text against the PDF's native invisible layer (benign OCRmyPDF-style): similarity distribution to set `TAU_OCR` on dev. Disproved if OCR confidence does not separate wrong from right words well enough to make the `CONF_FLOOR` rule useful (AUROC reported).

### 8. Risks and NOT VERIFIED
OCR speed in WASM per page and per document budget: NOT VERIFIED (a 3 to 10 s/page estimate is a guess, not a finding). Stamps, seals and handwriting are not covered. Visual forgery (edited images, fabricated seals) is not covered: spec section 21c item 4 stands.

### 9. Build notes
After the PDFium adapter and the scan generator (DI-13 G2). OCR is also used by LV4 and glyph-remap checks, so its interface is built before DI-04 is finalised.

---

## DI-08 Span table and the model-points, system-quotes contract

### 3. Best references
Anthropic Citations API pattern (`14 §B3.1`: `char_location`, `page_location`, `cited_text` filled by the system); ALCE citation id range check; ragas `QuotedSpansAlignment` defects (`04 §0a`, curly-quote and apostrophe handling); L0 design in `prior-art/04` §0a (quote statuses, normalisation index map); `prior-art/10` §D.3 (quarantined extractor contract).

### 4. What they actually do
The Citations API chunks sentences, returns pointers guaranteed valid in the provided documents, and bills `cited_text` as free. Validity of the pointer does not imply support (14). ALCE checks only that citation ids are in range. Neither lets a caller verify the cited text against an independent copy; ours does (LV1).

### 5. Decision
**Adapt + own.** A precomputed addressable span table over the visible layer; the model sees stable aliases and returns ids; code returns `exact`, offsets, hash and quads. Unknown ids are rejected by L0 (M4), never repaired.

### 6. Implementation design
```ts
interface SpanRecord {
  id: SpanId; docId: DocId; layerId: LayerId; textLayerHash: RawHash; page: number; start: number; end: number;   // code points, page-relative
  byteStart: number; byteEnd: number;                                   // UTF-8 bytes, same page text (INT-004)
  kind: "heading" | "sentence" | "clause" | "line" | "cell" | "kv_key" | "kv_value" | "list_item" | "footnote" | "annotation";
  exact: string; spanSha: RawHash; prefix: string; suffix: string;       // 32 code points each, from the visible layer
  parent?: SpanId; blockId: string; table?: { tableId: string; row: number; col: number; rowSpan: number; colSpan: number; colHeaders: SpanId[]; rowHeaders: SpanId[] };
  role: "body" | "header" | "footer";
  quads: Quad[];                                  // one per line piece
  provenanceClass: "native" | "ocr"; confMinPermille?: number;
  visibility: { visible: number; faint: number; total: number };     // glyph counts (faint and hidden never inside a visible span; counts kept for audit)
  lv: { lv1: LvResult; lv3?: LvResult };
}
```
**Exports (INT-005).** `SpanRecord` is the one span type for text evidence. M4's `Span` is a view over it (id, page, offsets, `exact`, `spanSha`, quads, kind); M4 keeps only structured-field spans. The stored quote hash is `spanSha` (RawHash of the exact UTF-8 bytes); an NFC-folded variant exists only inside M4's normalised matcher and is never stored. Models see only the per-prompt aliases below; M4 and M14 prompts must call `renderForModel`, and the alias map is stored in the cassette.

**Segmentation (deterministic, inside blocks only; never crossing a block or cell).** Sentences by `Intl.Segmenter` (sentence granularity) with an abbreviation and number guard, lines for addresses and signature blocks, one span per table cell, one span per label and value of a detected key-value pair, list items. Over-long sentences (> 400 code points) split at `;` and `:` into `clause` children with `parent`. Segmenter locale and ICU data version are pinned and hashed in `configHash` (Node ships ICU; version drift would move boundaries: a determinism test). Target: spans small enough that one claim usually needs one to three spans.

**Prompt rendering for models (M14 calls, M8 supplies nonce):**
```ts
pure function renderForModel(spans: SpanRecord[], nonce: string, budgetTokens: number): { text: string; aliasMap: Map<string, SpanId> }
// "⟦{nonce}:S12⟧ <exact with brackets and the nonce string escaped>" per span; aliases S1..Sn per prompt, never the content-derived id
```
The model's output grammar for citations: `{"cite":[{"span":"S12"},{"span":"S13"}]}`. Escaping guarantees document text cannot forge a delimiter (`SEC-I12`); aliases shorten tokens and reduce transcription errors.

**Resolve and ground (pure, the only place a quote is created):**
```ts
function resolveCitation(c: ModelCitation, aliasMap, table): Result<Citation, "unknown_alias" | "foreign_document" | "not_visible">
function groundValue(field: FieldSpec /* M8's closed-kind type, INT-022 */, value: Json, spans: SpanRecord[]): "exact" | "normalised" | "ungrounded"
// ungrounded values are DROPPED with a trace line, never repaired. `normalised` means the field's deterministic normaliser (date, amount, IBAN, LEI, name) applied to the span text yields the value.
```
The quote shown to users and passed to M4 is always `span.exact`; the model's own text never appears as a quote. A model that wants a sub-span of a sentence cannot get it; narrower evidence comes from finer spans (clauses), by design. Multi-span citations render as separate quotes with ` … ` only in display.

### 7. Tests and acceptance
`DI-P01` every alias and id in a planted adversarial model output (unknown, other document, hidden-text-derived, off-by-one, forged delimiter, nonce echo) is rejected; `DI-P02` span segmentation stability (property: concatenating spans of a block reproduces the block text modulo separators; no span crosses blocks or cells); `DI-P03` determinism across ICU versions; `DI-P04` coverage: fraction of gold claims (generator-known) citable by at most three spans, per document type, baseline sentence-only; `DI-P05` `groundValue` fuzz against typed fields (dates in nine formats, ambiguous `03/04/2026` returns `ambiguous` not a guess). `DI-P06` span id rule: equal offsets on different pages give distinct ids, re-analysis of the same bytes gives identical ids, and any change to the layer changes every id (ids bind `textLayerHash`).

### 8. Risks and NOT VERIFIED
Sentence boundaries in legal text (numbered clauses, abbreviations) may need a custom rule set; whether the segmenter's quality is adequate is measured by P04 and not claimed. Aliases are per prompt, so cassettes must store the alias map (M7/M14).

### 9. Build notes
After DI-01 and a first layout; small and early, because M4 L0 and M14 prompt design depend on it.

---

## DI-09 Second-extractor differential (LV3)

### 3. Best references
`prior-art/14` A1 (L3 differential), A4 M7; the spec's allowed use of a diff library only to report disagreement (section 19a, "Rejected as core techniques"); `FPDFText_HasUnicodeMapError` and `IsGenerated` (headers); pdf.js operator-list glyph data (read).

### 4. What they actually do
Nothing in the surveyed tools offers a built-in cross-engine check; pdf.js and PDFium differ in word-space synthesis, ligature handling, reading order and bidi, so raw string equality would produce false alarms on benign documents.

### 5. Decision
**Own.** Compare *glyph sets by region*, not strings, and make the alarm rate a measured property (M7).

### 6. Implementation design
1. Both adapters emit `GlyphObs` for the page. For each span quad (union of line pieces), collect the glyphs of adapter B whose centre lies inside the quad (inflated by 1 pt) in B's reading order along the baseline; do the same for adapter A for symmetry.
2. Compare as multisets and sequences after space-and-newline removal and the same ligature expansion: `exact` (sequence equal), `normalised` (equal after NFKC and case-fold on both sides), `set_equal` (same multiset, different order: order disagreement), `partial` (token overlap ≥ θ), `disagree`.
3. Extra signals: B's `HasUnicodeMapError` or `IsGenerated` over covered glyphs, differing colour or render mode between engines, differing glyph counts.
4. `lv3.verdict`: `pass` for `exact|normalised`; `inconclusive` for `set_equal|partial` with the diff attached (a diff library may render the disagreement for humans); `fail` for `disagree` or unicode-map-error. Output feeds `EXTRACTOR_DISAGREE`.
5. Adapter independence caveat: both adapters read the same file; a parser-level trick that both treat identically is invisible. LV4 (render plus OCR) is the third, shape-based check.

### 7. Tests and acceptance
`DI-D01` false-alarm rate on G1 (clean) with intervals: must be low enough that hold-relevant-field escalations from LV3 stay inside the availability budget; `DI-D02` detection on planted extractor-specific errors (ToUnicode swaps, duplicate-object ambiguities, incremental-update ambiguity where engines pick different revisions); `DI-D03` metric M7 definition: agreement per span by stratum. Disproved if false-alarm rate on clean documents makes LV3 `pass` on hold-relevant fields rarer than a pre-registered floor.

### 8. Risks and NOT VERIFIED
Cost: running two engines roughly doubles extraction time (NOT VERIFIED). Agreement could be high for the wrong reason when both engines share a font-substitution behaviour; measured per technique.

### 9. Build notes
Falls out of the two adapters; the comparator is small. Build with DI-02.

---

## DI-10 Hostile-file isolation, resource limits, fuzzing

### 3. Best references
- Node.js v22 permissions documentation (fetched): Permission Model "Stability: 2 - Stable", flags `--permission`, `--allow-fs-read`, `--allow-fs-write`, `--allow-child-process`, `--allow-worker`, `--allow-addons`, `--allow-wasi`; "does not inherit to a worker thread"; symlinks are followed outside granted paths; "does not protect against malicious code" in the sense of not being a sandbox boundary; **no network flag appears in the v22 page** (grep for network terms found only the generic limitation text). History shows stable status from v22.13.0.
- pdf.js advisories: CVE-2024-4367 (GHSA-wgrm-67xf-hhpq, high, `isEvalSupported`, fixed 4.2.67) and CVE-2026-16633 (GHSA-hq66-cqwq-w95j, high, `enableScripting`, fixed 6.2.108), both arbitrary JavaScript when loading a malicious PDF.
- OSS-Fuzz project list includes `pdf-js`, `pdfminersix`, `pdfplumber`, `pikepdf`, `poppler`, `qpdf`, `mupdf`, `xpdf`, `pdfbox` (directory listing); `pdfium` is not a separate OSS-Fuzz project in that list (Chromium fuzzes it by other means; not verified here).
- Jazzer.js (Apache-2.0, 362 stars): coverage-guided in-process fuzzer for Node, ES modules on Node 20.6+, Windows x86_64 listed. fast-check (MIT, 5,199 stars) for property tests. `pdf-association/pdf-differences` (Apache-2.0, 16 stars): catalogue of spec ambiguities, unvetted.
- OWASP Agentic ASI05 control mapping (`10 §G4`), `SEC-X1`, `SEC-X2`, `SEC-I17`.

### 4. What they actually do
Node's permission model restricts file system, child processes, workers, native addons and WASI for code that runs under the flag; it is explicitly not a security boundary against malicious code, does not restrict network in the v22 documentation read, and does not cover worker threads. pdf.js has had two arbitrary-JavaScript advisories in 2024 and 2026, both configuration-dependent.

### 5. Decision
**Own** the isolation harness; adopt Node's permission model as a layer (not the boundary); define profiles honestly. Fuzzing: adapt coverage-guided fuzzing (Jazzer.js) plus a structure-aware PDF mutator of our own.

### 6. Implementation design
**Process model.** `DocWorker` is a separate Node process spawned by the parent through the M7 sandbox port; one document per process, killed after use. No worker threads (permission model not inherited). Input: length-prefixed bytes on stdin, never a path. Output: one JSON document on stdout, size-capped; stderr captured and truncated.
```ts
interface SandboxProfile { id: "judge" | "strict"; backend: CompartmentBackend; node: string[]; env: Record<string,string>; limits: Limits }   // backend: "os-netns" | "node-net-permission" | "node-flags-only", chosen by M8's doctor probe and recorded per run (INT-019)
// judge: node --permission --allow-fs-read=<vendored assets dir only> --max-old-space-size=<MB> ; no --allow-child-process/--allow-worker/--allow-addons/--allow-wasi ; env scrubbed; cwd = empty temp dir; preload hook deletes net/http/https/dns/tls/dgram/child_process from require.cache access (defence in depth, NOT a boundary)
// strict: the same flags, and the run is refused unless the probed backend denies the network (`os-netns`: a container with --network none, read-only root, no capabilities, CPU/memory cgroup limits; or `node-net-permission` on Node >= 25); optional on the judge machine (Dockerfile fallback exists per spec F-RUN); required for any hosted deployment
// judge runs under whichever backend the probe selects; on a Windows judge machine without a container that is `node-flags-only`
interface Limits { bytes: 26214400; pages: 60; objects: 500000; streamDecodedBytes: 67108864; totalDecodedBytes: 268435456; recursion: 64; wallMs: 60000; rssMb: 1024; stdoutBytes: 33554432; imagePixels: 50000000; rasterPixelsPerPage: 16000000 }
```
Numbers are proposals (documents budget, spec F-BUDGET), tuned by the benchmark.
**Network (INT-019).** M8 §C8 owns the mechanism and the claim; M2 only runs under it, through `SandboxPort.spawn` (M7 declares the port, M8 selects the backend). The Node 22 documentation read shows no network permission flag (`--allow-net` first appears in Node 25 at Stability 1.1), and the permission model gives no guarantee against malicious code. M2 therefore never says "network denied" without the probed backend name beside it: `os-netns` and `node-net-permission` deny the network, `node-flags-only` does not and the run report says so. A test proves the difference per backend (`DI-X03`). Spec feedback item 5.
**Parent validation.** Child output is untrusted: validated against the JSON Schema (finite integers within page bounds, string length caps, no duplicate ids); layer text and map hashed by the parent; any `ok` result with zero visible characters on a page the inspector says contains text is converted to a finding `empty_visible_layer`, never "empty success" (principle 5).
**Failure mapping to M7 error classes:** wall-time or memory exceeded: `budget`; encrypted or over caps: `policy` (`blocked_by_policy`); malformed: `validation` with salvage profile available; child crash without a deterministic cause: `transient`, one retry, then `fatal` for the document; the case continues without that document, which M5 treats as a missing required document (hold).
**Fuzzing.**
1. *Structure-aware mutator* over the corpus (seeded, deterministic): flip/duplicate/delete objects, break `/Length`, cyclic `/Kids` and `/Parent`, huge counts, nested forms depth 200, malformed xref offsets, truncation at every 1 KiB boundary, zip-bomb `FlateDecode` chains, name-escape obfuscation, huge MediaBox and negative sizes, NaN-like tokens, giant CMap ranges, font programs with invalid tables, embedded-file names with `../`.
2. *Coverage-guided:* Jazzer.js over the inspector and the layer builder in-process (evaluation tier); crashes reproduce with seed plus commit.
3. *Differential fuzz:* inspector vs pdf.js vs PDFium on page count, text hash and signature byte ranges; disagreements triaged into findings or bugs.
**Oracles.** No parent crash; child terminates within `wallMs` (kill proves it); RSS below cap; output is a typed failure or a schema-valid result; no `ok` with silently empty text; for every `ok` span LV1 passes; no file access outside the allowed directory (planted canary file outside allowed paths is never readable: test calls `fs.readFileSync` from a hook in the child and expects `ERR_ACCESS_DENIED`).

### 7. Tests and acceptance
`DI-X01` hostile corpus (G4) completion: 100% terminate in budget with typed outcome; `DI-X02` permission drills: read outside allowlist, spawn, worker, addon, WASI each denied under `judge`; `DI-X03` network drill, per backend with a positive control: under `node-flags-only` a socket attempt succeeds (documents the limit), under `os-netns` (and `node-net-permission` where available) it fails, and the claim printed follows the probe; `DI-X04` resource drills (decompression bomb, deep nesting, huge page count, infinite content stream loop via recursive form XObject, 100 MB claimed `/Length`); `DI-X05` fuzz run: N CPU-hours without parent crash or hang (report iterations, coverage and unique crashes found, not "secure"); `DI-X06` kill-switch drill. Disproved if any hostile file crashes the parent, hangs past budget or yields an untyped result.

### 8. Risks and NOT VERIFIED
`node --permission` on Windows with WASM modules and vendored paths: NOT VERIFIED; the permission model with `@embedpdf/pdfium` initialisation (it may need fs read of its `.wasm`): to be tested; symlink caveat means the allowed directory must contain none; Windows has no cgroup equivalent from Node (job objects need native code), so memory caps rely on `--max-old-space-size` (heap only; WASM memory is separate: set the WASM maximum pages and add an RSS watchdog in the parent). The sandbox does not defend against a pdf.js or PDFium remote-code-execution bug beyond an OS or container backend (`os-netns`).

### 9. Build notes
M8's compartment table and probes land first (register section 5, smaller notes); the harness and drills come before any real adapter is trusted; the fuzz corpus grows with every bug.

---

## DI-11 Deterministic field proposer and schema completeness

### 3. Best references
`prior-art/10` §D.3 item 5 (deterministic extractor first, disagreement is a conflict item), `SEC-I18` (suppression: required-positive-evidence plus double extraction, spec section 5); DocILE (arXiv 2302.05658; MIT repo; invoice KILE/LIR tasks; dataset terms UNVERIFIED), CUAD (licence UNVERIFIED), ContractNLI (CC-BY-4.0 repo) as external sanity sets (`14 §A3`). Standards used by normalisers: ISO 13616 (IBAN), ISO 17442 (LEI), ISO 7064 mod 97-10 (both checksums), ISO 4217 currency codes, ISO 8601 dates: named from knowledge, not fetched here (UNVERIFIED as citations).

### 4. What they actually do
Layout-aware extraction benchmarks (DocILE) and clause datasets (CUAD) evaluate learned extractors. None provides a deterministic anchor-based baseline tied to hash-verified spans. Our own design below is a baseline, not a state of the art.

### 5. Decision
**Own.** Small, auditable, anchor-based extraction per document type over the span table, producing the *deterministic half* of double extraction and the schema-completeness record.

### 6. Implementation design
```ts
type ParserId = string;   // key into M2's registry of pure parsers and normalisers (for example `date.explicit-formats-v1`, `iban.mod97-v1`); INT-022
interface FieldCandidate { field: string; docType: string; valueNorm: Json; valueRaw: string; spanIds: SpanId[]; parser: ParserId;
  method: "label_anchor" | "table_header" | "regex_in_block" | "global_regex"; grounded: "exact" | "normalised"; ambiguity?: string; }
interface DocCompleteness { docType: string; required: string[]; found: string[]; missing: string[]; ambiguous: string[]; verdict: "complete" | "incomplete" }
```
1. **Document type** from title/heading spans and field presence (certificate, audit report, contract, invoice, bank letter); unknown type is reported, not guessed.
2. **Field specs** live in the pack and re-use M8 §C9's `FieldSpec` as the normative type (INT-022; one `ExtractionSchema`: M8 owns the closed kinds and the validator, M2 the parsers, normalisers and `groundValue`, M14 the prompt). The kinds are `enum` (with anchors), `bool`, `int`, `date`, `decimal`, `id`, `span_ref`; there is no free-string kind. M2 adds `docTypes`, `labels` (multilingual list), `required`, `holdRelevant` (the one flag name shared with M14; formerly M2's `critical`), `parser: ParserId` and `anchors`. Proposed kind mapping, M8 to confirm: identifiers (certificate number, IBAN, LEI, invoice number, PO reference) are `id`; dates `date`; amounts `decimal` with the currency a separate `enum` field; result, standard and rating `enum` with anchors; free text (names, addresses, scope, parties, clauses) `span_ref`, whose text is shown only from the stored layer. Pack fields: certificate (number, standard, certification body, scope, issue date, expiry date, holder legal name, address), audit (auditor, audit date, result, rating or score, number of major findings, corrective-action deadline), contract (parties, effective date, term, payment terms, governing law, bank-account clause), invoice (number, date, currency, total, payee name, IBAN or account, PO reference).
3. **Extraction by anchor:** key-value spans from DI-03 (`kv_key` matched against label lists by normalised equality then bounded edit distance), table headers (column header matches, value is the cell below), regex inside the labelled block, `global_regex` only for self-checking identifiers (IBAN, LEI, URL) and flagged `lower_authority`.
4. **Normalisers (pure):** dates through explicit formats with an `ambiguous` result when day/month order cannot be decided (`03/04/2026` is not guessed; a document-level locale vote may disambiguate only when the same document contains an unambiguous date); amounts with currency and thousands/decimal separators; IBAN and LEI checksum validation (`checksumOk` recorded); names normalised only to casefold-NFKC for comparison, raw kept.
5. **Completeness:** `required` fields missing or ambiguous on a document type produce `DocCompleteness.incomplete`, which M5 reads as the feature `doc.complete.<docType>` (INT-015) and treats as absence of a required positive fact (a certificate with no expiry holds). Extraction never fills a default.
6. **Interplay with the model extractor (M14):** both outputs are compared field by field by M3, which consumes M14's agreement states (`agree | model_only | parser_only | disagree`, carried in the shared `ExtractionDiag`) as conflict items; here we only guarantee that every candidate is grounded in a span and carries a `method` for the conflict explanation.

### 7. Tests and acceptance
`DI-F01` per field and doc type: precision and recall against generator ground truth, per layout stratum, document-clustered intervals; baselines: model-only extractor, regex-only; `DI-F02` planted suppression: remove or hide the expiry field; completeness must flag and M5 must hold (joint test with M5); `DI-F03` ambiguous-date and checksum vectors; `DI-F04` external sanity on DocILE/CUAD subsets only where terms allow (otherwise hashes, no bodies). Disproved if the deterministic proposer matches or beats the model on precision for the identifier fields (then the model is not needed there) or misses fields the model finds on more than a pre-registered share (then double extraction is informative).

### 8. Risks and NOT VERIFIED
Real certificate layouts vary widely; the label lists are English-first. Generalisation beyond the corpus is not claimed.

### 9. Build notes
After DI-03 and DI-08; shares the generator's ground truth.

---

## DI-12 Locator-fidelity benchmark with by-construction ground truth

### 3. Best references
`prior-art/14` §A3 (every surveyed benchmark scores similarity to its own truth; none scores whether a citation selects the glyphs a human would highlight; this is the gap-claim, limited by the survey); PureDocBench (content held fixed across degradations); olmOCR-Bench review (exact-substring brittleness); ParseBench's visual-grounding dimension (metric unread, UNVERIFIED); Chromium and Playwright (`microsoft/playwright` Apache-2.0, 97,623 stars) for print-to-PDF; Typst (Apache-2.0, 56,595 stars); `fonttools` (MIT) for font subsetting.

### 4. What they actually do
Existing benchmarks compare extracted Markdown or JSON to annotations using edit distance, tree similarity or unit tests; linearisation choices dominate scores (as argued by third parties, not fetched). They provide no character-to-glyph truth.

### 5. Decision
**Own.** A benchmark whose truth is created, not annotated: the generator knows where each glyph is placed. Publishable artefact (spec section 17, `02-research-contributions` pillar). Honesty requirement: the truth itself is validated.

### 6. Implementation design
**Generator ownership (INT-047).** The one document-corpus generator is M11 E4's; the truth classes and series below are requirements on it, the typesetter set is decided by E4's spike and recorded in `docs/DECISIONS.md`, and M11 S4 reports the metrics defined here. This component keeps the metric definitions, the oracle-validation requirement and the harness.

**Truth classes.** *G-exact*: Chromium print (DOM `Range.getClientRects` per character, each `.page` box absolutely sized, `break-after: page`, zero margins) and our own PDF stream writer (we emit each glyph at a computed position with standard-14 or embedded subset fonts; width from font metrics). *G-text*: Typst-typeset documents (real typesetter: ligatures, hyphenation, columns, footnotes); truth is the source text and block order, boxes unknown, so only text-level metrics apply.
**Oracle validation (mandatory, or the benchmark is invalid).** For every G-exact document render with PDFium at 300 dpi and check that ink mass concentrates in the truth boxes (at least 95% of changed pixels per glyph inside its box inflated by 1 px; none outside any box except decorations declared by the generator). Documents failing validation are excluded and counted; if more than 1% fail for a typesetter, that typesetter's box metrics are withdrawn.
**Items.** (a) *Canary spans:* unique 10-letter nonce words per document placed in every layout cell: alignment-free test (search the layer for the string; unique by construction). (b) *Quote items:* gold sentences with known source ranges and glyph boxes. (c) *Repeated-clause items:* identical clauses repeated 2 to 5 times with distinct prefix/suffix; gold occurrence id. (d) *Table cells* with row/column truth. (e) *Order truth:* ordered block list per page.
**Protocols.** P-quote: give the system the gold quote plus its prefix and suffix and require a locator; P-span: the system's own span table, each gold sentence matched by maximal overlap. Locator status comes from the real policy (`verified` requires LV1 and, for hold-relevant fields, LV3).
**Definitions** (G = gold item with text `g`, page `p`, glyph-box set `B`; L = system locator with quads `Q`):
- `textOk` iff `norm(layer.slice(L)) == norm(g)`, with the benchmark's own normaliser (casefold, ligature expansion, space collapse), published.
- `placeIoU` = rasterised IoU of `union(Q)` and `union(B)` on a 0.25 pt grid (handles rotated quads).
- `wrong_place` iff `L.page != p` or `placeIoU < 0.5`; `imprecise` iff `0.5 <= placeIoU < 0.9`; `ok` iff `textOk` and `placeIoU >= 0.9`.
- **Silent-wrong** (primary): status `verified` and (`not textOk` or `wrong_place`). **Silent-imprecise:** `verified` and `imprecise`. Honest failure: status `failed(typed)` or `relocated`.
**Metrics** (each with document-clustered 95% intervals; cluster = base document, because variants share content): M0 silent-wrong rate (and its one-sided upper bound when zero: `1 - 0.05^(1/D)` for D documents: 0.50% at D=600); M1 round-trip exact match (canaries and quotes); M2 box fidelity (mean, 5th percentile, fraction `placeIoU >= 0.9`) by layout stratum; M3 reading order (clauses split or interleaved, Kendall tau); M4 repeated-clause disambiguation by `(exact, prefix, suffix)` uniqueness and correct occurrence; M5 determinism (byte-identical layer across 3 runs, 2 OSes, 2 Node patch versions); M6 honest failure on G2/G4 (typed vs silent-empty vs silent-garbage); M7 LV3 agreement and false-alarm rate; M8 hidden-text recall per technique and benign false-quarantine rate (DI-04/05); M9 table cell accuracy; M10 signature attack detection and benign false positives (DI-06); M11 cost (latency, RSS, bytes, owned lines); M12 field proposer P/R (DI-11).
**Statistics.** Cluster bootstrap over base documents; Clopper-Pearson on cluster-level events; paired comparisons between candidates on identical documents; three runs, worst and median reported separately for stochastic components; thresholds frozen on dev before the test split is opened; the sample size statement: with D=600 clean G1 documents and zero silent-wrong events the one-sided 95% upper bound on the document-level rate is 0.50%; per-technique recall with all 60 detected has lower bound 0.951; 300 benign documents with zero false quarantines give an upper bound of 0.99%. These are proposals; below the planned size, the report says the interval is wide.
**Baselines to report beside ours:** pdf.js `getTextContent` offsets, PDFium `FPDFText_GetText` indices, LiteParse, Docling (fixtures), pdfplumber (oracle), PyMuPDF (oracle, never shipped), and a naive "search the extractor's string" locator (so the gap our layer closes is visible).

### 7. Tests and acceptance
Harness self-tests: positive control (a deliberately shifted-by-one-glyph extractor must produce silent-wrong > 0), inert control (an extractor returning empty text must be `failed`, not `ok`), oracle-validation failure injection (move truth boxes by 3 pt and the validator must reject), idempotent regeneration (same seed gives byte-identical corpus). Acceptance for M2: M0 = 0 on test split for the chosen primary; M1 lower bound at least 0.98 for any stratum where line-level highlights are promised; all metrics published with the list of strata and cases not covered.

### 8. Risks and NOT VERIFIED
The Chromium path may paginate or position text differently in print than the DOM measurement (the oracle validation exists because this is not verified); fonts used are few; typesetter diversity is two plus one text-only; real-world PDFs from producers such as Word, InDesign, SAP and scanners are underrepresented (rights, G3 stays hash-only); a gap claim ("no published benchmark does this") is limited by the survey and must be re-searched before it appears in a grant.

### 9. Build notes
Second thing built after DI-01: the metric harness, self-tested on hand-made vectors. It consumes the corpus from M11 E4 (build step 11), which bake-off 4 also consumes.

---

## DI-13 Document corpus requirements (generator owned by M11 E4)

### 3. Best references
Seeded generator design in spec section 16 (synthetic silos, ground-truth labels); `prior-art/14` §A4 (G1 to G4) and §A5 (technique list and benign controls); `prior-art/10` §D.10 (benign twins, held-out seeds); Plumbline-Inject (spec section 17); Noto fonts (`notofonts.github.io` Apache-2.0 and OFL-1.1 files; per-file licence to be read before commit); Playwright, Typst, `fonttools`, `pdf-lib` (MIT; quiet since 2024-07-17, not used as the core writer).

### 4. What they actually do
`pdf-lib` writes PDFs but offers no glyph-level ground truth; Playwright prints HTML; Typst typesets documents. None emits truth.

### 5. Decision
**Requirements only (INT-047).** One document-corpus generator exists, owned by M11 E4 (independence from system code, seeded-RNG exception, independent review, regeneration check). This component is its requirements document: technique list, series, counts, truth schema (`truth.json`, integer milli-point boxes) and cluster-based splits; M11 E4 adopts the series and the truth schema. The typesetter set (pdfkit, Typst, Chromium, own writer) is decided by E4's spike and recorded in `docs/DECISIONS.md`; the implementation language is E4's choice. Corpus **PLD-1** (Plumbline Locator and Document corpus).

### 6. Implementation design
The generator must accept and produce the following.

**Inputs.** `seed: bigint`, `profile`, entity pool from the silo generator (synthetic organisation names only, per F-PERSONS; natural-person names are labelled synthetic placeholders).
**Content grammar.** Document types: ISO-style certificate, factory audit report, master services agreement (with repeated boilerplate), invoice, bank letter, change-of-details notice. Each type has a section grammar (headings, clauses, tables, footnotes, signature blocks) with parameterised facts (names, dates, numbers, identifiers with valid checksums) taken from the case's ground truth so extraction is checkable.
**Layout axes.** columns 1 to 3, tables ruled/unruled/merged/multi-page, headers and footers, footnotes, rotated pages and rotated margin text, CropBox/MediaBox mismatch, hyphenation, ligatures, RTL and CJK fragments, mixed fonts, embedded vs standard-14 fonts, tagged vs untagged, repeated clauses across vendors.
**Series.**
- **G1** born-digital with truth (typesetter mix as decided by E4's spike; the counts below are the requirement): Chromium (300 docs), own writer (200 docs, including adversarial ToUnicode variants), Typst (100 docs, text-only truth).
- **G2** degraded copies of G1: raster at 100 to 300 dpi, skew, noise, JPEG, low contrast, image-only PDFs and PDFs with an invisible OCR layer (benign invisibility).
- **H-series (hidden text and carriers)**, each technique injected into 60 distinct base documents with its benign twin (the same base without injection): render mode 3, white-on-white, near-white, same colour as coloured background, tiny font, off-page, optional-content off, zero alpha, covered by later rectangle, clipped, under image, annotation-only text, metadata and XMP text, embedded-file text, form-field value, JavaScript action strings, Unicode tags, zero-width, bidi controls, homoglyph vendor names, ToUnicode/encoding remap, `ActualText`, shadow-attack revisions, instruction split across pages. Benign controls: OCR layers, watermarks, light-grey headings, 6 pt footnotes, rotated margin text, crop marks.
- **S-series (signatures)**: signed by pyHanko (evaluation tier) with a synthetic CA, plus the attack set of DI-06; PAdES levels B-B to B-LTA.
- **G4 hostile**: output of the DI-10 mutator plus hand-built bombs, polyglots, cycles, encryption, huge counts.
- **G3 real public documents** (for example EDGAR filings): hash and metadata only until reuse terms are verified.
**Splits.** Dev and test by base-document cluster; test opened once per pre-registered run; a held-out seed range never visible to tuning.
**Output per document.** `doc.pdf`, `truth.json` (JCS; integer milli-points; glyph boxes, order, tables, gold spans, injected technique metadata), `manifest.json` (seed, generator commit, typesetter, font hashes, template id, cluster id). Truth never travels with the document into the pipeline under test (separate directory; a test greps the pipeline's input list).
**Independent review.** Generator specification and a sample of 100 documents with truth overlays reviewed by someone who did not write it (spec section 16 circularity rule); the oracle validation of DI-12 is the machine check.
**Size and reproducibility.** Rough counts: G1 600, G2 300, H 1,500 to 2,000 (22 techniques x 60 base documents with shared twins), S about 200, G4 300 (proposals). Corpora are regenerated from seeds in the evaluation tier; only a small curated subset plus hashes is committed (repository size check, `scripts/repo_size_check.py`). Disk is budgeted before generation; archives live outside the repository.

### 7. Tests and acceptance
Regeneration is byte-identical for the same seed and generator commit; truth validation passes at at least 99% per typesetter; template and cluster balance reported; every technique has benign twins; a lint rejects any real personal data (F-PERSONS).

### 8. Risks and NOT VERIFIED
Synthetic corpus bias: a pipeline tuned on our templates may fail on real documents (stated limit, external G3 hash-only checks and public subsets are partial mitigations). Font licences to read per file. LibreOffice or LaTeX typesetters are not planned (install weight); a third full-truth typesetter is a future addition.

### 9. Build notes
Delivery order requested from M11 E4 (build step 11, after the M1 silo contract): the writer-based exact-truth set first, then the content grammar, then the second typesetter, then H-series injectors, then S-series and G4.

---

## DI-14 Evidence-viewer data contract and standards export

### 3. Best references
`prior-art/14` Part B (B1 standards, B2 viewers, B3 citation-trust studies, B5 viewer design, B6 WCAG 2.2); Ding et al., AAAI 2025 (arXiv 2501.01303: citations, even random, raised trust; checking them lowered it) as the reason the chip must be computed; PaperTrail (arXiv 2602.21045); W3C Web Annotation; RFC 8118; WICG text fragments; pdf.js viewer `enableScripting` advisory (CVE-2026-16633).

### 4. What they actually do
Citation UIs show a link or badge; none re-hashes the stored artefacts in the page. react-pdf-highlighter-style libraries store scaled rectangles (`14 §B2.1`).

### 5. Decision
**Own** the contract and the chip computation; use pdf.js for drawing the page (canvas) with `enableScripting: false`; draw highlights from stored `quads`, not from the text layer; export W3C annotations as an interoperability view.

### 6. Implementation design
**Package members for one document.** M9's bundle layout is normative (INT-052): content-addressed `evidence/blobs/sha256/..`, `evidence/index.json`, and `evidence/stubs/..` for bodies not shipped. M2's members are blob roles plus derived member roles, each with its own hash in `bundle.json`:
```
evidence/blobs/sha256/<hex>              # role `source`: the PDF bytes; hash = docSha; ABSENT when rights-gated (a stub; the viewer enters "layer-only")
evidence/blobs/sha256/<hex>              # role `textlayer`: layer.txt, the visible layer; hash = textLayerHash
evidence/derived/<docId>/layer.geo       # optional; hash = geoHash
evidence/derived/<docId>/manifest.json   # TextLayerManifest (JCS), DocumentAnalysis summary, hashes of all members
evidence/derived/<docId>/spans.json      # SpanRecord[] (JCS)
evidence/derived/<docId>/findings.json   # DocFinding[], DocRisk, SignatureRecord[] (JCS)
evidence/derived/<docId>/pages/<n>.png   # page raster at 144 dpi (PDFium scale 2.0), exported for the viewer (M10 F3)
```
Rasters and quads are display aids outside the verified chain but are hashed; each raster records page, scale and the PDFium build hash, and reuses the DI-04 channel P render when one exists. A layer-only bundle draws the raster, or the quote view when no raster is shipped.

**What the browser re-computes on click** (`WebCrypto SHA-256`, pure functions shared with the console tests):
1. `sha256(source) == manifest.docSha` (skipped with state `layer-only` if the PDF is absent).
2. `sha256(layer.txt blob) == manifest.textLayerHash == span.textLayerHash == the claim's locator.textLayerHash`.
3. Split on U+000C, take page, `Array.from(text)` slice `[start,end)` (code points), equals `span.exact` and equals the quote M4 recorded for the citation (`quoteFromLedger`); `sha256(utf8(exact)) == span.spanSha`; then the unit cross-check of LV1 (`TextEncoder` page bytes: slice `[byteStart,byteEnd)` equals the quote bytes, both ends on code-point boundaries, code-point count before `byteStart` equals `start`). A disagreement is shown as `hash mismatch (span)` with reason `LOCATOR_UNIT_MISMATCH`, never as verified.
4. Geometry sanity: each quad inside the page box; page rotation applied by pdf.js `viewport.convertToViewportRectangle` per corner.
5. Status flags from the bundle: LV1 recomputed here; LV3/LV4 as recorded; the standalone verifier's result file hash recorded in the bundle and compared (a `verified` state is shown only if the page's recomputation and the recorded verifier PASS agree).
**States** (INT-052: `chipState` returns one of these named states, never a colour; M10 owns colour and icon and adopts all ten, `layer-only` first-class; M2 supplies the text label and `aria` text, so the meaning never rests on colour alone): `verified exact`, `verified (OCR, min conf n)`, `layer-only (source not shipped)`, `relocated`, `hash mismatch (source|layer|span)`, `extractor disagree`, `hidden-text finding on page`, `quote absent`, `not checked`, `unavailable`.
**Inert rendering.** Document text, previews and findings go into the DOM only as `textContent` inside labelled evidence panes, no HTML, no links, no images from document content (ASI09 and EchoLeak-style defence from `10 §D.5`).
**Accessible equivalents.** The quote view (prefix grey, exact in `mark`, suffix grey) and a plain-text rendering of the page's visible layer are the screen-reader path; every chip is a button with name "document, page, status".
**Standards export.** `SpanRecord` to a Web Annotation: target `{source: docId URI, selector: FragmentSelector {value: "page=N", conformsTo RFC 8118} refinedBy [TextPositionSelector{start,end}, TextQuoteSelector{exact,prefix,suffix}, SvgSelector(quads)]}` plus extension properties in a declared context for `docSha`, `textLayerHash`, `spanSha`, `unit: "codepoint"`, `byteStart`, `byteEnd`, visibility, LV results. Deep link `source.pdf#page=N` in the export; for web-page evidence a text-fragment link built from the quote selector.

### 7. Tests and acceptance
`DI-W01` browser/Node parity: the page's verification functions and the verifier core agree on 10,000 generated cases including astral and combining characters and the unit-mismatch mutants; `DI-W02` tamper matrix (flip a byte in PDF, layer, span record, manifest; swap layer of another document; truncate; reorder pages): the chip must not show a `verified` state in any case, and must match the verifier's verdict; `DI-W06` raster export: each raster's hash matches `bundle.json`, page and scale are recorded, and tampering with a raster changes no verified state (rasters are outside the chain); `DI-W03` keyboard-only and screen-reader pass per `QA_MASTER_GUIDE.md`; `DI-W04` zero console errors, light/dark, mobile; `DI-W05` hostile content: a layer containing `<script>`, bidi controls, a 1 MB line and Zalgo text renders inertly. The user-study contribution (verified UI versus citation-presence UI) is specified in `14 §11.3` and belongs to M10/M11.

### 8. Risks and NOT VERIFIED
Browser support for RFC 8118 `highlight` and PDF text fragments: UNVERIFIED (viewer never relies on them). Performance of hashing a large PDF in the page: NOT VERIFIED. If the PDF is rights-gated, the viewer can prove only the layer, not the source (stated on screen).

### 9. Build notes
After DI-01 and DI-08; the verification functions are written once as a small dependency-free module reused by the console, tests, and the second verifier implementation's vectors.

---

## DI-15 Guarantee-table row and claims lint for documents

### 6. Implementation design
Row for spec section 9a (replaces "Document and locator fidelity"; register section 4; answers AUD-04 and GB-01 locator-fidelity gap):

| Dimension | What is established | What is not established |
|---|---|---|
| Document-to-text-layer fidelity | For a document analysed by the pinned pipeline: the cited span is at the cited offset of the stored visible text layer, whose hash is recorded (LV1, checked in code points and in UTF-8 bytes); the two extractors agree at the span's region or the disagreement is recorded (LV3); every admitted glyph was drawn and produced ink in both the operator and the pixel channel; hidden, faint and suspect glyphs were excluded and reported; signature presence, validity and content-since-signing are separate fields. Rates: the measured silent-wrong locator rate with its document-clustered upper bound, per-technique hidden-text recall and benign false-quarantine rate, on the PLD-1 test split | That the original PDF says it in any viewer other than the PDFium rendering used; documents of types, producers, scripts or layouts outside PLD-1; visual forgery (edited images, fabricated seals) and handwriting; shape or encoding remaps on pages where the OCR cross-check did not run; OCR text beyond its measured accuracy; whether a signer is who they claim; the truth of the content |

Wording lint: "verified locator", "tamper-proof", "guaranteed" and "by construction" may only appear in M2 text next to this row's established column; the README may say "a cited quote re-verifies against the stored text layer" and may not say "against the PDF" without naming the extractor and the measured rate.

### 7. Tests and acceptance
`DI-L01` the lint on README, deck, UI strings and trace text; `DI-L02` every number in the row traces to a report line in `eval/reports/`.

---

## Interfaces table

| Exposes | Type | Consumers | Notes |
|---|---|---|---|
| `analyseDocument(blobRef, evidence, opts, ctx)` | `Promise<Result<DocumentAnalysis, DocError>>` | M3, M4, M5, M8, M10 (input comes from M1 channel 11j as a blob reference plus its `Evidence`) | Runs in the `DocWorker` sandbox; deterministic stage, replayable on any input; cassette stores `(docSha, pipelineVersion) -> analysisHash` (a `DocHash`), not model data |
| `TextLayerManifest`, `layer.txt`, `layer.geo` | JCS + bytes | M4 (L0), M9 (bundle members, verifier LV1), M10 | `RawHash` for bytes, `DocHash` (JCS, domain-tagged) for JSON |
| `DocLocator` / shared `Locator` mapping | type | M3, M4, M9, M10 | Resolver `textlayer`; unit `codepoint` plus `byteStart`/`byteEnd` (INT-004); spec feedback item 1 |
| `lv1(layerTxt, span)`, `sliceCodePoints` | pure functions | M9 verifier core (reimplemented, byte-slicing), M10 (browser) | Shared test vectors; unit mismatch is `LOCATOR_UNIT_MISMATCH` (`V5.` in the verifier) |
| `SpanRecord[]`, `renderForModel`, `resolveCitation`, `groundValue` | types and pure functions | M4 (its `Span` is a view over `SpanRecord`), M14 | Alias map stored in cassettes; span id rule in DI-01 |
| `FieldCandidate[]`, `DocCompleteness` | typed facts, label inherited from the input `Evidence` and never raised | M3, M5 (`doc.complete.<docType>`), M14 | Deterministic half of double extraction; built against M8's `FieldSpec` |
| `DocFinding[]`, `DocRisk` | typed facts, restrict-only | M5 (`doc.risk.<code>`), M8 (carriers, `SEC-I*` oracles), M10 | Absence of a finding is not permission; feeds `escalate`, never `reject` |
| `SignatureRecord[]` | typed facts | M5, M9, M10 | Three separate fields; pins from relying party |
| `SandboxProfile`, `Limits`, drills | config + tests | M7 (`SandboxPort`), M8 (`CompartmentBackend`) | Uses M7 `ctx.sandbox` and budgets; M7 declares the port, M8 selects the backend (INT-056) |
| PLD-1 requirements (DI-13), `truth.json` schema, metrics harness (DI-12) | spec + tool | M11 (E4 builds the generator; S4 reports) | Spec section 17 artefact: locator-fidelity benchmark |
| Evidence package members (DI-14) | blob roles `source`, `textlayer` and `evidence/derived/<docId>/..` members | M9, M10 | Rights-gated PDFs ship hash-only; viewer enters layer-only; page rasters at 144 dpi |
| Web Annotation export | JSON-LD | external tools | Extension context declared |
| Requests to other modules | | M7: `SandboxPort` spawn, kill, budget (section 2.2 of the register); M8: per-run datamark nonce, compartment backend and probes; M1: channel 11j blob reference with `Evidence` (`bodyHash`, authorship, rights class); M5: shared severity map; M4: hyphen `joinHints` | |

## Spec feedback

1. **`Locator` is too thin** (conventions and spec section 6): a doc locator also needs `docSha`, `revision`, `layerId`, `unit`, `exact`, `spanSha`, `prefix`, `suffix`, `quads`. **Resolved by INT-004.** The shared `Locator` now carries `docSha`, `revision`, `layerId`, `textLayerHash`, `unit: "codepoint"`, `byteStart`, `byteEnd` and the resolver kind `textlayer`; `exact`, `spanSha`, `prefix`, `suffix` and `quads` stay in `SpanRecord`; `start`/`end` are page-relative code-point offsets over the visible layer, never normalised.
2. **Level names collide**: spec section 7 uses L1 to L4 for locator verification and section 9 uses L0 to L4 for claim verification. This blueprint uses LV1 to LV4; the spec should too. **Resolved by INT-011** (LV1 to LV4 for locators; spec text edit).
3. **Hash type**: the shared `Hash` is "hex digest of JCS-canonical bytes, domain-separated". Original document bytes, layer text and span text need a plain SHA-256 so a stranger can check with a standard tool. **Resolved by INT-003**: shared `RawHash` (`sha256:`), `DocHash` (`jcs:`), `Commitment` (`com:`); M2 declares no private digest type.
4. **OCR and scans are unspecified** for the visible layer. This blueprint decides: on a scan page the visible layer is our OCR, the native invisible layer is compared and never used as evidence. The spec should say so. **Resolved by INT-065** (spec section 7 text edit).
5. **Network denial claim** (spec section 5, "NOT VERIFIED which flags exist in the Node 22 line"): the v22 documentation read shows a stable permission model without a network flag, not inherited by worker threads, with native addons blocked unless allowed. Network denial therefore needs an OS or container backend (or Node >= 25); update section 5 and section 22. **Resolved by INT-019**: M8 section C8 owns the mechanism and the claim, the backend that ran is recorded and the claim follows the probe.
6. **Spec section 7 default extractors**: `hyzyla/pdfium` does not expose per-character data, but `@embedpdf/pdfium` declares it. Bake-off 4 candidate list should name it. Also record that pdf.js defaults to recovering from errors (`stopAtErrors: false`); we set it to true. **Resolved by INT-065** (spec section 7 text edit).
7. **Docling fixtures**: the spec says outputs are committed fixtures with `documentHash, page, line or offset, ...`; offsets from Docling must not be trusted. Replace with: fixtures provide structure hints re-anchored into our layer; they never provide locators. **Resolved by INT-065** (spec section 7 text edit).
8. **M4 normaliser** should consume `joinHints` (line-end hyphenation) and use the layer's lack of NFC/NFKC; the quote index map in `04 §0a` assumes raw positions, which this layer provides. **Resolved by INT-004** (M4 drops the NFC assumption and consumes `joinHints` in its `linebreak_hyphen` fold).
9. **Policy vocabulary**: M5 needs the `DocRiskCode` set and severity map; findings are `UNTRUSTED`-derived and consumed restrict-only. The spec should state that these are inputs to `escalate`, not to `reject`, and that "no findings" never counts as clearance. **Resolved by INT-015** (M5 features `doc.risk.<code>`, `doc.complete.<docType>`) and **INT-065** (spec text edit).
10. **Evidence viewer when the PDF is not shipped** (rights gate): section 14 assumes the browser re-hashes the document; add the `layer-only` state to the chip vocabulary. **Resolved by INT-052** (M2's ten states adopted, `layer-only` first-class).
11. **Acceptance line for M2** (section 21b) lists "sanitiser flip rate"; define it as the decision-flip rate with visibility enforcement on versus off, measured in M11 (needs M14 extractor and M5 policy), with the positive control. **Resolved by INT-065** (spec section 21b text edit).
12. **Sanitiser terminology**: section 7 calls the defence a sanitiser in places; the design is an exclusion-plus-signal (the layer excludes, never rewrites), which is what makes locators stable. Use "visibility filter". **Resolved by INT-065** (spec section 7 text edit).
13. **Sponsor profile and OCR**: Tesseract.js is not a Nemotron path; if the sponsor profile requires model-based OCR the rule brain cannot run it; the judge default stays classical OCR, stated in the sponsor note. **Resolved by INT-062** (spec wording; the NVIDIA "OpenAI-compatible" claim stays NOT VERIFIED beyond base URL and path).

## What this blueprint does not cover

- Model-based extraction prompts, the quarantined extractor's prompt, and the double-extraction conflict logic (M14, M3).
- The L0 quote matcher and normalisation (M4); this module supplies the layer and the span table only.
- Visual forgery and image tampering (spec section 21c item 4), handwriting, seals, stamps, charts.
- Non-PDF formats (Office, HTML, email, images other than as scans); web-page evidence is M1.
- Scripts and languages beyond English OCR and the scripts in the corpus; locale-specific date formats beyond the declared list.
- Corpus generation (M11 E4), document intake and the authorship, trust and rights assignment (M1 channel 11j), and the network-denial mechanism and its claim (M8 section C8).
- Legal validity of signatures, EU trusted lists, qualified-signature status.
- Real-world producer coverage (Word, InDesign, SAP, scanner firmware): the corpus is synthetic; G3 real documents are hash-only until rights are verified.
- Performance at scale (thousands of documents), cost per document, and the capacity model (spec section 21c item 6).
- The user study on verified-evidence UI versus citation-presence UI (`14 §11.3`).
- Everything marked NOT VERIFIED above: no number in this file is a measurement; the thresholds, budgets, sizes and timings are proposals to be fixed by the pre-registered bake-off and benchmark.

## Pass 3 resolutions (2026-10-13)

Source: `99b-integration-register-pass3.md` (INT-101 onward). These bindings override the body above wherever they differ; the body has not been rewritten. Each line is one binding change; the register item holds the reason and the other modules affected.

- **INT-104.** `Locator.docSha`, `Locator.textLayerHash` and `SpanRecord.spanSha` are `Commitment` whenever the document's `conf` is above `public` or it is `personal` (ctx = member path or span id); hashes of `evidence/derived/` members follow the same rule. Public documents keep `RawHash`.
- **INT-105.** Text span ids: `sp_` + first 24 hex of the `DocHash` of `{layer: textLayerHash, page, start, end}` under tag `plumbline/span/v1`. M4's field spans use the distinct tag `plumbline/field-span/v1`.
- **INT-110.** Outside this file M2's metric ids are cited `DI-M0` to `DI-M12`; a bare `M<n>` always means a module.
- **INT-115.** The extractor's `producer` is `parser_deterministic` or `model_extractor`; DI-05 maps findings to `add_restriction` only.
- **INT-118.** Every output (`SpanRecord`, field candidates, findings, completeness) is labelled by M8 `fromSource` from the document's `Evidence`: `conf`, `personal`, `authorship` and `tier` are the document's; `trust` is `UNTRUSTED` when the document is `counterparty` or `third_party` authored, otherwise the meet of the document trust and the producer ceiling. Never raised.
- **INT-119.** Counterparty names, clauses and any free text are kind `span_ref` (code derives the string from the layer by span id); amounts `decimal`, dates `date`, identifiers `id`, enumerations `enum` with anchors; no free-string kind.
- **INT-120.** `ExtractionDiag.doubleExtracted = "single"` means one extractor ran. It is neither agreement nor disagreement and, on a `holdRelevant` field, is the gap `single_extraction` (restrict-only).
- **INT-121.** Wherever DI-05 or DI-11 say a missing feature is "level 0", read: absent and restrict-only (every `permits` atom false, every hold atom true).
- **INT-124.** The sandboxed document call is class A replay (a novel document in replay is `E_CASSETTE_MISS`); it runs `live` on any new document with no credentials. Remove "replayable on any input" from the interfaces table; the miss message prints the live command.
- **INT-139.** The layer emits a `page_break` join hint per page boundary with the trimmed first and last visible offsets (alongside `linebreak_hyphen`), so M4 can cite a quote that crosses a page as ordered single-page fragments.
- **INT-155.** DI-14: pages are drawn from the shipped 144 dpi rasters (pdf.js is not needed in the browser). The rule "report PASS for a green chip" applies to bundle-backed views; a live case with no bundle may show `verified exact` only with agreement `browser_only` and the label "No bundle report" (M10).
- **INT-156.** The chip state set is eleven: add `erased` ("Source erased under a signed receipt; this passage cannot be checked"), mapped from `V5.ERASED`.


> v5.2 (D-026): profile-pass additions for this module are in `98-profile-pass-additions.md` (adoption register ids; they win over this blueprint where they differ).
