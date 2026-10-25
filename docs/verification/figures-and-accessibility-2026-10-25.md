# Every figure names its class, and the screens can be used without a mouse or a good eye (2026-10-25)

Features DF-078 and DF-087 built. Both rest on one harness: the interface's own client code (`src/desk/ui/client`) is run in Node, against a real server holding the sample, an invoice, the Desk's own calls and a session whose folder carries instruction-like text, with a small stand-in for the browser's DOM (`tests/desk/ui/support/dom-shim.ts`). Every screen the server lists is rendered with the real code, and the trees it builds are audited.

## DF-078: no unlabelled figure

**The rule.** Every dollar figure on every screen sits in a section whose label names its class (billed, reported, estimated, forecast, unknowable, unpriced, or a policy value the owner set), or in a header that does, or carries a `data-class`. Every screen that shows an estimate also says what an estimate is not (not an invoice, not a billing receipt). A figure the sources cannot support is shown as "not priced" or unknowable, never as zero. A price list more than 60 days old puts a stale banner on every screen.

**What the first audit found.** Figures in 17 sections, across Brief, Week, Bill, Autopsy, Outcomes, Policy, Organisation and Evidence, had no class in their section's label: the sub-labels said "by cause", "by landing state", "spend", "yesterday", "by team" and so on. Each now leads with its class ("estimated, by cause"; "policy limits, version of ..."; "forecast, then scored (estimated) on the month that followed"; "billed, reported and estimated: the class of each figure"). Five screens (Week, Sessions, Outcomes, Policy, Evidence) showed estimates without saying they were not invoices; their footnotes now do. The price-list age was only on the Doctor screen; the shell now says it on every screen when it passes 60 days (`meta.price.ageDays`, `stale`).

**What ran.** `tests/desk/ui/figures.test.ts` (6): all 13 screens render and the audit saw more than 150 figures; none is outside a labelled section; every screen with an estimate carries the not-an-invoice statement; the bill shows a call on a model with no price as "not priced"; the new sections (the Desk's own calls, the egress block, the instruction-like-text block) are in; the stale banner appears with a clock set past 60 days and not with a fresh one. The audit was checked by removing one label: it failed, naming the screen and the figure.

## DF-087: accessibility, measured where it can be

**Measured from the style sheet** (`tests/desk/ui/accessibility.test.ts`, both themes): the text, muted, accent and warning colours reach 4.5 to 1 on every surface they sit on; every rule that sets a colour and a background together reaches 4.5 to 1 (3 to 1 for large text); the focus outline reaches 3 to 1 against the page; no transition runs outside the reduced-motion guard; no font size is under 11 px; zoom is not turned off; the page has its language, viewport, title, a skip link and a noscript note.

**Measured from what the client builds**, for all 13 screens and the shell: one top heading and no jump of more than one level; every button, link, select and input has a name; every link has an address; every table has a caption and column scopes; every scrollable table is a labelled, focusable region; every chart is named or hidden from a screen reader; nothing that reacts to a click is out of a keyboard's reach; no positive tabindex; the shell has a banner, a named navigation of thirteen links, a main landmark, a labelled range control and the current screen marked. Provenance numbers are real buttons that announce a popup.

**What the audit found and fixed.** The first run found no section headings: a screen's sections were `div`s, so a screen reader could not list or jump between them, and three screens went from the top heading straight to a third-level one. Each section's label is now a second-level heading, drawn exactly as before. A chart's legend swatch was unnamed inside a hidden element; the audit now treats that as hidden. At 320 px wide, the Policy screen scrolled sideways by 6 px (a label and a select that did not wrap); it wraps now. The header, which wraps to several rows on a phone and covered a third of a 700 px screen, scrolls away below 520 px so that it cannot hide the control a keyboard has just moved to.

**In a real browser** (Chromium, on the sample): Tab reaches the skip link, then the logo, each with a 2 px solid outline; a figure's button opens a named dialog with focus inside it on Enter and closes on Escape with focus back on the figure; at 320 px all 13 screens fit without sideways scrolling (12 did before the Policy fix); the Doctor, Bill and Sessions screens were looked at in light and dark at 1440 and 390 px as they changed.

## Not covered

- **No screen reader was run.** Names, headings, landmarks and roles are checked as structure; what NVDA, JAWS or VoiceOver say is not. The chart descriptions are one sentence each and say the totals, not the shape.
- **Focus order was checked for the first stops and for the popover, not for every control on every screen as a person tabs through it.** The structure rule (nothing out of reach, no positive tabindex) means the order is the page's order.
- **Contrast of non-text parts** (the hatch of a chart segment against its neighbour, a border) is not measured; only text and focus colours are.
- Text zoom to 200%, forced-colours mode and touch-target size were not tested.
- The audit sees the text nodes that are rendered. A figure inside a provenance popover is built when it is opened and was not audited; the popover's class line is covered by the page tests for the provenance helper.
- The command line's own output is not covered by this audit. The wording lint (DF-080) reads it.
