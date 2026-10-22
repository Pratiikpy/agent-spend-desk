# Profile: bilawalsidhu/gods-eye-view

Reader: Haiku (low effort), 2026-10-16, about 92 seconds, 112k tokens, 24 tool calls. Shallow clone (depth 1), version 0.2.1 (deleted after the profile pass). Paths relative to the repository root. This is the reference for the "God's-Eye-style console" in goal G9 (spec section 0.1), read for its information architecture and interaction model for the UI and UX handoff brief.

Spot-check (reviewer, against the files): MIT licence for the source code only, with a note that bundled datasets and runtime data keep their own licences, including a submarine cable map under CC BY-NC-SA 3.0 (non-commercial, share-alike) and map extracts under ODbL (confirmed from the licence note); version 0.2.1 (confirmed); top-level files include DATA_SOURCES.md, THIRD_PARTY_NOTICES.md, Dockerfile, compose.yaml, SECURITY.md and a `pinokio/` installer folder (confirmed by listing). The layer count (about twenty), the panel contract, the voice action count and the performance figure were not rechecked and are the reader's account. Result: PASS on licence; the rest unverified.

## 1. What it is
A browser-based live geospatial console: many real-time sources (aircraft, ships, satellites, earthquakes, cameras, weather, radio) on a 3D globe, with a cockpit mode, a heads-up display and a voice assistant. MIT for code.

## 2. Architecture map
Four construction phases (scene, controls, data, tools). The UI layer owns navigation, panel lifecycle and visual state; the data layer owns feed lifecycle; each layer family owns acquisition and its map resources; portable source modules have no map dependency and return records, status and a last message; a server middleware layer proxies and caches provider calls with budgets.

## 3. Features and how each behaves
Independent layer toggles; a contacts roster within a scope radius with metadata and trails; a camera that follows a tracked contact; selectable sensor looks; three HUD layouts (tactical, operator, minimal); about thirty voice actions; guided first-run missions; a scene director for tours.

## 4. How people use it
Three install routes: a one-click installer, clone and run with a doctor command, or Docker Compose. Keys are optional and added in a power-up panel. Development start-up is reported at about 1.9 seconds on the author's machine (not verified).

## 5. Mechanism for our module (M10 console, information architecture)
Reusable ideas: a panel contract (collapsible side rails, fixed header, scrolling body, outward popups); every source returns the same triple of records, status and last message, so a layer can always say why it is empty; feed state is one entry per layer with selectors for what is visible; request policies (credit governors, daily budgets, disk caches) live at the edge. State kept is small: layer visibility, selected item, camera, panel states, style, HUD layout.

## 6. Agent patterns
One voice session with deterministic actions; no critic or branching. The console is a sensor and control surface, not an agent system.

## 7. Model and data layer
Portable source factories, server-side providers with caching, a catalogue that composes sources.

## 8. Hackathon-care checks
A bundled sample pack for offline demonstration; per-source status; a Docker one-command run; QA scripts and unit tests; server-side proxy with SSRF protection and response caps; keys restricted at the provider. No structured decision trace.

## 9. Traps seen
Third-party dataset licences mixed into a repository with an MIT label; failed upstream queries that do not announce that a fallback was used (reader's account); one voice session for everything.

## 10. Reuse
MIT for code only; check each dataset and 3D model separately. Candidate parts for ideas: the panel contract, the status triple per source, the layer lifecycle. Do not ship any bundled non-commercial data.

## 11. Verdict: ADAPT the information architecture for M10 (design reference for the UI handoff)
Copy: (1) every source and every panel always shows a status and a last message, including "empty because X"; (2) layers (here: sources, evidence, cases, agents) toggle independently with a roster of the currently relevant items; (3) first-run missions that teach the console by doing one real task, ending with a reset.
Avoid: (1) bundling data whose licence forbids our use; (2) a fallback that does not announce itself; (3) a console that shows data without a decision record behind it.
Where we are already ahead: the console's centre is a decision dossier with a verifiable record; the globe view shows state only.
