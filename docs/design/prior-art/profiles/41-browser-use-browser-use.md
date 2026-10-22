# Profile: browser-use/browser-use

Reader: Haiku (low effort), 2026-10-16, about 126 seconds, 98k tokens, 30 tool calls. Shallow clone (depth 1), commit ccd22fe (deleted after the profile pass). Paths relative to `browser_use/` unless stated.

Spot-check (reviewer, against the code): MIT licence, copyright Gregor Zunic (confirmed); commit ccd22fe (confirmed); the browser profile has `allowed_domains`, `prohibited_domains` and `block_ip_addresses` fields, and domain lists of 100 or more entries are converted to sets at `browser/profile.py:37,628-636,749-756` (confirmed); a URL check `_is_url_allowed` exists in the security watchdog at `browser/watchdogs/security_watchdog.py:176` (confirmed; the rule details in the reader's account, such as www variants and IP normalisation, were not rechecked). Result: PASS on the parts checked.

## 1. What it is
A Python library that lets a language model drive a real browser through the Chrome DevTools Protocol, with an action loop, page-state extraction and a set of watchdogs. MIT.

## 2. Architecture map
Agent (loop), browser session and profile, a tools registry (actions as typed models), DOM service (page state with an index of clickable elements), an event bus with watchdogs (security among them), history of steps with screenshots, a judge for traces, cloud and MCP modes.

## 3. Features and how each behaves
Actions: navigate, click by index or coordinates, type, search (DuckDuckGo by default), extract (optionally against a schema), scroll, done with a success flag. Each action returns a result with an error, text for the model's long-term memory and extracted content. A global action timeout (180 seconds by default, per the reader) bounds a hung browser call. A fallback model and a separate extraction model can be set. Loop detection nudges the agent when it repeats itself.

## 4. How people use it
`uv sync`, create an agent with a task, a model and a browser session, run with a step limit; local browser, cloud browser or MCP server. Examples show domain blocking and sensitive-data masking. Issues and feedback: NOT VERIFIED.

## 5. Mechanism for our module (M1 live web connector under policy)
The security watchdog sits between the agent's intended navigation and the browser: it handles navigation, navigation-complete and new-tab events, applies allow and block lists (exact, wildcard, scheme prefixes, IP addresses blocked on request), and sends a blocked tab to a blank page. This is the pattern we need for any live-web source: the policy is enforced in the event path, not asked of the model. Lost: wildcard matching is disabled for very large lists (per the reader, not rechecked); masking of sensitive values covers the model's context only, not logs or screenshots.

## 6. Agent patterns
One agent with a judge and loop detection; separate extraction model; fallback model. No multi-agent roles.

## 7. Model and data layer
Many model providers; page state as a serialised DOM with an accessibility tree and an index of interactive elements; profile settings for the browser.

## 8. Hackathon-care checks
Step history with outcomes and screenshot hashes (a JSONL export is NOT VERIFIED); no sample mode found; Docker flags for the browser; sensitive-data placeholders keep secrets out of the prompt.

## 9. Traps seen
A dead browser socket can hang a handler until the global timeout; large allow lists lose pattern matching; masking only protects the model's view; the page text itself is untrusted input to the model.

## 10. Reuse
MIT: copy with credit. Candidate parts: typed action models in a registry, the event-driven security watchdog, the action result structure, sensitive-data placeholders.

## 11. Verdict: ADAPT for M1 (live-web channel) and M8
Copy: (1) a policy watchdog on the navigation event path with allow list, block list and IP block; (2) typed actions in a registry with a result that separates error text, what the model keeps and what is extracted; (3) placeholders for secrets in prompts, replaced only at action time.
Avoid: (1) silently losing pattern matching on big lists: fail at configuration time; (2) page text treated as instructions: it enters as untrusted evidence (M8 quarantine); (3) a single global timeout as the only hang guard.
Where we are already ahead: every fetched page is stored with a hash and a text layer, so a later citation can be verified.
