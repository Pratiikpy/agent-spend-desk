# UI sweep, 2026-10-23

Every one of the eleven screens was photographed in light and dark at 1440x900 and at 390x844 (44 captures) and read as a designer would, and the browser console was read on each. The reader was an independent assistant given the screens and a checklist, not the author. The captures are not kept in the repository (7.7 MB); the deck's `img/` holds the ones that are used.

## Facts checked and clean

No horizontal page scroll at 390 px on any screen (document width equals window width on all 22 mobile captures). No `NaN`, `undefined` or `null` text. Zero console errors from the app. Only Outfit and JetBrains Mono are used. No shadow except an inset underline, no gradient. Green appears only for pass, landed and live; orange-red only for risk and fail.

## Found and fixed

- The Ask trace showed a raw recording error (`E_CASSETTE_MISS ... Record it live with: desk record`). The reason was also real: the Planner's prompt had changed, so its recordings were stale. The prompt's recordings were re-made, and the trace now says "no recorded model reply for this question in sample mode, so rules were used instead".
- The Canary screen said "Regressed" twice, its legend ran together, a chart label was crossed by the control line and the axis label sat under the first tick.
- The Bill screen said "No invoice has been imported, so nothing is billed" while Org data showed $6,123 billed. It now says invoices are read on Org data when Zetaris is connected.
- Headings did not match the navigation ("Organisation" against "Org data", "Sources" against "Doctor").
- Dossiers showed the raw enum `NOT_APPLICABLE`; `--pins` rendered as a long dash in the prose font (ligatures are now off).
- Numeric column headers were larger than the others; captions sat flush under the table above; the engine checkboxes were unstyled; backticks showed around session names in Ask answers; the Ask answer panel repeated the word "answered".
- On a phone the navigation was clipped with no cue ("Po"); it now wraps. Wide tables on a phone now say "Scroll sideways for more columns."
- Four source cards sat in a three-column grid and left one alone.

## Found and left as it is, on purpose

- Headline tracking is tight, as the brand kit specifies.
- Rule ids and actions such as `C-LOOP-1` and `pause_with_checkpoint` are shown as written because they are what a policy file contains.
- Some tables on a phone hide their last columns behind a sideways scroll; a mobile summary of each table is not built.
- Chart text is small at 390 px.
- Different screens cover different periods, so the share of landed spend differs between the Bill (30 days) and an Ask answer (the whole ledger).
- The model id and file paths appear in the Canary text as written.

## Not covered

The dark mobile captures of seven screens were looked at only at reduced size. The Ask screen before a question, with an engine switched off, a session detail, the "More" button, the policy "Run the wind tunnel" button and the dropdowns were not photographed.

## Evidence screen (the twelfth), 2026-10-23

The Evidence screen was added after the sweep above. It was photographed in light and dark at 1440x900 and in light at 390x844 and read the same way. Found and fixed: the first-set heading called the Desk's rows "pre-registered" although the table shows the current version; the learning table's change column did not say what it counted; the routing table's signs read as gains (they are drops). On a phone every table becomes stacked cards with no horizontal scroll. No console errors in any capture. Not done: dark mode on a phone for this screen.

## Automated pass over all twelve screens, 2026-10-23

A script visited each of the twelve screens in four views (1440 px and 390 px, light and dark) with console, page-error and failed-request listeners attached from the start. Result: no console error, no page error, no failed request, no horizontal overflow, and every screen rendered its heading. The Dossiers screen verifies each bundle when it opens, so it needs a few seconds before its heading appears; a first pass that waited under two seconds reported it empty, and a second pass that waited seven seconds did not. Not covered by the script: reading each screen as a designer (done by eye for the first eleven on the 23rd and for Evidence in light and dark on desktop and in light on a phone).

## Plan limits on the Brief and the price check on the Bill, 2026-10-24

Two things were added to screens after the sweeps above: the Plan limits block on the Brief (a Codex ledger replayed at a past moment with `desk ui --at`) and the price-source note, the price range and the reported-cost comparison on the Bill (the author's own Claude Code ledger, 125,400 priced calls in the last 30 days). They were photographed and read: the Brief in light at 1440x900 (whole page), in dark at 1440x900 (first screen) and in light at 390x844 (whole page); the Bill in light at 1440x900 (whole page) and in dark at 390x844 (first screen). The browser console showed no error and no warning on either screen, and at 390 px the Bill's width equalled the viewport (no element past the right edge). Nothing needed fixing. One thing seen and left: with `--at` the Brief's date and "yesterday" figures still follow the last day in the ledger, while the plan limits follow the moment asked about, so a replay of a past moment on a ledger that has later days shows both.

Not covered: the Bill in dark at desktop width and in light at phone width, the Brief in dark at phone width, and the other ten screens, which were not changed since the sweeps above.

## The Week screen and the navigation, 2026-10-25

The thirteenth screen (Week, second in the list) was photographed in light at 1440x900 (the whole page) and in dark at 390x844 (the first screen), and the console was read. Two defects were found and fixed: eight Content-Security-Policy errors from an inline style on the week picker (now a stylesheet class) and a navigation that no longer fit in the header row with thirteen screens (the last, Doctor, was cut off behind a hidden scroll bar; the navigation now has its own row under the logo and wraps on a phone). After the fixes the console showed no error. Not covered: the Week screen in dark at desktop width and in light on a phone, and the other screens at the new header height.

## Full audit of all fourteen screens, 2026-10-26

A script visited each of the fourteen screens in four views (1440 px and 390 px, light and dark; 56 captures) with console, page-error, failed-request and HTTP-error listeners attached from the start, and checked on every page: horizontal overflow, the words `undefined`, `NaN`, `null`, `[object` and raw error codes, image alt text, names on buttons and links, labels on inputs, one h1 and no skipped heading level, `lang`, landmarks, tap-target size, and text contrast (4.5:1, 3:1 for large text). Result: no console, page or request error; no overflow at either width; no stray text; every page has one h1, a main landmark and a nav; no text below its contrast ratio. The light desktop and phone captures of every screen were then read as a designer would.

Found and fixed:

- Backticks showed in sentences ("`desk gate serve` starts it", on the Brief, Bill, Policy, Doctor and others). Words between backticks in prose are now drawn as code.
- On the Policy screen the Earned autonomy table was cut off on a desktop: a long "Now" column made each row about 220 px tall and pushed the last columns out of view. The sentence now sits under the name of the kind of work.
- The Evidence screen led with Sets A and B, on which the Desk scores 60 of 60 after it was fixed against them, and did not show Set D, the preregistered round the README and the video lead with (55 against 45 against 12). Set D is now first, with its seven written predictions and the margin it cannot make certain; Sets A and B are labelled post hoc.
- The first screen of the sample gave no account of what desk. is. The Brief now opens, in the sample only, with a short "What you are looking at" block and links to the five screens worth opening first.
- The theme switch said "Light" or "Dark" with no sign of whether that was the current theme or the action. It is now a pressed-state toggle labelled "Dark mode".
- "Causes a rule can see without judgement" (Brief, Autopsy) read as unclear. It now says "causes a rule can identify from the log alone".
- The Week table's column "Type" held engineer names (the sample's branch prefixes) under the heading "kind of task". It is now "Branch prefix", and the section says it is grouped by branch prefix.
- The deck and the product description said twelve and thirteen screens; both say fourteen, and the deck PDF was drawn again.

Found and left as it is, on purpose:

- Inline figure links are small tap targets on a phone (the Sessions screen has about fifty); they are links inside a sentence or a table, and the row link around them is larger.
- The Outcomes screen shows `desk questions answer ... yes|no` as the way to answer, because the screens are read-only.
- Sample branch prefixes are engineers' names, so the autonomy kinds read `eng01`, `eng02`; a real repository's prefixes are `feat`, `fix` and so on.

Not covered: a screen reader was not run (the checks above are structural); keyboard focus order was not walked on every screen; the Ask screen was captured empty and with one question, not with an engine switched off; the policy wind tunnel run and a session detail were not captured in this pass.
