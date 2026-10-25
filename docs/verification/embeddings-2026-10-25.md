# Embeddings for Scout Intent and the owner's notes (DF-116, DF-119), 2026-10-25

Two places in the Desk compare meaning: Scout Intent (is this request like one of the examples of a kind) and the owner's memory (is this note about the question). Both had a deterministic text comparison and nothing better. This adds an embedding model behind a port, the same shape as the chat model's: a live endpoint, a recording of it, and a replay of the recording that needs no key and no network.

## What it does

`src/desk/embed/port.ts`: `LiveEmbedder` calls `nvidia/nemotron-3-embed-1b` (2,048 dimensions, facts in `docs/sponsors/nvidia-integration-notes.md`) through the declared embedding destination, 32 texts to a request, retries on a rate limit or a server error up to a cap, a deadline on every call, credential-shaped strings masked before anything leaves (and the key itself), one line in the egress log per request with its size and hash and never its text, and `DESK_MODEL_PROFILE=local` refusing any destination that is not on this machine. A text with nothing in it has no meaning and is never sent. `CassetteEmbedder` replays recorded vectors, one signed byte per dimension and a scale (about 2.7 KB a vector; the rounding moves a cosine by about 0.001), in 16 files of about 260 KB; a text with no recording is a typed miss, never a guess. `ReplayOrRecordEmbedder` asks the endpoint only for what is not recorded, so an interrupted recording resumes, and writes the files in a stable order.

Live use is opt-in: `DESK_EMBED=on`. It sends the text of questions and of the owner's notes to the endpoint, and the Desk sends nothing off the machine that it was not told to. In sample mode the recorded vectors are used and nothing is sent. `desk embed status` says which; `desk embed record` calls the endpoint for every text the sample needs.

Scout Intent (`src/scout-intent/scout.ts`): the registry's examples are embedded once, as passages, and each prompt and the segments it may be cut into once, as queries, in one request. The nearest example of each intent gives the semantic term. If the embedder fails the decision is made with the built-in comparison and marked `degraded` with the reason (the trace, the `route_decision` row and `desk scout` show it); a failure is not retried for half a minute.

The owner's notes (`src/desk/engines/semantic.ts`, `memory.ts`): H-MEM ranks with its own hash embedder and the vendored files are not edited. Beside it, each note's vector is kept in a file next to the memory (keyed by the note's id and a hash of its text, so a changed note is embedded again and a removed one leaves nothing), and a question is read against each note. A note is recalled by a shared word, by meaning (cosine 0.30 or more), or both; a note that shares a word but whose cosine is under 0.20 is a coincidence of wording and is left out. A question that names no topic still gets the newest notes. `verify-answer` can be given the same embedder; without it a recall that matched by meaning shows as changed.

## What was measured

Everything below is from recorded vectors and reproduces offline. The question sets were written by the people who built the recall and the router.

Owner's notes (`evals/memory`: 14 notes; 28 development and 24 test questions; `docs/verification/embed/recall.json`):

- Test questions: a note the question is about is found for 15 of 16 questions with vectors and 15 of 16 by words alone. Of the notes recalled for those questions, 50.0% were not about the question with vectors against 63.6% by words. Of 8 questions about nothing in the notes, none found a note with vectors; one did by words.
- Development questions, which the two thresholds were chosen on: 15 of 20 with vectors against 13 of 20 by words; notes recalled that were not about the question 34.8% against 53.6%; none of 8 against one of 8.
- The test questions mostly share words with their notes, so the gain that shows there is in precision, not in finding paraphrases; the development questions were written to be paraphrases, and that gain is on the questions the thresholds were tuned on.

Scout Intent: see the section "With a real embedder in the second stage" in `docs/verification/scout-intent-2026-10-25.md`. Paraphrase intent top-1 on Meterless's registry goes from 0.625 to 0.764 and the gate still fails; the Desk's own four-way routing is 96.3% and 96.8%, which is no difference this question set can show.

## What was run

`tests/desk/embed-port.test.ts` (22: ordering, batches, masking, the egress record, retries, a deadline, malformed replies, the declared-destination and local-profile refusals, recordings round-trip, stable files, one model's recordings never read for another, the opt-in); `tests/scout/embedder.test.ts` (9); `tests/desk/memory-semantic.test.ts` (16: a note found by meaning, dropped coincidence, fall back and why, vectors kept and not asked for twice, inside Ask and `verify-answer`); `desk prove` check `owner-notes-are-found-by-meaning-and-fall-back-to-words` (recomputes the recall record byte for byte, then fails the embedder and removes the vectors and requires each to give what words give). Mutation checks on the port: removing the masking, the ordering by index and the destination refusal each fail a test.

## Not covered

- A live endpoint over time: latency, rate limits (NOT VERIFIED for embeddings), and what a model change does; the vectors are from one model and no other model was scored.
- Real notes and real questions. Fourteen notes is a small memory; a large one has not been tried, and the first `prime` embeds every note it has not yet embedded in batches of 32.
- Languages other than English.
- The engine's own ranking still uses its hash embedder; making the engine itself take a provider would mean editing the vendored files, which the notice rules out, so the real embedder acts beside it.
